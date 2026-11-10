// Browser click-through of the booking wizard + screenshots.
// Usage: NODE_PATH=$(npm root -g) node scripts/ui-check.mjs <outDir>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.env.NODE_PATH || ''] }));

const BASE = 'http://localhost:4321';
const OUT = process.argv[2] || '.';
const browser = await chromium.launch();
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
};

async function run(name, viewport, method, pre = '') {
  const page = await browser.newPage({ viewport });
  watch(page);
  await page.goto(BASE + pre + '/');
  await page.screenshot({ path: `${OUT}/${name}-home.png`, fullPage: true });
  await page.goto(BASE + pre + '/termine?tour=8');
  await page.screenshot({ path: `${OUT}/${name}-termine.png` });

  await page.goto(BASE + pre + '/buchen?termin=709&tour=8');
  await page.waitForSelector('input[name=dep][value="709"]:checked');
  await page.screenshot({ path: `${OUT}/${name}-step1.png` });
  await page.click('#next');

  await page.selectOption('#count', '2');
  for (const i of [0, 1]) {
    await page.fill(`[name=r_firstName_${i}]`, i ? 'Anna' : 'Max');
    await page.fill(`[name=r_lastName_${i}]`, 'Muster');
    await page.fill(`[name=r_birthDate_${i}]`, '1988-04-12');
  }
  await page.check('[name=r_bike_1][value=rental]');
  await page.check('[name=r_gear_1]');
  await page.screenshot({ path: `${OUT}/${name}-step2.png`, fullPage: true });
  await page.click('#next');

  await page.selectOption('#singleRooms', '1');
  await page.selectOption('[name=airport]', 'Split (SPU)');
  await page.waitForTimeout(400);
  await page.click('#next');

  // Pflichtfelder leer → darf nicht weiter
  await page.click('#next');
  const stillStep4 = await page.isVisible('[data-step="3"]');
  await page.fill('[name=c_firstName]', 'Max');
  await page.fill('[name=c_lastName]', 'Muster');
  await page.fill('[name=c_email]', 'max@example.com');
  await page.fill('[name=c_phone]', '+43 660 000000');
  await page.fill('[name=c_street]', 'Bergstraße 5');
  await page.fill('[name=c_zip]', '5020');
  await page.fill('[name=c_city]', 'Salzburg');
  for (const c of ['agb', 'waiver', 'privacy']) await page.check(`[name=${c}]`);
  await page.click('#next');
  await page.check(`[name=paymentMethod][value=${method}]`);
  await page.waitForTimeout(400);
  const total = await page.textContent('#sum-total');
  await page.screenshot({ path: `${OUT}/${name}-step5.png`, fullPage: true });
  await page.click('#submit');
  await page.waitForURL(/\/buchen\/(bezahlen|bestaetigung)/);
  if (method === 'card') {
    await page.screenshot({ path: `${OUT}/${name}-pay.png` });
    await page.click('a[href*="result=success"]');
    await page.waitForURL(/bestaetigung/);
  }
  await page.screenshot({ path: `${OUT}/${name}-done.png`, fullPage: true });
  const heading = await page.textContent('h1');
  console.log(`${name}: blocked-empty-step4=${stillStep4} total=${total} → "${heading.trim()}"`);
  await page.close();
}

await run('desktop', { width: 1366, height: 900 }, 'card');
await run('mobile', { width: 390, height: 844 }, 'bank');
await run('en-desktop', { width: 1366, height: 900 }, 'card', '/en');

const shots = await browser.newPage({ viewport: { width: 1366, height: 900 } });
watch(shots);
for (const [n, u] of [['p-tour', '/touren/8-tage-enduro-tour'], ['p-verleih', '/verleih'], ['p-hotel', '/en/hotel'], ['p-about', '/ueber-uns'], ['p-galerie', '/galerie']]) {
  await shots.goto(BASE + u);
  await shots.screenshot({ path: `${OUT}/${n}.png` });
}
await shots.goto(BASE + '/');
await shots.hover('button:has-text("Touren")');
await shots.waitForTimeout(300);
await shots.screenshot({ path: `${OUT}/header-top.png`, clip: { x: 0, y: 0, width: 1366, height: 420 } });
await shots.mouse.wheel(0, 900);
await shots.waitForTimeout(500);
await shots.screenshot({ path: `${OUT}/header-scrolled.png`, clip: { x: 0, y: 0, width: 1366, height: 200 } });
await shots.goto(BASE + '/galerie');
await shots.click('a[data-i="3"]');
await shots.waitForTimeout(600);
await shots.screenshot({ path: `${OUT}/lightbox.png` });
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
watch(mob);
await mob.goto(BASE + '/en');
await mob.screenshot({ path: `${OUT}/m-home.png` });
await mob.click('#menu-open');
await mob.waitForTimeout(300);
await mob.screenshot({ path: `${OUT}/m-menu.png` });

const admin = await browser.newPage({ viewport: { width: 1366, height: 900 } });
watch(admin);
await admin.goto(BASE + '/admin');
await admin.fill('[name=password]', 'demo');
await admin.click('form button.btn-primary');
await admin.waitForSelector('text=Termini i popunjenost');
await admin.screenshot({ path: `${OUT}/admin.png`, fullPage: true });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no browser errors');
await browser.close();
