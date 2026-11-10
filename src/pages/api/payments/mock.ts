// Nur für die Demo: simuliert die Kartenzahlung. In Produktion (PAYMENT_PROVIDER=monri) deaktiviert.
import type { APIRoute } from 'astro';
import { cardProvider } from '../../../lib/config';
import { getBooking } from '../../../lib/booking';
import { handlePaid } from '../../../lib/onPaid';
import { prefix } from '../../../i18n';

export const GET: APIRoute = async ({ url, redirect }) => {
  if (cardProvider() !== 'mock') return new Response('Not found', { status: 404 });
  const ref = url.searchParams.get('ref') ?? '';
  const token = url.searchParams.get('token') ?? '';
  const b = getBooking(ref, token);
  if (!b) return new Response('Buchung nicht gefunden', { status: 404 });
  const q = `ref=${encodeURIComponent(ref)}&token=${token}`;
  const p = prefix(b.locale ?? 'de');
  if (url.searchParams.get('result') !== 'success') return redirect(`${p}/buchen/bezahlen?${q}&failed=1`);
  await handlePaid(ref, `mock-${b.ref}`, b.quote.deposit, 'mock');
  return redirect(`${p}/buchen/bestaetigung?${q}`);
};
