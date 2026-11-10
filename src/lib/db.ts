// Demo-Datenspeicher: eine JSON-Datei, synchron gelesen/geschrieben.
// Node ist single-threaded, d.h. read → prüfen → write ohne await dazwischen ist atomar
// (kein Doppelbuchen innerhalb eines Prozesses).
// shortcut: Für Produktion durch Supabase ersetzen (Schema: supabase/migrations/0001_init.sql).
// Auf Vercel liegt die Datei in /tmp und ist NICHT dauerhaft – nur für die Demo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { departures as seedDepartures, type Departure } from '../data/seed';
import type { Quote } from './pricing';
import type { BookingLoad } from './availability';
import type { Lang } from '../i18n';

export interface Participant {
  firstName: string;
  lastName: string;
  birthDate: string;
  bike: 'own' | 'rental';
  bikeModel: string | null;
  gear: boolean;
  gearSize: string | null;
  level: 'einsteiger' | 'fortgeschritten' | 'profi';
}

export interface Contact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  zip: string;
  street: string;
}

export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';

export interface Booking {
  ref: string;
  token: string;
  departureCode: string;
  tourId: 5 | 8;
  status: BookingStatus;
  contact: Contact;
  participants: Participant[];
  singleRooms: number;
  transfer: { airport: string | null; arrival: boolean; departure: boolean };
  notes: string;
  source: string;
  quote: Quote;
  paymentMethod: 'card' | 'bank' | 'manual';
  locale: Lang;
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  paymentProviderRef: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  needsAttention: string | null;
  log: { at: string; msg: string }[];
}

export interface WaitlistEntry {
  departureCode: string;
  name: string;
  email: string;
  persons: number;
  createdAt: string;
}

interface DB {
  departures: Departure[];
  bookings: Booking[];
  waitlist: WaitlistEntry[];
  seq: Record<string, number>;
  processedPayments: string[];
}

const DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'data');
const FILE = path.join(DIR, 'db.json');

function demoBooking(code: string, persons: number, rental: number, ref: string): Booking {
  const now = new Date().toISOString();
  return {
    ref,
    token: crypto.randomBytes(12).toString('hex'),
    departureCode: code,
    tourId: 8,
    status: 'confirmed',
    contact: { firstName: 'Demo', lastName: 'Gruppe', email: 'demo@example.com', phone: '', country: 'AT', city: 'Salzburg', zip: '5020', street: '' },
    participants: Array.from({ length: persons }, (_, i) => ({
      firstName: 'Fahrer',
      lastName: String(i + 1),
      birthDate: '1985-01-01',
      bike: i < rental ? 'rental' : 'own',
      bikeModel: i < rental ? 'KTM 350 EXC-F' : null,
      gear: false,
      gearSize: null,
      level: 'fortgeschritten',
    })),
    singleRooms: 0,
    transfer: { airport: null, arrival: false, departure: false },
    notes: 'Demo-Buchung',
    source: 'demo',
    quote: { lines: [], total: 0, deposit: 0, balance: 0 },
    paymentMethod: 'bank',
    locale: 'de',
    paymentStatus: 'paid',
    paymentProviderRef: null,
    paidAt: now,
    expiresAt: null,
    createdAt: now,
    confirmedAt: now,
    needsAttention: null,
    log: [{ at: now, msg: 'Demo-Daten' }],
  };
}

function seed(): DB {
  const deps = structuredClone(seedDepartures);
  // 715 überlappt mit anderen Terminen → weniger Leihmotorräder frei (Demo für Badge).
  deps.find((d) => d.code === '715')!.capacityRentalBikes = 14;
  return {
    departures: deps,
    bookings: [demoBooking('708', 14, 4, 'BE-2027-DEMO1'), demoBooking('715', 12, 12, 'BE-2027-DEMO2')],
    waitlist: [],
    seq: {},
    processedPayments: [],
  };
}

function load(): DB {
  if (!fs.existsSync(FILE)) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(seed(), null, 2));
  }
  return JSON.parse(fs.readFileSync(FILE, 'utf8')) as DB;
}

function save(db: DB) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

/** Liest die DB, führt fn aus und speichert – synchron, daher ohne Race innerhalb des Prozesses. */
export function tx<T>(fn: (db: DB) => T): T {
  const db = load();
  expireHolds(db);
  const result = fn(db);
  save(db);
  return result;
}

export function read<T>(fn: (db: DB) => T): T {
  const db = load();
  expireHolds(db);
  return fn(db);
}

function expireHolds(db: DB) {
  const now = new Date();
  for (const b of db.bookings) {
    if (b.status === 'pending_payment' && b.expiresAt && new Date(b.expiresAt) <= now) {
      b.status = 'expired';
      b.log.push({ at: now.toISOString(), msg: 'Reservierung abgelaufen (keine Zahlung)' });
    }
  }
}

export function loads(db: DB): BookingLoad[] {
  return db.bookings.map((b) => ({
    departureCode: b.departureCode,
    status: b.status,
    expiresAt: b.expiresAt,
    persons: b.participants.length,
    rentalBikes: b.participants.filter((p) => p.bike === 'rental').length,
  }));
}

export function nextRef(db: DB, year: string): string {
  db.seq[year] = (db.seq[year] ?? 0) + 1;
  return `BE-${year}-${String(db.seq[year]).padStart(4, '0')}`;
}

export function findBooking(db: DB, ref: string, token?: string): Booking | undefined {
  const b = db.bookings.find((x) => x.ref === ref);
  if (!b) return undefined;
  if (token !== undefined && !safeEqual(b.token, token)) return undefined;
  return b;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
