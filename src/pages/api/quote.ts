import type { APIRoute } from 'astro';
import { BookingError, parseQuoteInput } from '../../lib/booking';
import { quote } from '../../lib/pricing';
import { settings } from '../../data/seed';
import { t, toLang } from '../../i18n';

export const POST: APIRoute = async ({ request }) => {
  let body: any = null;
  try {
    body = await request.json();
    const { tour, participants, singleRooms, transfer } = parseQuoteInput(body);
    return Response.json(quote({ tour, riders: participants, singleRooms, transfer }, settings, toLang(body?.lang)));
  } catch (e) {
    const msg = e instanceof BookingError ? e.message : t(toLang(body?.lang)).err.invalid;
    return Response.json({ error: msg }, { status: 400 });
  }
};
