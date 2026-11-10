import crypto from 'node:crypto';
import { bikeModels, settings, tours } from '../data/seed';
import { availability } from './availability';
import { findBooking, loads, nextRef, tx, read, type Booking, type Contact, type Participant } from './db';
import { quote, type Quote } from './pricing';
import { cardProvider } from './config';
import { COUNTRIES, t, toLang, type Lang } from '../i18n';

export class BookingError extends Error {
  constructor(message: string, public code = 'invalid') {
    super(message);
  }
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const LEVELS = ['einsteiger', 'fortgeschritten', 'profi'] as const;

export interface ParsedRequest {
  departureCode: string;
  tourId: 5 | 8;
  participants: Participant[];
  singleRooms: number;
  transfer: Booking['transfer'];
  contact: Contact;
  notes: string;
  source: string;
  paymentMethod: 'card' | 'bank' | 'manual';
  locale: Lang;
}

/** Validiert nur das, was für Preis/Verfügbarkeit nötig ist (für /api/quote). */
export function parseQuoteInput(body: any) {
  const E = t(toLang(body?.lang)).err;
  const tour = tours.find((t) => t.id === Number(body?.tourId));
  if (!tour) throw new BookingError(E.chooseTour);
  const riders = Array.isArray(body?.participants) ? body.participants : [];
  if (riders.length < 1 || riders.length > 17) throw new BookingError(E.count);
  const participants = riders.map((r: any) => ({ bike: r?.bike === 'rental' ? 'rental' : 'own', gear: r?.gear === true })) as {
    bike: 'own' | 'rental';
    gear: boolean;
  }[];
  const singleRooms = Math.max(0, Math.min(riders.length, Math.floor(Number(body?.singleRooms) || 0)));
  const airport = settings.transferAirports.includes(body?.transfer?.airport) ? (body.transfer.airport as string) : null;
  const transfer = { airport, arrival: !!airport && body?.transfer?.arrival === true, departure: !!airport && body?.transfer?.departure === true };
  return { tour, participants, singleRooms, transfer };
}

export function parseBookingRequest(body: any): ParsedRequest {
  const { tour, singleRooms, transfer } = parseQuoteInput(body);
  const locale = toLang(body?.lang);
  const E = t(locale).err;
  const departureCode = str(body?.departureCode, 10);

  const participants: Participant[] = body.participants.map((r: any, i: number) => {
    const p: Participant = {
      firstName: str(r?.firstName, 80),
      lastName: str(r?.lastName, 80),
      birthDate: str(r?.birthDate, 10),
      bike: r?.bike === 'rental' ? 'rental' : 'own',
      bikeModel: r?.bike === 'rental' && bikeModels.includes(r?.bikeModel) ? r.bikeModel : null,
      gear: r?.gear === true,
      gearSize: r?.gear === true ? str(r?.gearSize, 10) || null : null,
      level: LEVELS.includes(r?.level) ? r.level : 'fortgeschritten',
    };
    if (!p.firstName || !p.lastName) throw new BookingError(E.riderName(i + 1));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate) || isNaN(Date.parse(p.birthDate))) throw new BookingError(E.riderBirth(i + 1));
    if (p.bike === 'rental' && !p.bikeModel) p.bikeModel = bikeModels[0];
    return p;
  });

  const c = body?.contact ?? {};
  const contact: Contact = {
    firstName: str(c.firstName, 80),
    lastName: str(c.lastName, 80),
    email: str(c.email, 160).toLowerCase(),
    phone: str(c.phone, 40),
    country: str(c.country, 2).toUpperCase(),
    city: str(c.city, 80),
    zip: str(c.zip, 20),
    street: str(c.street, 120),
  };
  if (Object.values(contact).some((v) => !v) || !COUNTRIES.includes(contact.country)) throw new BookingError(E.contact);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw new BookingError(E.email);

  const consents = body?.consents ?? {};
  if (consents.agb !== true || consents.waiver !== true || consents.privacy !== true)
    throw new BookingError(E.consents);

  return {
    departureCode,
    tourId: tour.id,
    participants,
    singleRooms,
    transfer,
    contact,
    notes: str(body?.notes, 2000),
    source: str(body?.source, 100),
    paymentMethod: body?.paymentMethod === 'card' ? 'card' : 'bank',
    locale,
  };
}

export function computeQuote(req: Pick<ParsedRequest, 'tourId' | 'participants' | 'singleRooms' | 'transfer' | 'locale'>): Quote {
  const tour = tours.find((t) => t.id === req.tourId)!;
  return quote({ tour, riders: req.participants, singleRooms: req.singleRooms, transfer: req.transfer }, settings, req.locale);
}

/** Legt die Buchung als Reservierung (Hold) an. Preis + Kapazität werden hier am Server geprüft. */
export function createBooking(req: ParsedRequest): Booking {
  const E = t(req.locale).err;
  if (req.paymentMethod === 'card' && cardProvider() === 'off')
    throw new BookingError(E.cardOff);
  return tx((db) => {
    const dep = db.departures.find((d) => d.code === req.departureCode);
    if (!dep) throw new BookingError(E.depNotFound);
    if (!dep.tours.includes(req.tourId)) throw new BookingError(E.tourNotAvail);
    if (new Date(dep.start) <= new Date()) throw new BookingError(E.past);

    const av = availability(dep, loads(db));
    if (av.status === 'full' || av.status === 'closed') throw new BookingError(E.full, 'full');
    if (req.participants.length > av.freePlaces)
      throw new BookingError(E.places(av.freePlaces), 'full');
    const rentals = req.participants.filter((p) => p.bike === 'rental').length;
    if (rentals > av.freeRentalBikes)
      throw new BookingError(E.bikes(av.freeRentalBikes), 'full');

    const now = new Date();
    // Manuelle (Telefon-)Buchungen laufen nicht ab – Admin storniert sie bei Bedarf.
    const expires =
      req.paymentMethod === 'manual'
        ? null
        : req.paymentMethod === 'card'
          ? new Date(now.getTime() + settings.holdMinutesCard * 60_000)
          : new Date(now.getTime() + settings.holdDaysBank * 86_400_000);

    const booking: Booking = {
      ref: nextRef(db, dep.start.slice(0, 4)),
      token: crypto.randomBytes(16).toString('hex'),
      departureCode: dep.code,
      tourId: req.tourId,
      status: 'pending_payment',
      contact: req.contact,
      participants: req.participants,
      singleRooms: req.singleRooms,
      transfer: req.transfer,
      notes: req.notes,
      source: req.source,
      quote: computeQuote(req),
      paymentMethod: req.paymentMethod,
      locale: req.locale,
      paymentStatus: 'unpaid',
      paymentProviderRef: null,
      paidAt: null,
      expiresAt: expires?.toISOString() ?? null,
      createdAt: now.toISOString(),
      confirmedAt: null,
      needsAttention: null,
      log: [{ at: now.toISOString(), msg: `Reserviert (${req.paymentMethod})` }],
    };
    db.bookings.push(booking);
    return booking;
  });
}

/**
 * Zahlung verbuchen. Idempotent: dieselbe providerRef wird nur einmal verarbeitet.
 * Gibt { booking, firstTime } zurück, damit Mails nur einmal verschickt werden.
 */
export function markPaid(ref: string, providerRef: string, amount: number, source: string) {
  return tx((db) => {
    const b = findBooking(db, ref);
    if (!b) throw new BookingError('Buchung nicht gefunden.', 'not_found');
    const key = `${source}:${providerRef}`;
    const now = new Date().toISOString();
    if (db.processedPayments.includes(key)) return { booking: b, firstTime: false, duplicate: false };
    db.processedPayments.push(key);

    if (b.paymentStatus === 'paid') {
      // Zweite echte Zahlung (z. B. zwei Tabs) → Admin muss erstatten.
      b.needsAttention = 'double_payment';
      b.log.push({ at: now, msg: `Doppelzahlung ${amount} € (${source}, ${providerRef}) – bitte erstatten` });
      return { booking: b, firstTime: false, duplicate: true };
    }
    if (Math.round(amount * 100) !== Math.round(b.quote.deposit * 100))
      b.needsAttention = 'amount_mismatch';

    if (b.status === 'cancelled') b.needsAttention = 'cancelled_paid';
    else if (b.status === 'expired') {
      // Zahlung kam nach Ablauf: trotzdem bestätigen, aber Kapazität prüfen und markieren.
      const dep = db.departures.find((d) => d.code === b.departureCode)!;
      const av = availability(dep, loads(db));
      const rentals = b.participants.filter((p) => p.bike === 'rental').length;
      if (b.participants.length > av.freePlaces || rentals > av.freeRentalBikes)
        b.needsAttention = 'late_full';
    }

    b.paymentStatus = 'paid';
    b.paymentProviderRef = providerRef;
    b.paidAt = now;
    b.status = 'confirmed';
    b.confirmedAt = now;
    b.expiresAt = null;
    b.log.push({ at: now, msg: `Anzahlung ${amount} € erhalten (${source}, ${providerRef})` });
    return { booking: b, firstTime: true, duplicate: false };
  });
}

export function getBooking(ref: string, token: string) {
  return read((db) => findBooking(db, ref, token));
}
