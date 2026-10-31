// Measures prediction quality under simulated latency.
// Run the server with COLYSEUS_LATENCY=<ms> and pass its URL.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function player(name) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(BASE);
  await page.waitForSelector('#screen-home:not([hidden])');
  await page.evaluate(() => window.__duality.ui?.openPlay?.());
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
await a.click('#btn-ready'); await b.click('#btn-ready');
await a.waitForFunction(() => window.__duality.session.state?.phase === 'playing', null, { timeout: 15000 });
await sleep(1500);
const sample = (p) => p.evaluate(() => { const s = window.__duality.scene; return { ping: window.__duality.session.ping, corr: s.pred.lastCorrection, pending: s.pred.pendingCount, off: Math.hypot(s.pred.offset.players[s.local].x, s.pred.offset.players[s.local].y) }; });
const stats = { aLocalOff: 0, aCorr: 0, bCorr: 0, pendMax: 0, pings: [] };
await a.keyboard.down('ArrowRight');
await b.keyboard.down('ArrowRight');
for (let i = 0; i < 40; i++) {
  if (i % 10 === 3) { await a.keyboard.press('Space'); await b.keyboard.press('Space'); }
  if (i === 20) { await a.keyboard.up('ArrowRight'); await a.keyboard.down('ArrowLeft'); }
  const [sa, sb] = await Promise.all([sample(a), sample(b)]);
  stats.aLocalOff = Math.max(stats.aLocalOff, sa.off);
  stats.aCorr = Math.max(stats.aCorr, sa.corr);
  stats.bCorr = Math.max(stats.bCorr, sb.corr);
  stats.pendMax = Math.max(stats.pendMax, sa.pending);
  stats.pings.push(sa.ping);
  await sleep(50);
}
await a.keyboard.up('ArrowLeft'); await b.keyboard.up('ArrowRight');
await sleep(1500);
const end = await Promise.all([a, b].map((p) => p.evaluate(() => { const w = window.__duality.scene.pred.world; return w.players.map((q) => [q.x.toFixed(2), q.y.toFixed(2)]).join(' | '); })));
console.log('ping ms (median):', stats.pings.sort((x, y) => x - y)[stats.pings.length >> 1]);
console.log('max unacked inputs (≈ RTT in ticks):', stats.pendMax);
console.log('max visual offset on LOCAL player (px):', stats.aLocalOff.toFixed(2));
console.log('max reconcile correction A / B (px, includes partner extrapolation):', stats.aCorr.toFixed(1), '/', stats.bCorr.toFixed(1));
console.log('converged worlds equal after settling:', end[0] === end[1], end);
await browser.close();
