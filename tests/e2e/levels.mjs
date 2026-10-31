// Screenshot every level (overview) through a real two-player session.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = new URL('./out/levels/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  await page.goto(BASE);
  await page.waitForSelector('#screen-home:not([hidden])');
  await page.fill('#name-input', name);
  return page;
}
const a = await player('Ava');
await a.click('#btn-create');
await a.waitForSelector('#screen-lobby:not([hidden])');
const code = (await a.textContent('#room-code')).trim();
const b = await player('Ben');
await b.fill('#code-input', code);
await b.click('#btn-join');
await b.waitForSelector('#screen-lobby:not([hidden])');
const ids = await a.evaluate(() => [...document.querySelectorAll('.level-card')].map((c) => c.dataset.level));
for (const id of ids) {
  await a.waitForSelector('#screen-lobby:not([hidden])');
  await a.click(`.level-card[data-level="${id}"]`);
  await sleep(200);
  await a.click('#btn-ready');
  await b.click('#btn-ready');
  await a.waitForFunction(() => window.__duality.session.state?.phase === 'playing', null, { timeout: 10000 });
  await sleep(400);
  await a.screenshot({ path: `${OUT}${id}-play.png` });
  await a.keyboard.press('Tab');
  await sleep(900);
  await a.screenshot({ path: `${OUT}${id}-overview.png` });
  await a.keyboard.press('Tab');
  const fps = await a.evaluate(() => window.__duality.scene.fps);
  console.log(id, 'fps', fps);
  await a.evaluate(() => window.__duality.session.send('lobby'));
  await sleep(300);
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
