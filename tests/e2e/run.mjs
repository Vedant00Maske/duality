// Two-browser end-to-end smoke test using the locally installed Microsoft Edge.
// Usage: node tests/e2e/run.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
async function player(name, viewport = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror ${e.message}`));
  await page.goto(BASE);
  await page.waitForSelector('#screen-home:not([hidden])', { timeout: 15000 });
  await page.evaluate(() => window.__duality.ui?.openPlay?.());
  await page.fill('#name-input', name);
  return page;
}

const a = await player('Ava');
await a.screenshot({ path: OUT + '01-home.png' });
await a.click('#btn-create');
await a.waitForSelector('#screen-lobby:not([hidden])');
const code = (await a.textContent('#room-code')).trim();
console.log('room code', code);
await sleep(400);
await a.screenshot({ path: OUT + '02-lobby-alone.png' });

const b = await player('Ben');
await b.fill('#code-input', 'ZZZZZ');
await b.click('#btn-join');
await b.waitForSelector('#home-error:not([hidden])');
console.log('bad code error:', await b.textContent('#home-error'));
await b.fill('#code-input', code);
await b.click('#btn-join');
await b.waitForSelector('#screen-lobby:not([hidden])');
await sleep(500);
await a.screenshot({ path: OUT + '03-lobby-both.png' });

const level = process.env.LEVEL;
if (level) { await a.click(`.level-card[data-level="${level}"]`); await sleep(300); }
await a.click('#btn-ready');
await b.click('#btn-ready');
await a.waitForSelector('#screen-game:not([hidden])');
await sleep(900);
await a.screenshot({ path: OUT + '04-countdown.png' });
await a.waitForFunction(() => window.__duality.session.state?.phase === 'playing', null, { timeout: 8000 });
await sleep(300);
await a.screenshot({ path: OUT + '05-playing-a.png' });
await b.screenshot({ path: OUT + '05-playing-b.png' });

// Ember (A) walks right and jumps; Tide (B) walks right.
await a.keyboard.down('ArrowRight');
await b.keyboard.down('KeyD');
await sleep(400);
await a.keyboard.press('Space');
await sleep(500);
await a.screenshot({ path: OUT + '06-moving-a.png' });
await a.keyboard.up('ArrowRight');
await b.keyboard.up('KeyD');
await sleep(700);
const sync = await Promise.all([a, b].map((p) => p.evaluate(() => {
  const d = window.__duality;
  const w = d.scene.pred.world;
  return { tick: w.tick, ember: [w.players[0].x.toFixed(2), w.players[0].y.toFixed(2)], tide: [w.players[1].x.toFixed(2), w.players[1].y.toFixed(2)], fps: d.scene.fps };
})));
console.log('predicted worlds after settling:', JSON.stringify(sync));
await a.screenshot({ path: OUT + '07-settled-a.png' });
await b.screenshot({ path: OUT + '07-settled-b.png' });

// Overview + pause menu
await a.keyboard.press('Tab');
await sleep(800);
await a.screenshot({ path: OUT + '08-overview.png' });
await a.keyboard.press('Tab');
await a.keyboard.press('Escape');
await sleep(300);
await a.screenshot({ path: OUT + '09-pause.png' });
await a.keyboard.press('Escape');

// Refresh B mid-game: should reconnect to the same seat.
await b.reload();
await b.waitForFunction(() => window.__duality.session.state?.phase === 'playing' || window.__duality.session.state?.phase === 'countdown', null, { timeout: 15000 });
console.log('B reconnected after refresh, phase =', await b.evaluate(() => window.__duality.session.state.phase));
await sleep(1500);
await b.screenshot({ path: OUT + '10-after-refresh-b.png' });

// Mobile viewport screenshot
const m = await player('Mia', { width: 844, height: 390 });
await m.screenshot({ path: OUT + '11-mobile-home.png' });

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
