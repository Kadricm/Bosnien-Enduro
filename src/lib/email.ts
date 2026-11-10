// E-Mails über Resend. Ohne RESEND_API_KEY werden sie als HTML in data/outbox/ gespeichert (Demo).
// Gast-Mails in der Sprache der Buchung, Admin-Mails immer Deutsch.
import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../data/seed';
import type { Booking } from './db';
import { bankDetails, siteUrl } from './config';
import { fmtDate, eur } from './format';
import { t, type Lang } from '../i18n';

const env = (k: string) => process.env[k] ?? import.meta.env[k] ?? '';

async function send(to: string, subject: string, html: string) {
  const key = env('RESEND_API_KEY');
  if (!key) {
    const dir = process.env.VERCEL ? '/tmp/outbox' : path.join(process.cwd(), 'data', 'outbox');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${to.replace(/[^a-z0-9]/gi, '_')}.html`);
    fs.writeFileSync(file, `<!-- To: ${to} | Subject: ${subject} -->\n${html}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM'), to, subject, html }),
  });
  if (!res.ok) console.error('Resend error', res.status, await res.text());
}

// Mailfehler dürfen die Buchung nie kaputt machen.
async function safeSend(to: string, subject: string, html: string) {
  try {
    await send(to, subject, html);
  } catch (e) {
    console.error('Mail failed', e);
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function summary(b: Booking, departure: { start: string; end: string }, lang: Lang) {
  const M = t(lang).mail;
  const lines = b.quote.lines.map((l) => `<tr><td>${esc(l.label)}</td><td align="right">${eur(l.amount, lang)}</td></tr>`).join('');
  return `
  <p><b>${M.refLabel}:</b> ${b.ref}<br><b>${M.tour}:</b> ${t(lang).tourName[b.tourId]}<br><b>${M.date}:</b> ${b.departureCode} · ${fmtDate(departure.start)} – ${fmtDate(departure.end)}<br>
  <b>${M.participants}:</b> ${b.participants.map((p) => esc(`${p.firstName} ${p.lastName}`)).join(', ')}</p>
  <table cellpadding="4" style="border-collapse:collapse;width:100%;max-width:520px">${lines}
  <tr><td><b>${M.total}</b></td><td align="right"><b>${eur(b.quote.total, lang)}</b></td></tr>
  <tr><td>${M.deposit}</td><td align="right">${eur(b.quote.deposit, lang)}</td></tr>
  <tr><td>${M.rest}</td><td align="right">${eur(b.quote.balance, lang)}</td></tr></table>`;
}

const wrap = (body: string, lang: Lang) =>
  `<div style="font-family:Arial,sans-serif;font-size:15px;color:#141414;line-height:1.5">${body}<p>${t(lang).mail.sign}<br>Paloč bb., 70280 Gornji Vakuf-Uskoplje · +43 660 1877869</p></div>`;

const langOf = (b: Booking): Lang => b.locale ?? 'de';

export async function mailBankInstructions(b: Booking, dep: { start: string; end: string }) {
  if (!b.contact.email) return; // manuelle Buchung ohne E-Mail
  const lang = langOf(b);
  const M = t(lang).mail;
  const bank = bankDetails();
  await safeSend(
    b.contact.email,
    M.bankSubject(b.ref),
    wrap(
      `<p>${M.hello(esc(b.contact.firstName))}</p><p>${M.bankIntro(settings.holdDaysBank)}</p>
    <p><b>${M.amount}:</b> ${eur(b.quote.deposit, lang)}<br><b>${M.holder}:</b> ${esc(bank.holder)}<br><b>${M.bank}:</b> ${esc(bank.name)}<br><b>IBAN:</b> ${esc(bank.iban)}<br><b>SWIFT/BIC:</b> ${esc(bank.swift)}<br><b>${M.purpose}:</b> ${b.ref}</p>
    <p>${M.swiftNote}</p>${summary(b, dep, lang)}`,
      lang,
    ),
  );
}

export async function mailConfirmed(b: Booking, dep: { start: string; end: string }) {
  if (!b.contact.email) return; // manuelle Buchung ohne E-Mail
  const lang = langOf(b);
  const M = t(lang).mail;
  await safeSend(
    b.contact.email,
    M.confSubject(b.ref),
    wrap(`<p>${M.hello(esc(b.contact.firstName))}</p><p>${M.confIntro}</p>${summary(b, dep, lang)}<p>${M.confOutro}</p>`, lang),
  );
}

export async function mailAdmin(subject: string, b: Booking, dep: { start: string; end: string }) {
  const to = env('ADMIN_NOTIFY_EMAIL');
  if (!to) return;
  await safeSend(
    to,
    `${subject}: ${b.ref} (${b.participants.length} Pers., Termin ${b.departureCode}, ${langOf(b).toUpperCase()})`,
    wrap(
      `<p>${esc(subject)}</p><p><b>Kontakt:</b> ${esc(`${b.contact.firstName} ${b.contact.lastName}`)}, ${esc(b.contact.email)}, ${esc(b.contact.phone)}</p>${summary(b, dep, 'de')}
    <p><a href="${siteUrl()}/admin">Zum Admin-Bereich</a></p>`,
      'de',
    ),
  );
}
