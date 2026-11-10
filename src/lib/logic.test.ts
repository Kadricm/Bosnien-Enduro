import { describe, expect, it } from 'vitest';
import { quote } from './pricing';
import { availability, type BookingLoad } from './availability';
import { settings, tours, type Departure } from '../data/seed';

const t5 = tours[0];
const t8 = tours[1];

describe('pricing', () => {
  it('Beispiel aus dem Plan: 8 Tage, 1 eigenes + 1 Leih, 1 EZ = 2.190 €', () => {
    const q = quote({ tour: t8, riders: [{ bike: 'own', gear: false }, { bike: 'rental', gear: false }], singleRooms: 1, transfer: { arrival: false, departure: false } }, settings);
    expect(q.total).toBe(850 + 1200 + 7 * 20);
    expect(q.deposit).toBe(100);
    expect(q.balance).toBe(2090);
  });

  it('Ausrüstung pro Fahrtag und Transfer pro Fahrt nach Gruppengröße', () => {
    const riders = Array.from({ length: 4 }, () => ({ bike: 'own' as const, gear: true }));
    const q = quote({ tour: t5, riders, singleRooms: 0, transfer: { arrival: true, departure: true } }, settings);
    expect(q.total).toBe(4 * 650 + 4 * 3 * 15 + 2 * 400);
  });

  it('Anzahlung pro Person, wenn so eingestellt', () => {
    const q = quote({ tour: t5, riders: [{ bike: 'own', gear: false }, { bike: 'own', gear: false }], singleRooms: 0, transfer: { arrival: false, departure: false } }, { ...settings, depositMode: 'per_person' });
    expect(q.deposit).toBe(200);
  });

  it('unter 200 € wird alles fällig', () => {
    const q = quote({ tour: { ...t5, priceOwnBike: 150 }, riders: [{ bike: 'own', gear: false }], singleRooms: 0, transfer: { arrival: false, departure: false } }, settings);
    expect(q.deposit).toBe(150);
    expect(q.balance).toBe(0);
  });
});

describe('availability', () => {
  const dep: Departure = { code: '708', start: '2027-05-22', end: '2027-05-29', tours: [5, 8], capacityPlaces: 17, capacityRentalBikes: 20, manualStatus: null };
  const now = new Date('2027-01-01T12:00:00Z');
  const b = (persons: number, rentalBikes: number, status = 'confirmed', expiresAt: string | null = null): BookingLoad => ({ departureCode: '708', persons, rentalBikes, status, expiresAt });

  it('frei', () => expect(availability(dep, [], now).status).toBe('free'));
  it('noch 3 Plätze', () => {
    const a = availability(dep, [b(14, 0)], now);
    expect([a.status, a.label, a.freePlaces]).toEqual(['few', 'Noch 3 Plätze', 3]);
  });
  it('ausgebucht', () => expect(availability(dep, [b(17, 0)], now).status).toBe('full'));
  it('laufende Reservierung zählt, abgelaufene nicht', () => {
    expect(availability(dep, [b(5, 0, 'pending_payment', '2027-01-01T12:10:00Z')], now).freePlaces).toBe(12);
    expect(availability(dep, [b(5, 0, 'pending_payment', '2027-01-01T11:50:00Z')], now).freePlaces).toBe(17);
  });
  it('stornierte/abgelaufene zählen nicht', () => expect(availability(dep, [b(5, 0, 'cancelled'), b(5, 0, 'expired')], now).freePlaces).toBe(17));
  it('Leihmotorrad-Warnung', () => expect(availability(dep, [b(10, 18)], now).rentalWarning).toBe('Nur noch 2 Leihmotorräder'));
  it('anderer Termin zählt nicht', () => expect(availability(dep, [{ ...b(17, 0), departureCode: '709' }], now).status).toBe('free'));
  it('manuell geschlossen', () => expect(availability({ ...dep, manualStatus: 'closed' }, [], now).status).toBe('closed'));
});
