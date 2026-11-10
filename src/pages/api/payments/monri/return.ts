// Rückleitung von Monri (Browser des Gastes). Digest prüfen, dann verbuchen.
import type { APIRoute } from 'astro';
import { getBooking } from '../../../../lib/booking';
import { siteUrl } from '../../../../lib/config';
import { refFromOrderNumber, verifyReturnUrl } from '../../../../lib/monri';
import { handlePaid } from '../../../../lib/onPaid';
import { prefix } from '../../../../i18n';

export const GET: APIRoute = async ({ url, redirect }) => {
  const ref = url.searchParams.get('ref') ?? '';
  const token = url.searchParams.get('token') ?? '';
  const b = getBooking(ref, token);
  if (!b) return new Response('Buchung nicht gefunden', { status: 404 });
  const q = `ref=${encodeURIComponent(ref)}&token=${token}`;
  const p = prefix(b.locale ?? 'de');

  if (url.searchParams.has('cancel')) return redirect(`${p}/buchen/bezahlen?${q}&failed=1`);

  // Monri signiert die volle URL, wie sie aufgerufen wurde (öffentliche Domain, nicht interne Vercel-URL).
  const fullUrl = siteUrl() + url.pathname + url.search;
  const orderNumber = url.searchParams.get('order_number') ?? '';
  const ok =
    verifyReturnUrl(fullUrl) &&
    url.searchParams.get('response_code') === '0000' &&
    refFromOrderNumber(orderNumber) === b.ref;
  if (!ok) return redirect(`${p}/buchen/bezahlen?${q}&failed=1`);

  await handlePaid(b.ref, orderNumber, Number(url.searchParams.get('amount')) / 100, 'monri');
  return redirect(`${p}/buchen/bestaetigung?${q}`);
};
