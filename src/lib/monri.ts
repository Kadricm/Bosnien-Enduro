// Monri WebPay Form (v2) – Hosted Payment Page.
// Ablauf: Formular per POST an Monri → Gast zahlt dort (3-D Secure) → Monri leitet auf success_url
// zurück (mit digest) UND schickt einen Server-Callback (JSON, Header "authorization: WP3-callback <digest>").
// Beide Wege rufen markPaid() auf; das ist idempotent.
// TODO(confirm-with-client): Feldnamen/Sprache gegen die Monri-Testumgebung prüfen, sobald der Test-Shop da ist.
import crypto from 'node:crypto';
import type { Booking } from './db';
import { safeEqual } from './db';

const env = (k: string) => process.env[k] ?? import.meta.env[k] ?? '';

export const monriConfigured = () => !!(env('MONRI_KEY') && env('MONRI_AUTHENTICITY_TOKEN'));

const sha512 = (s: string) => crypto.createHash('sha512').update(s).digest('hex');

export function monriFormUrl() {
  return env('MONRI_ENV') === 'production' ? 'https://ipg.monri.com/v2/form' : 'https://ipgtest.monri.com/v2/form';
}

/** order_number ist pro Zahlungsversuch eindeutig: <ref>-<suffix>. */
export function orderNumberFor(ref: string) {
  return `${ref}-${Date.now().toString(36)}`;
}
export function refFromOrderNumber(orderNumber: string) {
  return orderNumber.replace(/-[a-z0-9]+$/, '');
}

export function monriFormFields(b: Booking, siteUrl: string) {
  const key = env('MONRI_KEY');
  const currency = env('MONRI_CURRENCY') || 'EUR';
  const amount = String(Math.round(b.quote.deposit * 100)); // Minor units (Cent)
  const orderNumber = orderNumberFor(b.ref);
  const back = `${siteUrl}/api/payments/monri/return?ref=${encodeURIComponent(b.ref)}&token=${b.token}`;
  return {
    ch_full_name: `${b.contact.firstName} ${b.contact.lastName}`.slice(0, 30),
    ch_address: b.contact.street.slice(0, 100),
    ch_city: b.contact.city.slice(0, 30),
    ch_zip: b.contact.zip.slice(0, 9),
    ch_country: b.contact.country.slice(0, 30),
    ch_phone: b.contact.phone.slice(0, 30),
    ch_email: b.contact.email.slice(0, 100),
    order_info: `Anzahlung ${b.ref}`.slice(0, 100),
    order_number: orderNumber,
    amount,
    currency,
    transaction_type: 'purchase',
    language: b.locale ?? 'de',
    authenticity_token: env('MONRI_AUTHENTICITY_TOKEN'),
    digest: sha512(key + orderNumber + amount + currency),
    success_url_override: back,
    cancel_url_override: `${back}&cancel=1`,
    callback_url_override: `${siteUrl}/api/payments/monri/callback`,
  };
}

/** Prüft den digest der Rückleitung: SHA512(key + URL ohne "&digest=..."). */
export function verifyReturnUrl(fullUrl: string): boolean {
  const m = fullUrl.match(/^(.*)&digest=([a-f0-9]+)$/i);
  if (!m) return false;
  return safeEqual(sha512(env('MONRI_KEY') + m[1]), m[2].toLowerCase());
}

/** Prüft den Server-Callback: Header "WP3-callback <SHA512(key + body)>". */
export function verifyCallback(rawBody: string, authHeader: string | null): boolean {
  const m = (authHeader ?? '').match(/^WP3-callback\s+([a-f0-9]+)$/i);
  if (!m) return false;
  return safeEqual(sha512(env('MONRI_KEY') + rawBody), m[1].toLowerCase());
}
