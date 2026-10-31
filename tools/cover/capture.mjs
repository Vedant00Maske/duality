// Captures clean (UI-hidden) gameplay shots for the cover image from a running dev/prod server.
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function player(name) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
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
for (const [id, file, moves] of [['w1_l1_first_contact', 'shot2.png', 700], ['w3_l8_split_signal', 'shot1.png', 0]]) {
  await a.click(`.level-card[data-level="${id}"]`);
  await sleep(200);
  await a.click('#btn-ready'); await b.click('#btn-ready');
  await a.waitForFunction(() => window.__duality.session.state?.phase === 'playing', null, { timeout: 10000 });
  if (moves) {
    await a.keyboard.down('ArrowRight'); await b.keyboard.down('ArrowRight');
    await sleep(moves);
    await a.keyboard.press('Space');
    await sleep(180);
    await a.keyboard.up('ArrowRight'); await b.keyboard.up('ArrowRight');
  } else await sleep(1500);
  await a.addStyleTag({ content: '#ui{display:none!important}' });
  await sleep(250);
  await a.screenshot({ path: path.join(here, file) });
  await a.addStyleTag({ content: '#ui{display:block!important}' });
  await a.evaluate(() => window.__duality.session.send('lobby'));
  await sleep(400);
}
await browser.close();
console.log('captured');
