import type { Departure } from '../data/seed';
import { t, type Lang } from '../i18n';

export interface BookingLoad {
  departureCode: string;
  status: string;
  expiresAt: string | null;
  persons: number;
  rentalBikes: number;
}

export type StatusKind = 'free' | 'few' | 'full' | 'closed';

export interface Availability {
  freePlaces: number;
  freeRentalBikes: number;
  status: StatusKind;
  label: string;
  rentalWarning: string | null;
}

/** Zählt bestätigte Buchungen + noch nicht abgelaufene Reservierungen (Hold). */
export function isHolding(b: BookingLoad, now: Date): boolean {
  if (b.status === 'confirmed') return true;
  if (b.status === 'pending_payment') return !b.expiresAt || new Date(b.expiresAt) > now;
  return false;
}

export function availability(dep: Departure, bookings: BookingLoad[], now = new Date(), lang: Lang = 'de'): Availability {
  const L = t(lang).status;
  let places = 0;
  let rental = 0;
  for (const b of bookings) {
    if (b.departureCode !== dep.code || !isHolding(b, now)) continue;
    places += b.persons;
    rental += b.rentalBikes;
  }
  const freePlaces = Math.max(0, dep.capacityPlaces - places);
  const freeRentalBikes = Math.max(0, dep.capacityRentalBikes - rental);

  let status: StatusKind;
  let label: string;
  if (dep.manualStatus === 'closed') [status, label] = ['closed', L.closed];
  else if (dep.manualStatus === 'full' || freePlaces === 0) [status, label] = ['full', L.full];
  else if (freePlaces <= 4) [status, label] = ['few', L.few(freePlaces)];
  else [status, label] = ['free', L.free];

  const rentalWarning =
    status !== 'full' && status !== 'closed' && freeRentalBikes <= 3
      ? freeRentalBikes === 0
        ? L.noBikes
        : L.fewBikes(freeRentalBikes)
      : null;

  return { freePlaces: status === 'full' || status === 'closed' ? 0 : freePlaces, freeRentalBikes, status, label, rentalWarning };
}
