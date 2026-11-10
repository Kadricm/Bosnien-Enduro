// End-to-end test of the booking flow against a running server.
// Usage: node scripts/e2e.mjs [baseUrl]   (MONRI_KEY=... for Monri tests when server runs with PAYMENT_PROVIDER=monri)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:4321';
const DB = path.join(process.cwd(), 'data', 'db.json');
const MONRI_KEY = process.env.MONRI_KEY;
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};
const j = (r) => r.json();
const post = (p, body, headers = {}) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, ...headers }, body: JSON.stringify(body), redirect: 'manual' });
const deps = async () => Object.fromEntries((await j(await fetch(BASE + '/api/departures'))).map((d) => [d.code, d]));
const rider = (bike = 'own', n = 1) => ({ firstName: 'Max', lastName: `Test${n}`, birthDate: '1990-05-05', bike, bikeModel: 'KTM 350 EXC-F', gear: false, level: 'profi' });
const booking = (code, tourId, riders, extra = {}) => ({
  departureCode: code,
  tourId,
  participants: riders,
  singleRooms: 0,
  transfer: { airport: null },
  contact: { firstName: 'Max', lastName: 'Muster', email: 'max@example.com', phone: '+43 1', street: 'Weg 1', zip: '5020', city: 'Salzburg', country: 'Österreich' },
  consents: { agb: true, waiver: true, privacy: true },
  paymentMethod: 'card',
  ...extra,
});
const params = (redirect) => new URL(redirect, BASE).searchParams;

// 0. Server ohne PAYMENT_PROVIDER: Karte muss abgelehnt werden, Mock-Endpoint tot
if (process.env.CARD_OFF) {
  let r0 = await post('/api/bookings', booking('702', 5, [rider()]));
  ok(r0.status === 400, `card booking refused when provider unset → ${r0.status} ${(await j(r0)).error}`);
  r0 = await fetch(`${BASE}/api/payments/mock?ref=x&token=y&result=success`);
  ok(r0.status === 404, `mock endpoint disabled → ${r0.status}`);
  const html0 = await (await fetch(`${BASE}/buchen`)).text();
  ok(!html0.includes('value="card"'), 'card option hidden in wizard');
  r0 = await post('/api/bookings', booking('702', 5, [rider()], { paymentMethod: 'bank' }));
  ok(r0.status === 200, `bank booking still works → ${r0.status}`);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
}

// 1. Verfügbarkeit (Seed)
let d = await deps();
ok(d['708'].status === 'few' && d['708'].freePlaces === 3, `708 shows "${d['708'].label}"`);
ok(d['715'].rentalWarning === 'Nur noch 2 Leihmotorräder', `715 rental warning "${d['715'].rentalWarning}"`);
ok(d['705'].status === 'full', '705 is full (manual)');

// 2. Preis
const q = await j(await post('/api/quote', { tourId: 8, participants: [{ bike: 'own' }, { bike: 'rental' }], singleRooms: 1, transfer: {} }));
ok(q.total === 2190 && q.deposit === 100, `quote example = ${q.total} € / deposit ${q.deposit} €`);

// 3. Validierung
let r = await post('/api/bookings', booking('701', 5, [rider()], { consents: { agb: true } }));
ok(r.status === 400, `missing consents → ${r.status}`);
r = await post('/api/bookings', booking('701', 8, [rider()]));
ok(r.status === 400, `8-day tour on 5-only departure → ${r.status}`);
r = await post('/api/bookings', booking('705', 5, [rider()]));
ok(r.status === 409, `full departure → ${r.status}`);

// 4. Überbuchung
r = await post('/api/bookings', booking('708', 8, [rider(), rider(), rider(), rider()]));
ok(r.status === 409, `4 persons on 708 (3 free) → ${r.status} ${(await j(r)).error}`);
r = await post('/api/bookings', booking('715', 8, [rider('rental'), rider('rental'), rider('rental')]));
ok(r.status === 409, `3 rental bikes on 715 (2 free) → ${r.status}`);

// 5. Kartenbuchung (Mock) + Preis-Manipulation wird ignoriert
r = await post('/api/bookings', { ...booking('708', 8, [rider('own', 1), rider('rental', 2)]), quote: { total: 1, deposit: 1 }, total: 1 });
const card = await j(r);
ok(r.status === 200 && card.redirect.startsWith('/buchen/bezahlen'), `card booking ${card.ref} → ${card.redirect?.split('?')[0]}`);
let db = JSON.parse(fs.readFileSync(DB, 'utf8'));
let bk = db.bookings.find((b) => b.ref === card.ref);
ok(bk.quote.total === 2050 && bk.quote.deposit === 100, `server price used (total ${bk.quote.total} €), client price ignored`);
d = await deps();
ok(d['708'].freePlaces === 1, `hold counts: 708 now ${d['708'].label}`);

const cp = params(card.redirect);
r = await fetch(`${BASE}/buchen/bestaetigung?ref=${cp.get('ref')}&token=wrong`);
ok(r.status === 404, `wrong token → ${r.status}`);

const outboxCount = () => (fs.existsSync('data/outbox') ? fs.readdirSync('data/outbox').filter((f) => f.includes('max_example')).length : 0);
const before = outboxCount();
r = await fetch(`${BASE}/api/payments/mock?${cp}&result=success`, { redirect: 'manual' });
ok(r.status === 302 && r.headers.get('location').startsWith('/buchen/bestaetigung'), 'mock payment → confirmation');
r = await fetch(`${BASE}/api/payments/mock?${cp}&result=success`, { redirect: 'manual' });
ok(outboxCount() - before === 1, `payment processed once (confirmation mails to guest: ${outboxCount() - before})`);
db = JSON.parse(fs.readFileSync(DB, 'utf8'));
bk = db.bookings.find((b) => b.ref === card.ref);
ok(bk.status === 'confirmed' && bk.paymentStatus === 'paid', `booking status ${bk.status}/${bk.paymentStatus}`);
const page = await (await fetch(`${BASE}/buchen/bestaetigung?${cp}`)).text();
ok(page.includes('Fix gebucht'), 'confirmation page shows "Fix gebucht"');

// 6. Abgelaufener Hold gibt Plätze frei; späte Zahlung wird markiert
r = await post('/api/bookings', booking('708', 8, [rider()]));
const late = await j(r);
d = await deps();
ok(d['708'].status === 'full', '708 now full (last place on hold)');
db = JSON.parse(fs.readFileSync(DB, 'utf8'));
db.bookings.find((b) => b.ref === late.ref).expiresAt = new Date(Date.now() - 1000).toISOString();
fs.writeFileSync(DB, JSON.stringify(db));
d = await deps();
ok(d['708'].freePlaces === 1, 'expired hold released the place');
const other = await j(await post('/api/bookings', booking('708', 8, [rider()])));
ok(!!other.ref, `someone else took the place (${other.ref})`);
await fetch(`${BASE}/api/payments/mock?${params(other.redirect)}&result=success`, { redirect: 'manual' });
await fetch(`${BASE}/api/payments/mock?${params(late.redirect)}&result=success`, { redirect: 'manual' });
db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const lateB = db.bookings.find((b) => b.ref === late.ref);
ok(lateB.status === 'confirmed' && lateB.needsAttention === 'late_full', `late payment flagged for admin: "${lateB.needsAttention}"`);

// 6b. Englisch: Fehler, Preiszeilen und Weiterleitung in EN
r = await post('/api/bookings', booking('708', 8, [rider(), rider(), rider()], { lang: 'en' }));
ok(/places left|fully booked/.test((await j(r)).error), 'EN booking error is English');
const qEn = await j(await post('/api/quote', { lang: 'en', tourId: 5, participants: [{ bike: 'rental' }], singleRooms: 0, transfer: {} }));
ok(qEn.lines[0].label.includes('rental bike'), `EN quote line: "${qEn.lines[0].label}"`);
const en = await j(await post('/api/bookings', booking('711', 8, [rider()], { lang: 'en', paymentMethod: 'bank' })));
ok(en.redirect?.startsWith('/en/buchen/bestaetigung'), `EN booking redirects to ${en.redirect?.split('?')[0]}`);
const enPage = await (await fetch(BASE + en.redirect)).text();
ok(enPage.includes('Places reserved') && enPage.includes('lang="en"'), 'EN confirmation page is English');
for (const path of ['/en', '/en/termine', '/en/buchen', '/en/verleih', '/en/hotel', '/en/ueber-uns', '/en/galerie', '/en/touren/5-tage-enduro-tour', '/touren/8-tage-enduro-tour', '/verleih', '/hotel', '/ueber-uns', '/galerie']) {
  const rr = await fetch(BASE + path);
  ok(rr.status === 200, `GET ${path} → ${rr.status}`);
}
ok((await fetch(BASE + '/fr/termine')).status === 404, 'unknown language prefix → 404');
ok((await fetch(BASE + '/touren/nope')).status === 404, 'unknown tour → 404');

// 7. Banküberweisung + Admin
r = await post('/api/bookings', booking('710', 8, [rider(), rider('own', 2)], { paymentMethod: 'bank' }));
const bank = await j(r);
ok(bank.redirect.startsWith('/buchen/bestaetigung'), 'bank booking → confirmation with bank details');
const bankPage = await (await fetch(BASE + bank.redirect)).text();
ok(bankPage.includes('Plätze reserviert') && bankPage.includes(bank.ref), 'bank page shows reference');
r = await fetch(BASE + '/api/admin', { method: 'POST', headers: { Origin: BASE }, body: new URLSearchParams({ action: 'mark_paid', ref: bank.ref }), redirect: 'manual' });
ok(r.status === 401, `admin action without login → ${r.status}`);
r = await fetch(BASE + '/admin', { method: 'POST', headers: { Origin: BASE }, body: new URLSearchParams({ password: 'wrong' }), redirect: 'manual' });
ok(!r.headers.get('set-cookie'), 'wrong admin password → no cookie');
r = await fetch(BASE + '/admin', { method: 'POST', headers: { Origin: BASE }, body: new URLSearchParams({ password: 'demo' }), redirect: 'manual' });
const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
ok(cookie.startsWith('be_admin='), 'admin login sets cookie');
r = await fetch(BASE + '/api/admin', { method: 'POST', headers: { Origin: BASE, Cookie: cookie }, body: new URLSearchParams({ action: 'mark_paid', ref: bank.ref, back: 'https://evil.example' }), redirect: 'manual' });
ok(r.status === 303 && r.headers.get('location') === '/admin', `admin mark_paid → ${r.status}, no open redirect`);
db = JSON.parse(fs.readFileSync(DB, 'utf8'));
ok(db.bookings.find((b) => b.ref === bank.ref).status === 'confirmed', 'bank booking confirmed by admin');
const adminPage = await (await fetch(BASE + '/admin?status=all&alang=de', { headers: { Cookie: cookie } })).text();
ok(adminPage.includes(bank.ref) && adminPage.includes('Achtung'), 'admin page lists bookings + attention box');
const adm = (body) => fetch(BASE + '/api/admin', { method: 'POST', headers: { Origin: BASE, Cookie: cookie }, body: new URLSearchParams(body), redirect: 'manual' });
const msgOf = (r) => new URL(r.headers.get('location'), BASE).searchParams.get('msg');
const bsPage = await (await fetch(BASE + '/admin?alang=bs', { headers: { Cookie: cookie } })).text();
ok(bsPage.includes('Rezervacije') && bsPage.includes('Ručna rezervacija'), 'admin in Bosnian');
ok((await (await fetch(BASE + '/admin?alang=en', { headers: { Cookie: cookie } })).text()).includes('Manual booking'), 'admin in English');

// Manuelle Buchung: gleiche Kapazitätsprüfung, läuft nicht ab
d = await deps();
const free714 = d['714'].freePlaces;
r = await adm({ action: 'manual_booking', code: '714', tourId: '8', own: '2', rental: '1', firstName: 'Tel', lastName: 'Gast', phone: '+387', paid: 'on' });
ok(/^booking_ok:/.test(msgOf(r)), `manual booking → ${msgOf(r)}`);
d = await deps();
ok(d['714'].freePlaces === free714 - 3, `manual booking takes 3 places (${free714} → ${d['714'].freePlaces})`);
db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const man = db.bookings.find((b) => b.ref === msgOf(r).split(':')[1]);
ok(man.status === 'confirmed' && man.expiresAt === null && man.paymentMethod === 'manual', 'manual booking confirmed, no expiry');
r = await adm({ action: 'manual_booking', code: '714', tourId: '8', own: '17', rental: '0', firstName: 'Zu', lastName: 'Viel' });
ok(/^err:/.test(msgOf(r)), `manual overbooking refused → ${msgOf(r)}`);

// CSV-Export
r = await fetch(BASE + '/api/admin/export?code=714');
ok(r.status === 401, `export without login → ${r.status}`);
const csvBytes = new Uint8Array(await (await fetch(BASE + '/api/admin/export?code=714', { headers: { Cookie: cookie } })).arrayBuffer());
const csv = new TextDecoder().decode(csvBytes);
ok(csvBytes[0] === 0xef && csv.split('\r\n').length === 4 && csv.includes('"Tel"') && csv.includes('"+387"'), 'CSV: BOM, header + 3 riders, phone kept');

// Termine anlegen / löschen / Saison kopieren
r = await adm({ action: 'dep_add', code: '799', start: '2027-11-10', end: '2027-11-14', tours: '5', places: '10', rental: '5' });
ok(msgOf(r) === 'ok' && (await deps())['799']?.freePlaces === 10, 'add date 799');
ok(msgOf(await adm({ action: 'dep_add', code: '799', start: '2027-11-10', end: '2027-11-14', tours: '5', places: '10', rental: '5' })) === 'dep_exists', 'duplicate code refused');
ok(msgOf(await adm({ action: 'dep_add', code: '798', start: '2027-11-14', end: '2027-11-10', tours: '5', places: '10', rental: '5' })) === 'dep_invalid', 'end before start refused');
ok(msgOf(await adm({ action: 'dep_delete', code: '714' })) === 'dep_has_bookings', 'cannot delete date with bookings');
r = await adm({ action: 'dep_delete', code: '799' });
ok(msgOf(r) === 'ok' && !(await deps())['799'], 'delete empty date');
r = await adm({ action: 'copy_season', year: '2027' });
d = await deps();
ok(msgOf(r) === 'copied:31' && d['801']?.start === '2028-04-05' && d['801'].status === 'free', `copy season 2027 → 2028 (${msgOf(r)}, 801 starts ${d['801']?.start})`);
ok(msgOf(await adm({ action: 'copy_season', year: '2027' })) === 'copied:0', 'copying twice adds nothing');

// 8. Monri (nur wenn Server mit PAYMENT_PROVIDER=monri läuft)
if (MONRI_KEY) {
  const sha = (s) => crypto.createHash('sha512').update(s).digest('hex');
  const m = await j(await post('/api/bookings', booking('712', 8, [rider()])));
  const html = await (await fetch(BASE + m.redirect)).text();
  const field = (n) => html.match(new RegExp(`name="${n}" value="([^"]*)"`))?.[1]?.replace(/&amp;/g, '&');
  const on = field('order_number');
  ok(html.includes('ipgtest.monri.com/v2/form'), 'payment page posts to Monri test form');
  ok(field('digest') === sha(MONRI_KEY + on + '10000' + 'EUR') && field('amount') === '10000', `form digest valid (order ${on}, amount 10000 cents)`);

  const body = JSON.stringify({ order_number: on, amount: 10000, status: 'approved', response_code: '0000' });
  r = await fetch(BASE + '/api/payments/monri/callback', { method: 'POST', headers: { authorization: 'WP3-callback deadbeef', 'Content-Type': 'application/json' }, body });
  ok(r.status === 401, `callback with bad digest → ${r.status}`);
  r = await fetch(BASE + '/api/payments/monri/callback', { method: 'POST', headers: { authorization: `WP3-callback ${sha(MONRI_KEY + body)}`, 'Content-Type': 'application/json' }, body });
  ok(r.status === 200, `callback with valid digest → ${r.status}`);
  db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  ok(db.bookings.find((b) => b.ref === m.ref).status === 'confirmed', 'Monri callback confirmed booking');
  r = await fetch(BASE + '/api/payments/monri/callback', { method: 'POST', headers: { authorization: `WP3-callback ${sha(MONRI_KEY + body)}`, 'Content-Type': 'application/json' }, body });
  db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  ok(r.status === 200 && !db.bookings.find((b) => b.ref === m.ref).needsAttention, 'same callback repeated → ignored (idempotent)');
  const body2 = JSON.stringify({ order_number: `${m.ref}-second`, amount: 10000, status: 'approved', response_code: '0000' });
  await fetch(BASE + '/api/payments/monri/callback', { method: 'POST', headers: { authorization: `WP3-callback ${sha(MONRI_KEY + body2)}`, 'Content-Type': 'application/json' }, body: body2 });
  db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  ok(db.bookings.find((b) => b.ref === m.ref).needsAttention === 'double_payment', 'second real payment (other tab) → flagged "Doppelzahlung"');

  // Rückleitung (Browser) für eine zweite Buchung
  const m2 = await j(await post('/api/bookings', booking('713', 8, [rider()])));
  const html2 = await (await fetch(BASE + m2.redirect)).text();
  const succ = html2.match(/name="success_url_override" value="([^"]*)"/)[1].replace(/&amp;/g, '&');
  const on2 = html2.match(/name="order_number" value="([^"]*)"/)[1];
  const ret = `${succ}&order_number=${on2}&amount=10000&currency=EUR&response_code=0000`;
  r = await fetch(`${ret}&digest=${'0'.repeat(128)}`, { redirect: 'manual' });
  ok(r.headers.get('location')?.includes('failed=1'), 'return with forged digest → not paid');
  r = await fetch(`${ret}&digest=${sha(MONRI_KEY + ret)}`, { redirect: 'manual' });
  ok(r.headers.get('location')?.startsWith('/buchen/bestaetigung'), 'return with valid digest → confirmation');
  db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  ok(db.bookings.find((b) => b.ref === m2.ref).status === 'confirmed', 'Monri return confirmed booking');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
