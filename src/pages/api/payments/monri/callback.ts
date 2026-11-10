// Server-zu-Server Callback von Monri. Greift auch, wenn der Gast den Browser nach der Zahlung schließt.
import type { APIRoute } from 'astro';
import { BookingError } from '../../../../lib/booking';
import { refFromOrderNumber, verifyCallback } from '../../../../lib/monri';
import { handlePaid } from '../../../../lib/onPaid';

export const POST: APIRoute = async ({ request }) => {
  const raw = await request.text();
  const auth = request.headers.get('authorization') ?? request.headers.get('http_authorization');
  if (!verifyCallback(raw, auth)) return new Response('invalid digest', { status: 401 });

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const approved = data?.status === 'approved' || data?.response_code === '0000';
  if (!approved) return new Response('ignored', { status: 200 });

  try {
    await handlePaid(refFromOrderNumber(String(data.order_number)), String(data.order_number), Number(data.amount) / 100, 'monri');
  } catch (e) {
    if (e instanceof BookingError && e.code === 'not_found') return new Response('unknown order', { status: 200 });
    throw e;
  }
  return new Response('ok', { status: 200 });
};
