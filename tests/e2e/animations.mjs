// Sprite-pipeline validation: preview page + two real clients in one room (?art=sprites).
// Drives every animation with real input, records transitions on BOTH clients,
// and screenshots each state with the debug hitbox/pivot overlay enabled.
// Usage: node tests/e2e/animations.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = new URL('./out/anim/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const report = {};

// ---------------------------------------------------------------- preview page
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
  page.on('pageerror', (e) => errors.push(`[preview] ${e.message}`));
  await page.goto(`${BASE}/anim-preview.html`);
  await page.waitForFunction(() => window.__preview?.ready, null, { timeout: 15000 });
  await sleep(300);
  await page.screenshot({ path: OUT + 'preview-a.png', fullPage: true });
  await sleep(240);
  await page.screenshot({ path: OUT + 'preview-b.png', fullPage: true });
  report.preview = await page.evaluate(() => window.__preview.sprites);
  await page.close();
}

// ---------------------------------------------------------------- multiplayer
async function player(name) {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  await page.goto(`${BASE}/?art=sprites`);
  await page.waitForSelector('#screen-home:not([hidden])');
  await page.fill('#name-input', name);
  return page;
}
const a = await player('Ava'); // Ember
await a.click('#btn-create');
await a.waitForSelector('#screen-lobby:not([hidden])');
const code = (await a.textContent('#room-code')).trim();
const b = await player('Ben'); // Tide
await b.fill('#code-input', code);
await b.click('#btn-join');
await b.waitForSelector('#screen-lobby:not([hidden])');

const state = (p, i) => p.evaluate((i) => window.__duality.scene.view?.animState(i), i);
const zoomOf = (p) => p.evaluate(() => window.__duality.scene.cameras.main.zoom);

// Background recorder of transitions: Ember as seen locally (A) and remotely (B).
const seen = { local: [], remote: [] };
let recording = true;
(async () => {
  while (recording) {
    try {
      const [sa, sb] = await Promise.all([state(a, 0), state(b, 0)]);
      if (sa && seen.local.at(-1)?.anim !== sa.anim) seen.local.push({ anim: sa.anim, flipX: sa.flipX, t: Date.now() });
      if (sb && seen.remote.at(-1)?.anim !== sb.anim) seen.remote.push({ anim: sb.anim, flipX: sb.flipX, t: Date.now() });
    } catch { /* page navigating */ }
    await sleep(12);
  }
})();

async function startLevel(id) {
  await a.waitForSelector('#screen-lobby:not([hidden])');
  await a.click(`.level-card[data-level="${id}"]`);
  await sleep(200);
  await a.click('#btn-ready');
  await b.click('#btn-ready');
  await a.waitForFunction(() => window.__duality.session.state?.phase === 'playing', null, { timeout: 10000 });
  await a.evaluate(() => { window.__duality.scene.debug = true; });
  await sleep(300);
}
async function toLobby() {
  await a.evaluate(() => window.__duality.session.send('lobby'));
  await sleep(500);
}
async function waitAnim(p, i, anim, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state(p, i);
    if (s?.anim === anim) return s;
    await sleep(5);
  }
  return null;
}
// Close-up of a character: canvas pixels at the current (integer) zoom.
async function shot(p, i, name) {
  const clip = await p.evaluate((i) => {
    const sc = window.__duality.scene;
    const st = sc.view.animState(i);
    const cam = sc.cameras.main;
    const v = cam.worldView;
    const x = (st.x - v.x) * cam.zoom, y = (st.y - v.y) * cam.zoom;
    return { x: Math.max(0, x - 90), y: Math.max(0, y - 130), width: 180, height: 160 };
  }, i);
  await p.screenshot({ path: `${OUT}${name}.png`, clip });
}

const captured = {};
async function capture(anim, name = anim, ms) {
  const s = await waitAnim(a, 0, anim, ms);
  captured[name] = !!s;
  if (s) await shot(a, 0, `ember-${name}`);
  return s;
}

// Level 1: idle, run, jump_rise, fall, land, mirroring, death, respawn.
await startLevel('w1_l1_first_contact');
report.zoom = await zoomOf(a);
await capture('idle');
await b.screenshot({ path: OUT + 'both-players-tide-view.png' });
await a.keyboard.down('ArrowRight');
await capture('run', 'run-right');
await a.keyboard.press('Space');
await capture('jump_rise');
await capture('fall');
await capture('land');
await a.keyboard.up('ArrowRight');
await capture('idle', 'idle-after-land');
await a.keyboard.down('ArrowLeft');
const left = await capture('run', 'run-left');
report.mirroredWhenLeft = left?.flipX === true;
await a.keyboard.up('ArrowLeft');
await sleep(300);
// Walk Ember into the water pool (cols 12–20) to die.
await a.keyboard.down('ArrowRight');
await capture('death', 'death', 8000);
await a.keyboard.up('ArrowRight');
await sleep(250);
await shot(a, 0, 'ember-death-late');
await capture('respawn', 'respawn', 3000);
await capture('idle', 'idle-after-respawn');
// Alignment check: sprite pivot vs physics body bottom-centre.
report.pivotAlignment = await a.evaluate(() => {
  const sc = window.__duality.scene;
  const st = sc.view.animState(0);
  const p = sc.pred.world.players[0];
  const z = sc.cameras.main.zoom;
  return { spriteX: st.x, bodyCentreX: p.x + 10, spriteY: st.y, bodyBottomY: p.y + 28, dx: Math.abs(st.x - (p.x + 10)), dy: Math.abs(st.y - (p.y + 28)), maxSnap: 0.5 / z };
});
await toLobby();

// Level 12: push the crate. Ember drops into the lava basin, hops out, and pushes from whichever side she lands on.
await startLevel('w4_l12_convergence');
await a.keyboard.down('ArrowRight');
await sleep(1150);
await a.keyboard.down('Space');
await sleep(250);
await a.keyboard.up('Space');
let pushed = await capture('push', 'push', 1500);
await a.keyboard.up('ArrowRight');
if (!pushed) {
  report.pushRoute = 'landed right of the crate; pushing it leftwards';
  await sleep(400);
  await a.keyboard.down('ArrowLeft');
  pushed = await capture('push', 'push', 3000);
  await a.keyboard.up('ArrowLeft');
}
await toLobby();

// Level 5: climb to Ember's lever (step above spawn, then the ledge to the left) and interact.
await startLevel('w2_l5_long_gear');
await a.keyboard.down('Space');                  // full jump straight up onto the one-way step
await sleep(350);
await a.keyboard.up('Space');
await sleep(600);
await a.keyboard.down('ArrowLeft');              // full jump up-left onto the lever ledge
await a.keyboard.down('Space');
await sleep(350);
await a.keyboard.up('Space');
await sleep(250);
await a.keyboard.up('ArrowLeft');
await sleep(600);
report.leverReachable = await a.evaluate(() => {
  const sc = window.__duality.scene;
  const p = sc.pred.world.players[0];
  return { col: +((p.x + 10) / 32).toFixed(2), row: +((p.y + 28) / 32).toFixed(2) };
});
await a.keyboard.press('KeyE');
await capture('interact', 'interact', 2500);
await toLobby();

recording = false;
await sleep(50);
const names = (arr) => [...new Set(arr.map((e) => e.anim))];
report.captured = captured;
report.localSequence = seen.local.map((e) => e.anim + (e.flipX ? '(L)' : '')).join(' → ');
report.remoteSequence = seen.remote.map((e) => e.anim + (e.flipX ? '(L)' : '')).join(' → ');
report.localAnimsSeen = names(seen.local);
report.remoteAnimsSeen = names(seen.remote);
report.errors = errors;
fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
