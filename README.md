# bosnien-endurotours – Faza 0 (demo)

Astro 7 (SSR, Vercel adapter) + Tailwind 4. Plan: bosnien-endurotours-PLAN.md (§11 Faza 0).

## Pokretanje

```
npm install
cp .env.example .env      # za lokalno: ADMIN_PASSWORD=demo, PAYMENT_PROVIDER=mock
npm run dev               # http://localhost:4321
npm test                  # unit testovi (cijene, raspoloživost)
npm run e2e               # cijeli tok rezervacije protiv pokrenutog servera
```

- `/` početna · `/termine` · `/buchen` wizard (5 koraka) · `/touren/5-tage-enduro-tour` · `/touren/8-tage-enduro-tour` · `/verleih` · `/hotel` · `/ueber-uns` · `/galerie` · `/admin` (lozinka iz `ADMIN_PASSWORD`, samo njemački)
- **Engleski:** iste stranice pod `/en/...`. Tekstovi su u `src/i18n.ts` (UI, booking, mailovi) i `src/content.ts` (sadržaj stranica). Rezervacija pamti jezik, pa su plaćanje, potvrda i mailovi gostu na njegovom jeziku. Mailovi adminu su uvijek na njemačkom.
- **Admin (`/admin`):** na bosanskom (default), njemačkom i engleskom, preklopnik BS/DE/EN gore desno. Tu se vode rezervacije, ručna rezervacija (telefon/WhatsApp, ista provjera kapaciteta, bez roka), novi termin, brisanje praznog termina, kopiranje sezone (+52 sedmice, šifre 7xx → 8xx) i Excel lista učesnika po terminu.
- Godina sezone se ne upisuje ručno, nego se čita iz termina u bazi (`seasonLabel()`).
- Demo podaci se prave sami u `data/db.json` (obriši folder za reset). Mailovi bez Resend ključa idu u `data/outbox/*.html`.

## Kako radi rezervacija

1. Gost bira turu, termin, učesnike i dodatke. Cijenu **uvijek računa server** (`src/lib/pricing.ts`), a ono što pošalje browser se ignoriše.
2. `POST /api/bookings` ponovo provjeri slobodna mjesta i motore iz najma i napravi rezervaciju `pending_payment` s rokom:
   - karta: **20 min** (mjesta su zauzeta dok gost plaća)
   - bankovni transfer: **5 dana**
3. Kad rok istekne, mjesta se automatski oslobađaju (bez crona, provjera ide pri svakom čitanju).
4. Plaćanje → `confirmed` + mail gostu i adminu. Svaka uplata se knjiži samo jednom (idempotentno).
5. Ako uplata stigne poslije isteka, a termin je u međuvremenu pun, rezervacija se potvrdi, ali dobije crvenu oznaku „Achtung“ u adminu.

## Online plaćanje (Monri)

Kod je spreman (`src/lib/monri.ts`, `src/pages/api/payments/monri/*`). Koraci:

1. **Dario** potpiše ugovor za internet naplatu (e-commerce) s bankom u BiH koja radi s Monrijem (UniCredit, Raiffeisen, Intesa…). Treba tražiti:
   - naplatu u **EUR** (ili BAM ako EUR ne ide, pa onda mijenjamo `MONRI_CURRENCY`)
   - visinu provizije
   - test shop
2. Iz Monri admin panela uzmeš `Authenticity token` i `Key` → upišeš ih u Vercel env:
   ```
   PAYMENT_PROVIDER=monri
   MONRI_ENV=test
   MONRI_AUTHENTICITY_TOKEN=...
   MONRI_KEY=...
   PUBLIC_SITE_URL=https://<tačna-domena>
   ```
3. U Monri panelu kao Callback URL upišeš `https://<domena>/api/payments/monri/callback`.
4. Probna plaćanja s Monri test karticama. Pokreni `MONRI_KEY=... npm run e2e` protiv servera s `PAYMENT_PROVIDER=monri`.
5. Kad sve prođe: `MONRI_ENV=production`, pa se zamijene ključevi produkcijskim.

Sigurnost: potpis forme je `SHA512(key + order_number + amount + currency)`. Povratak i callback se provjeravaju digestom, pa krivotvorena potvrda ne prolazi. Dvostruka uplata (npr. gost plati u dva taba) i uplata za storniranu rezervaciju dobiju oznaku „Achtung“ u adminu i šalje se mail adminu.

⚠️ Integracija je napisana po Monri WebPay v2 dokumentaciji, ali **nije još testirana protiv pravog Monrija**. E2E testovi koriste istu formulu kao kod. Oni dokazuju da krivotvoreni digest ne prolazi, ali ne i da Monri prihvata našu formu. Na test shopu treba potvrditi:
- sve tri formule digesta (forma, povratak, callback)
- da je povratak GET i da je `digest` zadnji parametar
- da override URL-ovi smiju imati `?ref=&token=`
- da je callback JSON (ako je form-encoded, Astro origin check ga odbija s 403, pa treba izuzetak)
- naplatu u EUR i `language=de`

**`PAYMENT_PROVIDER`:** `monri`, `mock` (samo demo) ili prazno. Prazno znači da je kartica isključena i nudi se samo transfer. Na produkciji nikad ne smije biti `mock`.

**Bankovni transfer** radi odmah. Za njega upišeš `BANK_*` u env, a admin ručno klikne „Anzahlung erhalten“.

## Prije produkcije (nije u demu)

- **Baza:** `src/lib/db.ts` je JSON fajl. Na Vercelu je to `/tmp` posebno za svaku instancu, pa demo tamo **puca**: rezervacija napravljena na jednoj instanci može dati 404 na drugoj. Za link Dariju treba prvo Supabase.
- Pri prelasku na Supabase provjera kapaciteta i upis rezervacije moraju biti **jedna Postgres transakcija** (RPC funkcija sa `SELECT … FOR UPDATE` na terminu). Inače dvije istovremene rezervacije mogu uzeti zadnje mjesto. To je glavni dio posla, a ostatak koda ide preko `tx()/read()` u `booking.ts`.
- `RESEND_API_KEY` i verifikovana domena za mailove.
- AGB/Haftungsausschluss/Datenschutz linkovi u koraku 4 (sada `#`).
- Stavke `TODO(confirm-with-client)` u `src/data/seed.ts` (cijene, kapaciteti, transfer, akontacija).
