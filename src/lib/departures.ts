import { availability, type Availability } from './availability';
import { loads, read } from './db';
import type { Departure } from '../data/seed';
import type { Lang } from '../i18n';

export type DepartureView = Departure & Availability;

export function listDepartures(opts: { tour?: 5 | 8; includePast?: boolean; lang?: Lang } = {}): DepartureView[] {
  const today = new Date().toISOString().slice(0, 10);
  return read((db) => {
    const l = loads(db);
    return db.departures
      .filter((d) => (opts.includePast || d.start > today) && (!opts.tour || d.tours.includes(opts.tour)))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((d) => ({ ...d, ...availability(d, l, new Date(), opts.lang) }));
  });
}

/** Saison(en) der kommenden Termine, z. B. "2027" oder "2026/2027" – nie hart codiert. */
export function seasonLabel(): string {
  const years = [...new Set(listDepartures().map((d) => d.start.slice(0, 4)))];
  return years.length ? years.join('/') : String(new Date().getFullYear());
}
