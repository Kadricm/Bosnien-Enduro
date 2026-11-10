// Admin-only operations on dates and bookings. Callers must check isAdmin() first.
import { tours } from '../data/seed';
import { BookingError, createBooking, markPaid } from './booking';
import { read, tx, type Participant } from './db';

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isActive = (status: string) => status === 'confirmed' || status === 'pending_payment';

export function addDeparture(f: { code: string; start: string; end: string; tours: number[]; places: number; rental: number }): 'ok' | 'dep_exists' | 'dep_invalid' {
  const tr = f.tours.filter((x): x is 5 | 8 => x === 5 || x === 8);
  if (!/^[A-Za-z0-9-]{1,10}$/.test(f.code) || !isDate(f.start) || !isDate(f.end) || f.end < f.start || !tr.length) return 'dep_invalid';
  if (!(f.places >= 0 && f.places <= 60 && f.rental >= 0 && f.rental <= 40)) return 'dep_invalid';
  return tx((db) => {
    if (db.departures.some((d) => d.code === f.code)) return 'dep_exists';
    db.departures.push({ code: f.code, start: f.start, end: f.end, tours: tr, capacityPlaces: f.places, capacityRentalBikes: f.rental, manualStatus: null });
    return 'ok';
  });
}

export function deleteDeparture(code: string): 'ok' | 'dep_has_bookings' {
  return tx((db) => {
    if (db.bookings.some((b) => b.departureCode === code && isActive(b.status))) return 'dep_has_bookings';
    db.departures = db.departures.filter((d) => d.code !== code);
    return 'ok';
  });
}

const shift364 = (iso: string) => new Date(Date.parse(iso + 'T12:00:00Z') + 364 * 86_400_000).toISOString().slice(0, 10);

/** Copies all dates of `year` into year+1: +52 weeks (same weekday), code 7xx → 8xx. Skips existing codes. */
export function copySeason(year: number): number {
  const digit = String((year + 1) % 10);
  return tx((db) => {
    let n = 0;
    for (const d of db.departures.filter((x) => x.start.startsWith(String(year)))) {
      const code = /^\d{3}$/.test(d.code) ? digit + d.code.slice(1) : `${d.code}-${year + 1}`;
      if (db.departures.some((x) => x.code === code)) continue;
      db.departures.push({ ...d, code, start: shift364(d.start), end: shift364(d.end), manualStatus: null });
      n++;
    }
    return n;
  });
}

/** Phone/WhatsApp booking: same capacity checks as online, no deadline, no mails. */
export function manualBooking(f: {
  departureCode: string;
  tourId: number;
  own: number;
  rental: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  singleRooms: number;
  notes: string;
  paid: boolean;
}) {
  const tourId = tours.some((t) => t.id === f.tourId) ? (f.tourId as 5 | 8) : 5;
  const own = Math.max(0, Math.floor(f.own) || 0);
  const rental = Math.max(0, Math.floor(f.rental) || 0);
  const count = own + rental;
  if (count < 1 || count > 17 || !f.firstName || !f.lastName) throw new BookingError('invalid');
  const participants: Participant[] = Array.from({ length: count }, (_, i) => ({
    firstName: i === 0 ? f.firstName : `${f.firstName} +${i}`,
    lastName: f.lastName,
    birthDate: '',
    bike: i < own ? 'own' : 'rental',
    bikeModel: i < own ? null : 'KTM 350 EXC-F',
    gear: false,
    gearSize: null,
    level: 'fortgeschritten',
  }));
  const booking = createBooking({
    departureCode: f.departureCode,
    tourId,
    participants,
    singleRooms: Math.max(0, Math.min(count, Math.floor(f.singleRooms) || 0)),
    transfer: { airport: null, arrival: false, departure: false },
    contact: { firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone, country: '', city: '', zip: '', street: '' },
    notes: f.notes,
    source: 'admin',
    paymentMethod: 'manual',
    locale: 'de',
  });
  if (f.paid) markPaid(booking.ref, `manual-${booking.ref}`, booking.quote.deposit, 'manual');
  return booking;
}

// Guest-entered text starting with = @ or +/- followed by a non-digit would run as an Excel formula → prefix with '.
// Phone numbers like "+387 61…" stay untouched.
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/^(=|@|[+-](?![\d\s]))/, "'$1").replace(/"/g, '""')}"`;

/** Participant list for one date (hotel, bikes, gear, transfer). Excel-friendly: BOM + ";". */
export function exportCsv(code: string): string {
  const rows = read((db) => db.bookings.filter((b) => b.departureCode === code && isActive(b.status)));
  const head = ['Buchung', 'Status', 'Tour', 'Vorname', 'Nachname', 'Geburtsdatum', 'Motorrad', 'Modell', 'Ausrüstung', 'Größe', 'Level', 'Kontakt', 'Telefon', 'E-Mail', 'EZ (Buchung)', 'Transfer', 'Notiz', 'Anzahlung bezahlt', 'Rest bar'];
  const lines = [head];
  for (const b of rows)
    for (const p of b.participants)
      lines.push([
        b.ref,
        b.status,
        `${b.tourId}-Tage`,
        p.firstName,
        p.lastName,
        p.birthDate,
        p.bike === 'rental' ? 'Leih' : 'eigenes',
        p.bikeModel ?? '',
        p.gear ? 'ja' : '',
        p.gearSize ?? '',
        p.level,
        `${b.contact.firstName} ${b.contact.lastName}`,
        b.contact.phone,
        b.contact.email,
        b.singleRooms,
        b.transfer.airport ? `${b.transfer.airport} ${b.transfer.arrival ? 'hin' : ''} ${b.transfer.departure ? 'rück' : ''}`.trim() : '',
        b.notes,
        b.paymentStatus === 'paid' ? 'ja' : 'nein',
        b.quote.balance,
      ].map(String));
  return '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n');
}

