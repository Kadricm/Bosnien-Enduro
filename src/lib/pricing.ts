import type { Settings, Tour } from '../data/seed';
import { t, type Lang } from '../i18n';

export interface RiderInput {
  bike: 'own' | 'rental';
  gear: boolean;
}

export interface QuoteInput {
  tour: Tour;
  riders: RiderInput[];
  singleRooms: number;
  transfer: { arrival: boolean; departure: boolean };
}

export interface QuoteLine {
  label: string;
  amount: number;
}

export interface Quote {
  lines: QuoteLine[];
  total: number;
  deposit: number;
  balance: number;
}

export function transferPrice(settings: Settings, persons: number): number {
  const tier = settings.transferTiers.find((t) => persons >= t.min && persons <= t.max);
  // Grupe veće od zadnjeg razreda: najveći razred (admin može korigovati ručno).
  return tier ? tier.price : settings.transferTiers[settings.transferTiers.length - 1].price;
}

export function quote(input: QuoteInput, settings: Settings, lang: Lang = 'de'): Quote {
  const { tour, riders } = input;
  const P = t(lang).price;
  const name = t(lang).tourName[tour.id] ?? tour.name;
  const own = riders.filter((r) => r.bike === 'own').length;
  const rental = riders.length - own;
  const gear = riders.filter((r) => r.gear).length;
  const lines: QuoteLine[] = [];

  if (own) lines.push({ label: P.own(own, name, tour.priceOwnBike), amount: own * tour.priceOwnBike });
  if (rental) lines.push({ label: P.rental(rental, name, tour.priceRentalBike), amount: rental * tour.priceRentalBike });
  if (gear) lines.push({ label: P.gear(gear, tour.ridingDays, settings.gearPerDay), amount: gear * tour.ridingDays * settings.gearPerDay });
  if (input.singleRooms > 0)
    lines.push({ label: P.single(input.singleRooms, tour.nights, settings.singleRoomPerNight), amount: input.singleRooms * tour.nights * settings.singleRoomPerNight });

  const legs = (input.transfer.arrival ? 1 : 0) + (input.transfer.departure ? 1 : 0);
  if (legs) {
    const p = transferPrice(settings, riders.length);
    lines.push({ label: P.transfer(legs, riders.length), amount: legs * p });
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const base = settings.depositMode === 'per_person' ? settings.depositAmount * riders.length : settings.depositAmount;
  // AGB: unter 200 € wird der gesamte Betrag fällig.
  const deposit = total < 200 ? total : Math.min(base, total);
  return { lines, total, deposit, balance: total - deposit };
}
