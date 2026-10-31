// Sprite-pipeline validation with two real clients in one room.
// Drives the animation states with real keyboard input, records every
// animation transition on BOTH clients, and screenshots each state with the
// debug hitbox/pivot overlay enabled.
//
// Usage: node tests/e2e/animations.mjs [baseUrl] [--as ember|tide]
//   --as tide swaps elements in the lobby so the driven client plays Tide.
//   Tide's push/interact are reached by placing Tide next to a crate/lever in
//   its own client-side prediction (labelled "client-side" in the report): the
//   animation selection code is shared and character-agnostic.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('http')) || 'http://localhost:5173';
const AS = args.includes('--as') ? args[args.indexOf('--as') + 1] : 'ember';
const ME = AS === 'tide' ? 1 : 0;
const OUT = new URL(`./out/anim-${AS}/`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const report = { character: AS };

// ---------------------------------------------------------------- preview page (dev only)
if (ME === 0) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
  page.on('pageerror', (e) => errors.push(`[preview] ${e.message}`));
  await page.goto(`${BASE}/anim-preview.html`);
  await page.waitForFunction(() => window.__preview?.ready, null, { timeout: 15000 });
  await sleep(300);
  await page.screenshot({ path: OUT + 'preview-a.png', fullPage: true });
  await sleep(240);
  await page.screenshot({ path: OUT + 'preview-b.png', fullPage: true });
  report.previewSprites = (await page.evaluate(() => window.__preview.sprites)).length;
  await page.close();
}

// ---------------------------------------------------------------- multiplayer
async function player(name) {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#screen-home:not([hidden])');
  await page.evaluate(() => window.__duality.ui?.openPlay?.());
  await page.fill('#name-input', name);
  return page;
}
const a = await player('Ava'); // driven client
await a.click('#btn-create');
await a.waitForSelector('#screen-lobby:not([hidden])');
const code = (await a.textContent('#room-code')).trim();
const b = await player('Ben'); // partner
await b.fill('#code-input', code);
await b.click('#btn-join');
await b.waitForSelector('#screen-lobby:not([hidden])');
if (ME === 1) {
  await a.click('#btn-swap');
  await a.waitForFunction(() => window.__duality.session.state.slots[1].sid === window.__duality.session.sessionId, null, { timeout: 5000 });
}

const state = (p, i) => p.evaluate((i) => window.__duality.scene.view?.animState(i), i);

// Background recorder of transitions: the driven character as seen locally (a) and remotely (b).
const seen = { local: [], remote: [] };
let recording = true;
(async () => {
  while (recording) {
    try {
      const [sa, sb] = await Promise.all([state(a, ME), state(b, ME)]);
      if (sa && seen.local.at(-1)?.anim !== sa.anim) seen.local.push({ anim: sa.anim, flipX: sa.flipX });
      if (sb && seen.remote.at(-1)?.anim !== sb.anim) seen.remote.push({ anim: sb.anim, flipX: sb.flipX });
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
async function waitAnim(anim, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state(a, ME);
    if (s?.anim === anim) return s;
    await sleep(5);
  }
  return null;
}
// Close-up of the driven character: canvas pixels at the current (integer) zoom.
async function shot(name) {
  const clip = await a.evaluate((i) => {
    const sc = window.__duality.scene;
    const st = sc.view.animState(i);
    const cam = sc.cameras.main;
    const v = cam.worldView;
    const x = (st.x - v.x) * cam.zoom, y = (st.y - v.y) * cam.zoom;
    return { x: Math.max(0, x - 90), y: Math.max(0, y - 130), width: 180, height: 160 };
  }, ME);
  await a.screenshot({ path: `${OUT}${AS}-${name}.png`, clip });
}
const captured = {};
async function capture(anim, name = anim, ms) {
  const s = await waitAnim(anim, ms);
  captured[name] = !!s;
  if (s) await shot(name);
  return s;
}
/** Client-side placement: move the driven body in its own predicted world (rendering only reads it). */
async function placeLocally(col, row) {
  await a.evaluate(([c, r]) => {
    const sc = window.__duality.scene;
    const p = sc.pred.world.players[sc.local];
    p.x = c * 32 + 6; p.y = (r + 1) * 32 - 28; p.vx = 0; p.vy = 0; p.grounded = true;
    sc.pred.savePrev();
  }, [col, row]);
}

// Idle, run, jump, fall, land, mirroring (Level 1).
await startLevel('w1_l1_first_contact');
report.zoom = await a.evaluate(() => window.__duality.scene.cameras.main.zoom);
report.artMode = await a.evaluate(() => window.__duality.scene.view?.artMode);
await capture('idle');
await b.screenshot({ path: OUT + 'both-players-partner-view.png' });
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
report.pivotAlignment = await a.evaluate(() => {
  const sc = window.__duality.scene;
  const me = sc.local;
  const st = sc.view.animState(me);
  const p = sc.pred.world.players[me];
  const z = sc.cameras.main.zoom;
  return { dx: +Math.abs(st.x - (p.x + 10)).toFixed(3), dy: +Math.abs(st.y - (p.y + 28)).toFixed(3), maxSnap: 0.5 / z };
});

// Death and respawn: walk into the opposite element (Ember: L1 water to the right; Tide: L3 lava to the right).
if (ME === 1) { await toLobby(); await startLevel('w1_l3_meltwater'); }
await a.keyboard.down('ArrowRight');
await capture('death', 'death', 8000);
await a.keyboard.up('ArrowRight');
await sleep(250);
await shot('death-late');
await capture('respawn', 'respawn', 3000);
await capture('idle', 'idle-after-respawn');
await toLobby();

// Push.
await startLevel('w4_l12_convergence');
if (ME === 0) {
  report.pushMethod = 'real input';
  await a.keyboard.down('ArrowRight');
  await sleep(1150);
  await a.keyboard.down('Space'); await sleep(250); await a.keyboard.up('Space');
  let pushed = await capture('push', 'push', 1500);
  await a.keyboard.up('ArrowRight');
  if (!pushed) {
    await sleep(400);
    await a.keyboard.down('ArrowLeft');
    pushed = await capture('push', 'push', 3000);
    await a.keyboard.up('ArrowLeft');
  }
} else {
  report.pushMethod = 'client-side placement flush against the crate, real input';
  // Server corrections (20 Hz) move the body back, so re-apply the placement until the frame registers.
  await a.keyboard.down('ArrowRight');
  for (let k = 0; k < 60 && !captured.push; k++) {
    await a.evaluate(() => {
      const sc = window.__duality.scene;
      const crate = sc.pred.level.ofType.crate[0];
      const c = sc.pred.world.objs[crate];
      const p = sc.pred.world.players[sc.local];
      p.x = c.x - 20; p.y = c.y + 30 - 28; p.vx = 0; p.vy = 0; p.grounded = true;
      sc.pred.savePrev();
    });
    await sleep(16);
    if (await waitAnim('push', 30)) { captured.push = true; await shot('push'); }
  }
  captured.push = !!captured.push;
  await a.keyboard.up('ArrowRight');
}
await toLobby();

// Interact: Level 5's lever on the left ledge.
await startLevel('w2_l5_long_gear');
if (ME === 0) {
  report.interactMethod = 'real input';
  await a.keyboard.down('Space'); await sleep(350); await a.keyboard.up('Space');
  await sleep(600);
  await a.keyboard.down('ArrowLeft'); await a.keyboard.down('Space');
  await sleep(350); await a.keyboard.up('Space'); await sleep(250); await a.keyboard.up('ArrowLeft');
  await sleep(600);
} else {
  report.interactMethod = 'client-side placement next to the lever, real input';
  for (let k = 0; k < 60 && !captured.interact; k++) {
    await placeLocally(1, 11);
    await a.keyboard.press('KeyE');
    if (await waitAnim('interact', 60)) { captured.interact = true; await shot('interact'); }
  }
  captured.interact = !!captured.interact;
}
if (ME === 0) {
  await a.keyboard.press('KeyE');
  await capture('interact', 'interact', 2500);
}
await toLobby();

recording = false;
await sleep(50);
const names = (arr) => [...new Set(arr.map((e) => e.anim).filter(Boolean))];
report.captured = captured;
report.allNineSeenLocally = ['idle', 'run', 'jump_rise', 'fall', 'land', 'push', 'interact', 'death', 'respawn'].every((n) => names(seen.local).includes(n));
report.localSequence = seen.local.map((e) => e.anim + (e.flipX ? '(L)' : '')).filter(Boolean).join(' > ');
report.remoteSequence = seen.remote.map((e) => e.anim + (e.flipX ? '(L)' : '')).filter(Boolean).join(' > ');
report.remoteAnimsSeen = names(seen.remote);
report.errors = errors;
fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, localSequence: undefined, remoteSequence: undefined }, null, 1));
await browser.close();
