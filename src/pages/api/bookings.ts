import type { APIRoute } from 'astro';
import { BookingError, createBooking, parseBookingRequest } from '../../lib/booking';
import { read } from '../../lib/db';
import { mailAdmin, mailBankInstructions } from '../../lib/email';
import { prefix, t, toLang } from '../../i18n';

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: t('de').err.invalid }, { status: 400 });
  }
  const p = prefix(toLang(body?.lang));
  try {
    const booking = createBooking(parseBookingRequest(body));
    const q = `ref=${encodeURIComponent(booking.ref)}&token=${booking.token}`;

    if (booking.paymentMethod === 'bank') {
      const dep = read((db) => db.departures.find((d) => d.code === booking.departureCode)!);
      await mailBankInstructions(booking, dep);
      await mailAdmin('Neue Buchung (Überweisung ausstehend)', booking, dep);
      return Response.json({ ref: booking.ref, redirect: `${p}/buchen/bestaetigung?${q}` });
    }
    return Response.json({ ref: booking.ref, redirect: `${p}/buchen/bezahlen?${q}` });
  } catch (e) {
    if (e instanceof BookingError) return Response.json({ error: e.message, code: e.code }, { status: e.code === 'full' ? 409 : 400 });
    console.error(e);
    return Response.json({ error: t(toLang(body?.lang)).err.server }, { status: 500 });
  }
};
