import type { APIRoute } from 'astro';
import { tx } from '../../lib/db';
import { t, toLang } from '../../i18n';

export const POST: APIRoute = async ({ request }) => {
  const b = await request.json().catch(() => ({}));
  const name = String(b?.name ?? '').trim().slice(0, 120);
  const email = String(b?.email ?? '').trim().slice(0, 160);
  const persons = Math.max(1, Math.min(17, Math.floor(Number(b?.persons) || 1)));
  const departureCode = String(b?.departureCode ?? '').slice(0, 10);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: t(toLang(b?.lang)).err.waitlist }, { status: 400 });
  const ok = tx((db) => {
    if (!db.departures.some((d) => d.code === departureCode)) return false;
    db.waitlist.push({ departureCode, name, email, persons, createdAt: new Date().toISOString() });
    return true;
  });
  return ok ? Response.json({ ok: true }) : Response.json({ error: t(toLang(b?.lang)).err.depNotFound }, { status: 404 });
};
