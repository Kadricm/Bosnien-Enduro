// Einfacher Admin-Login (Passwort aus ENV, signiertes Cookie).
// shortcut: Für Produktion mit mehreren Nutzern auf Supabase Auth (Magic Link) umstellen.
import crypto from 'node:crypto';
import type { AstroCookies } from 'astro';
import { safeEqual } from './db';

const env = (k: string) => process.env[k] ?? import.meta.env[k] ?? '';
const COOKIE = 'be_admin';

const secret = () => env('SESSION_SECRET') || 'dev-secret-nur-lokal';
const password = () => env('ADMIN_PASSWORD') || (import.meta.env.DEV ? 'demo' : '');

function sign(value: string) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

export function login(cookies: AstroCookies, pw: string): boolean {
  const expected = password();
  if (!expected || !safeEqual(pw, expected)) return false;
  const exp = String(Date.now() + 7 * 86_400_000);
  cookies.set(COOKIE, `${exp}.${sign(exp)}`, { path: '/', httpOnly: true, sameSite: 'strict', secure: !import.meta.env.DEV, maxAge: 7 * 86400 });
  return true;
}

export function logout(cookies: AstroCookies) {
  cookies.delete(COOKIE, { path: '/' });
}

export function isAdmin(cookies: AstroCookies): boolean {
  const v = cookies.get(COOKIE)?.value ?? '';
  const [exp, sig] = v.split('.');
  return !!exp && !!sig && safeEqual(sig, sign(exp)) && Number(exp) > Date.now();
}
