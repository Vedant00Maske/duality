// UI, audio and responsive checks with two real browser clients.
// Usage: node tests/e2e/ui.mjs [baseUrl]
// Verifies: main menu navigation, How to Play / Settings / Credits modals,
// play panel, invalid / full room codes, lobby seats + ready indicators,
// copy code, level selection, HUD, pause, mute, music per world and cleanup,
// and layout at five viewport sizes (no horizontal overflow, controls reachable).
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173';
const OUT = new URL('./out/ui/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); if (!ok) console.log('FAIL', name, detail); };

async function open(name, viewport = { width: 1366, height: 768 }, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: !!opts.touch, isMobile: !!opts.touch, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  // Rejected joins (bad code, full room) surface as the matchmaker's HTTP 522 — expected for Ben/Cy.
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 522/.test(m.text())) errors.push(`[${name}] ${m.text()}`); });
  await page.goto(BASE);
  await page.waitForSelector('#screen-home:not([hidden])');
  return page;
}
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !e.closest('[hidden]') && r.width > 0 && r.height > 0; }, sel);

// ---------------------------------------------------------------- main menu
const a = await open('Ava');
check('menu: Play visible on load', await visible(a, '#btn-play'));
check('menu: play panel hidden on load', !(await visible(a, '#name-input')));
check('audio: nothing playing before interaction', (await a.evaluate(() => window.__duality.audio.musicState())).ctx === 'none');
for (const [btn, modal] of [['howto', 'modal-howto'], ['settings', 'modal-settings'], ['credits', 'modal-credits']]) {
  await a.click(`#home-menu [data-open="${btn}"]`);
  check(`menu: ${btn} opens`, await visible(a, `#${modal} .panel`));
  await a.screenshot({ path: `${OUT}menu-${btn}.png` });
  await a.click(`#${modal} [data-close]`);
  check(`menu: ${btn} closes`, !(await visible(a, `#${modal} .panel`)));
}
await a.screenshot({ path: OUT + 'menu.png' });
await a.click('#btn-play');
check('menu: Play opens the play panel', await visible(a, '#name-input'));
await a.click('#btn-menu-back');
check('menu: back returns to menu', await visible(a, '#btn-play'));
await a.keyboard.press('Tab'); // keyboard focus reaches the Play button
await a.click('#btn-play');

// ---------------------------------------------------------------- settings
await a.click('#home-play [data-open="howto"]');
await a.click('#modal-howto [data-close]');
await a.evaluate(() => { document.querySelector('[data-open="settings"]').click(); });
await a.fill('#set-music', '30');
await a.dispatchEvent('#set-music', 'input');
await a.fill('#set-sfx', '60');
await a.dispatchEvent('#set-sfx', 'input');
await a.selectOption('#set-art', 'classic');
const saved = await a.evaluate(() => JSON.parse(localStorage.getItem('duality.settings.v1')));
check('settings: volumes + art persisted', saved.music === 30 && saved.sfx === 60 && saved.charArt === 'classic', JSON.stringify(saved));
await a.selectOption('#set-art', 'sprites');
await a.click('#modal-settings [data-close]');

// ---------------------------------------------------------------- rooms
await a.fill('#name-input', 'Ava');
await a.click('#btn-create');
await a.waitForSelector('#screen-lobby:not([hidden])');
const code = (await a.textContent('#room-code')).trim();
check('lobby: 5-char room code', /^[A-HJ-NP-Z2-9]{5}$/.test(code), code);
await a.click('#btn-copy-code');
await sleep(150);
check('lobby: copy code', (await a.evaluate(() => navigator.clipboard.readText()).catch(() => '')) === code);
check('lobby: host seat filled, partner open', await a.evaluate(() => document.querySelector('#slot-0').classList.contains('filled') && !document.querySelector('#slot-1').classList.contains('filled')));
await a.screenshot({ path: OUT + 'lobby-alone.png' });

const b = await open('Ben');
await b.click('#btn-play');
await b.fill('#name-input', 'Ben');
await b.fill('#code-input', 'ZZZZZ');
await b.click('#btn-join');
await b.waitForSelector('#home-error:not([hidden])');
check('join: invalid code shows an error', (await b.textContent('#home-error')).length > 0, await b.textContent('#home-error'));
await b.fill('#code-input', code);
await b.click('#btn-join');
await b.waitForSelector('#screen-lobby:not([hidden])');
await sleep(300);
check('lobby: both seats filled', await a.evaluate(() => document.querySelectorAll('.slot.filled').length === 2));

const c = await open('Cy');
await c.click('#btn-play');
await c.fill('#code-input', code);
await c.click('#btn-join');
await c.waitForSelector('#home-error:not([hidden])', { timeout: 8000 }).catch(() => undefined);
check('join: full room rejected', !(await visible(c, '#screen-lobby')) && (await c.textContent('#home-error')).length > 0, await c.textContent('#home-error'));
await c.context().close();

// level select + ready indicators
await a.click('.level-card[data-level="w2_l4_counterweight"]');
await sleep(250);
check('levels: host selection replicated', await b.evaluate(() => document.querySelector('.level-card.selected')?.dataset.level === 'w2_l4_counterweight'));
check('levels: guest cannot pick', await b.evaluate(() => document.querySelector('.level-card').disabled));
check('levels: 4 worlds x 3 levels', await a.evaluate(() => document.querySelectorAll('.world-col').length === 4 && document.querySelectorAll('.level-card').length === 12));
await a.click('#btn-ready');
await sleep(250);
check('lobby: ready indicator shown to partner', await b.evaluate(() => document.querySelector('#slot-0').classList.contains('ready')));
await a.screenshot({ path: OUT + 'lobby-ready.png' });
await b.click('#btn-ready');
await a.waitForFunction(() => window.__duality.session.state?.phase === 'playing', null, { timeout: 10000 });
await sleep(400);

// ---------------------------------------------------------------- HUD, audio, pause
check('hud: level title shows world', (await a.textContent('#hud-level-name')).includes('Machineworks'), await a.textContent('#hud-level-name'));
check('hud: character identity', (await a.textContent('#hud-you')).toUpperCase().includes('EMBER'));
check('hud: partner sees Tide identity', (await b.textContent('#hud-you')).toUpperCase().includes('TIDE'));
const music = await a.evaluate(() => window.__duality.audio.musicState());
check('audio: World 2 music playing after interaction', music.world === 2 && music.running && music.ctx === 'running', JSON.stringify(music));
await a.screenshot({ path: OUT + 'game-hud.png' });
await a.click('#btn-mute');
check('audio: mute toggles setting', await a.evaluate(() => JSON.parse(localStorage.getItem('duality.settings.v1')).mute === true));
await a.click('#btn-mute');
await a.keyboard.press('Escape');
check('pause: menu opens', await visible(a, '#overlay-pause .panel'));
await a.screenshot({ path: OUT + 'pause.png' });
await a.click('#overlay-pause [data-action="resume"]');
check('pause: resume closes', !(await visible(a, '#overlay-pause .panel')));
await a.evaluate(() => window.__duality.session.send('lobby'));
await a.waitForSelector('#screen-lobby:not([hidden])');
await sleep(300);
const after = await a.evaluate(() => window.__duality.audio.musicState());
check('audio: music stops on leaving the level', !after.running, JSON.stringify(after));
// Starting another world switches tracks without stacking.
await a.click('.level-card[data-level="w3_l7_first_reflection"]');
await sleep(200);
await a.click('#btn-ready'); await b.click('#btn-ready');
await a.waitForFunction(() => window.__duality.session.state?.phase === 'playing', null, { timeout: 10000 });
const m3 = await a.evaluate(() => window.__duality.audio.musicState());
check('audio: World 3 track replaces previous', m3.world === 3 && m3.running, JSON.stringify(m3));
await a.evaluate(() => window.__duality.session.send('lobby'));
await sleep(300);

// ---------------------------------------------------------------- responsive
const sizes = [
  ['desktop-1920', { width: 1920, height: 1080 }, false],
  ['desktop-1366', { width: 1366, height: 768 }, false],
  ['tablet-1024', { width: 1024, height: 768 }, true],
  ['phone-portrait', { width: 390, height: 844 }, true],
  ['phone-landscape', { width: 844, height: 390 }, true],
];
for (const [name, vp, touch] of sizes) {
  const p = await open(name, vp, { touch });
  const layout = () => p.evaluate(() => {
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const offscreen = [...document.querySelectorAll('button, input, select')].filter((e) => {
      if (e.closest('[hidden]')) return false;
      const r = e.getBoundingClientRect();
      if (!r.width) return false;
      return r.right > window.innerWidth + 1 || r.left < -1;
    }).map((e) => e.id || e.textContent.trim().slice(0, 20));
    return { overflow, offscreen };
  });
  let l = await layout();
  check(`${name}: menu fits`, !l.overflow && !l.offscreen.length, JSON.stringify(l));
  await p.screenshot({ path: `${OUT}${name}-menu.png` });
  await p.click('#btn-play');
  await p.fill('#name-input', 'Vee');
  await p.click('#btn-create');
  await p.waitForSelector('#screen-lobby:not([hidden])');
  l = await layout();
  check(`${name}: lobby fits`, !l.overflow && !l.offscreen.length, JSON.stringify(l));
  check(`${name}: room code readable`, await p.evaluate(() => { const r = document.querySelector('#room-code').getBoundingClientRect(); return r.width > 60 && r.right <= window.innerWidth; }));
  await p.screenshot({ path: `${OUT}${name}-lobby.png`, fullPage: true });
  // Second client joins so the game starts at this size.
  const q = await open(`${name}-b`);
  await q.click('#btn-play');
  await q.fill('#code-input', (await p.textContent('#room-code')).trim());
  await q.click('#btn-join');
  await q.waitForSelector('#screen-lobby:not([hidden])');
  await p.click('#btn-ready'); await q.click('#btn-ready');
  await p.waitForFunction(() => window.__duality.session.state?.phase === 'playing', null, { timeout: 10000 });
  await sleep(500);
  const game = await p.evaluate(() => {
    const sc = window.__duality.scene;
    const hud = [...document.querySelectorAll('.hud-top > *')].map((e) => e.getBoundingClientRect());
    const overlap = hud.length === 2 && hud[0].right > hud[1].left && hud[0].bottom > hud[1].top;
    return { zoom: sc.cameras.main.zoom, touch: !document.querySelector('#touch').hidden, rotate: !document.querySelector('#rotate-hint').hidden, overlap, pixel: sc.view.pixelEnv };
  });
  check(`${name}: integer zoom in play`, Number.isInteger(game.zoom), JSON.stringify(game));
  check(`${name}: HUD does not overlap`, !game.overlap, JSON.stringify(game));
  if (touch) check(`${name}: touch controls shown`, game.touch, JSON.stringify(game));
  if (name === 'phone-portrait') check(`${name}: rotate prompt shown`, game.rotate, JSON.stringify(game));
  await p.screenshot({ path: `${OUT}${name}-game.png` });
  if (touch && !game.rotate) {
    // Touch: hold the on-screen right button and check the character moves.
    const x0 = await p.evaluate(() => window.__duality.scene.pred.world.players[window.__duality.scene.local].x);
    const box = await p.locator('.tbtn[data-btn="right"]').boundingBox();
    await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await p.dispatchEvent('.tbtn[data-btn="right"]', 'pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true });
    await sleep(500);
    await p.dispatchEvent('.tbtn[data-btn="right"]', 'pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true });
    const x1 = await p.evaluate(() => window.__duality.scene.pred.world.players[window.__duality.scene.local].x);
    check(`${name}: touch input moves the character`, x1 > x0 + 10, `${x0.toFixed(1)} -> ${x1.toFixed(1)}`);
  }
  await p.context().close();
  await q.context().close();
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(OUT + 'report.json', JSON.stringify({ results, errors }, null, 2));
console.log(`UI checks: ${results.length - failed.length} passed, ${failed.length} failed`);
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
if (failed.length || errors.length) process.exit(1);
