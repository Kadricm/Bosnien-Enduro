import { markPaid } from './booking';
import { read } from './db';
import { mailAdmin, mailConfirmed } from './email';
import { adminT } from './adminI18n';

const attn = (code: string | null) => (code ? (adminT('de').attn[code] ?? code) : '');

/** Zahlung verbuchen + Mails (nur beim ersten Mal). */
export async function handlePaid(ref: string, providerRef: string, amount: number, source: string) {
  const { booking, firstTime, duplicate } = markPaid(ref, providerRef, amount, source);
  const dep = read((db) => db.departures.find((d) => d.code === booking.departureCode)!);
  if (duplicate) await mailAdmin(`ACHTUNG – ${attn(booking.needsAttention)}`, booking, dep);
  if (firstTime) {
    await mailConfirmed(booking, dep);
    await mailAdmin(booking.needsAttention ? `ACHTUNG – ${attn(booking.needsAttention)}` : 'Anzahlung eingegangen', booking, dep);
  }
  return booking;
}
