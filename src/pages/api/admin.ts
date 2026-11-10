import type { APIRoute } from 'astro';
import { isAdmin } from '../../lib/auth';
import { findBooking, tx } from '../../lib/db';
import { handlePaid } from '../../lib/onPaid';
import { BookingError } from '../../lib/booking';
import { addDeparture, copySeason, deleteDeparture, manualBooking } from '../../lib/admin';

// Formular-Aktionen aus /admin (POST, gleiche Origin – Astro prüft die Origin bei Formularen).
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!isAdmin(cookies)) return new Response('Unauthorized', { status: 401 });
  const f = await request.formData();
  const action = String(f.get('action'));
  const ref = String(f.get('ref') ?? '');
  const code = String(f.get('code') ?? '');
  const now = new Date().toISOString();
  const num = (k: string) => Number(f.get(k));
  const str = (k: string, max = 200) => String(f.get(k) ?? '').trim().slice(0, max);
  let msg = '';

  switch (action) {
    case 'mark_paid': {
      const b = tx((db) => findBooking(db, ref));
      if (b && b.paymentStatus !== 'paid') await handlePaid(ref, `bank-${now}`, b.quote.deposit, 'bank');
      break;
    }
    case 'cancel':
      tx((db) => {
        const b = findBooking(db, ref);
        if (b && b.status !== 'cancelled') {
          b.status = 'cancelled';
          b.expiresAt = null;
          b.log.push({ at: now, msg: 'Storniert (Admin)' });
        }
      });
      break;
    case 'extend':
      tx((db) => {
        const b = findBooking(db, ref);
        if (b && (b.status === 'pending_payment' || b.status === 'expired')) {
          b.status = 'pending_payment';
          b.expiresAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
          b.log.push({ at: now, msg: 'Reservierung um 5 Tage verlängert (Admin)' });
        }
      });
      break;
    case 'clear_flag':
      tx((db) => {
        const b = findBooking(db, ref);
        if (b) b.needsAttention = null;
      });
      break;
    case 'dep_status':
      tx((db) => {
        const d = db.departures.find((x) => x.code === code);
        const v = String(f.get('value'));
        if (d) d.manualStatus = v === 'closed' || v === 'full' ? v : null;
      });
      break;
    case 'dep_capacity':
      tx((db) => {
        const d = db.departures.find((x) => x.code === code);
        const p = Math.floor(Number(f.get('places')));
        const r = Math.floor(Number(f.get('rental')));
        if (d && p >= 0 && p <= 60 && r >= 0 && r <= 40) [d.capacityPlaces, d.capacityRentalBikes] = [p, r];
      });
      break;
    case 'dep_add':
      msg = addDeparture({ code: str('code', 10), start: str('start', 10), end: str('end', 10), tours: f.getAll('tours').map(Number), places: num('places'), rental: num('rental') });
      break;
    case 'dep_delete':
      msg = deleteDeparture(code);
      break;
    case 'copy_season':
      msg = `copied:${copySeason(Math.floor(num('year')))}`;
      break;
    case 'manual_booking':
      try {
        const b = manualBooking({
          departureCode: str('code', 10),
          tourId: num('tourId'),
          own: num('own'),
          rental: num('rental'),
          firstName: str('firstName', 80),
          lastName: str('lastName', 80),
          email: str('email', 160).toLowerCase(),
          phone: str('phone', 40),
          singleRooms: num('singleRooms'),
          notes: str('notes', 2000),
          paid: f.get('paid') === 'on',
        });
        msg = `booking_ok:${b.ref}`;
      } catch (e) {
        if (!(e instanceof BookingError)) throw e;
        msg = `err:${e.message}`;
      }
      break;
  }
  const back = String(f.get('back') ?? '');
  const to = new URL(/^\/admin(\/|\?|$)/.test(back) ? back : '/admin', 'http://x');
  if (msg) to.searchParams.set('msg', msg);
  else to.searchParams.delete('msg');
  return redirect(to.pathname + to.search, 303);
};
