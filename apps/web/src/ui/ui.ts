// DOM UI: home, lobby, HUD and overlays. Pure presentation driven by the
// replicated room state; every button sends an intent to the server.

import {
  LEVELS, Msg, NetTuning, WORLDS, isValidRoomCode, levelNumber, nextLevelId, normalizeRoomCode, sanitizeName, starsFor,
} from '@duality/shared';
import { friendlyError, session, type RoomStateView } from '../net/session';
import { progress, recordBest, saveSettings, settings, touchEnabled } from '../settings';
import { sfx, startMusic, stopMusic, unlockAudio } from '../audio/sfx';
import type { FrameInfo } from '../game/scene';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll(sel)) as T[];

type Screen = 'home' | 'lobby' | 'game' | 'none';
let screen: Screen = 'none';
let pauseOpen = false;
let restartArmedAt = 0;
let lastCountdown = -1;
let lastPhase = '';
let lastSeq = -1;
let lastHud = '';
let lastResultsSeq = -1;
let rotateDismissed = false;

export function fmtTime(ticks: number): string {
  const s = Math.floor(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function show(id: string, on: boolean): void {
  const el = document.getElementById(id);
  if (el) el.hidden = !on;
}

function setScreen(s: Screen): void {
  if (s === screen) return;
  screen = s;
  show('screen-home', s === 'home');
  show('screen-lobby', s === 'lobby');
  show('screen-game', s === 'game');
  if (s !== 'game') {
    setPause(false);
    show('overlay-results', false);
    show('overlay-paused', false);
    show('countdown', false);
  }
  updateRotateHint();
}

export function toast(text: string, kind: 'info' | 'good' | 'warn' | 'bad' = 'info', ms = 3800): void {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild?.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

export function isInputBlocked(): boolean {
  return pauseOpen || !$('#overlay-results').hidden || !$('#modal-howto').hidden || !$('#modal-settings').hidden || !$('#modal-credits').hidden;
}

export function gameInputEnabled(): boolean {
  return screen === 'game';
}

function setPause(on: boolean): void {
  pauseOpen = on;
  show('overlay-pause', on);
}

export function togglePause(): void {
  if (screen !== 'game') return;
  if (!$('#modal-howto').hidden || !$('#modal-settings').hidden) {
    show('modal-howto', false);
    show('modal-settings', false);
    show('modal-credits', false);
    return;
  }
  setPause(!pauseOpen);
}

export function requestRestart(): void {
  const s = session.state;
  if (!s || (s.phase !== 'playing' && s.phase !== 'countdown')) return;
  const now = performance.now();
  if (now - restartArmedAt < 1800) {
    restartArmedAt = 0;
    session.send(Msg.Restart);
    setPause(false);
  } else {
    restartArmedAt = now;
    toast('Press R again to restart the level for both of you.', 'info', 1800);
  }
}

function busy(btn: HTMLButtonElement, on: boolean, label?: string): void {
  btn.disabled = on;
  if (on) {
    btn.dataset.label = btn.textContent ?? '';
    btn.innerHTML = `<span class="spinner" style="width:18px;height:18px;border-width:2px;margin:0"></span> ${label ?? ''}`;
  } else if (btn.dataset.label !== undefined) {
    btn.textContent = btn.dataset.label;
  }
}

function homeError(msg: string): void {
  const el = $('#home-error');
  el.textContent = msg;
  el.hidden = !msg;
  if (msg) sfx.error();
}

// ---------------------------------------------------------------------------
// Home

function playerName(): string {
  const input = $<HTMLInputElement>('#name-input');
  const name = sanitizeName(input.value || settings.name || defaultName());
  saveSettings({ name });
  return name;
}

function defaultName(): string {
  const a = ['Brisk', 'Calm', 'Bright', 'Swift', 'Lucky', 'Clever', 'Bold', 'Merry'];
  const b = ['Comet', 'Otter', 'Fox', 'Spark', 'Wave', 'Moth', 'Pebble', 'Owl'];
  return `${a[Math.floor(Math.random() * a.length)]} ${b[Math.floor(Math.random() * b.length)]}`;
}

async function createRoom(): Promise<void> {
  unlockAudio();
  sfx.click();
  homeError('');
  const btn = $<HTMLButtonElement>('#btn-create');
  busy(btn, true, 'Creating…');
  try {
    await session.create(playerName());
    history.replaceState(null, '', `?room=${session.roomCode}`);
  } catch (e) {
    homeError(friendlyError(e));
  } finally {
    busy(btn, false);
  }
}

async function joinRoom(): Promise<void> {
  unlockAudio();
  sfx.click();
  const input = $<HTMLInputElement>('#code-input');
  const code = normalizeRoomCode(input.value);
  input.value = code;
  if (!isValidRoomCode(code)) {
    homeError(code.length < 5 ? 'Room codes are 5 characters — ask your partner for theirs.' : 'That code has characters that are never used in room codes (like O, 0, I or 1). Double-check it.');
    input.focus();
    return;
  }
  homeError('');
  const btn = $<HTMLButtonElement>('#btn-join');
  busy(btn, true, '');
  try {
    await session.join(code, playerName());
    history.replaceState(null, '', `?room=${code}`);
  } catch (e) {
    homeError(friendlyError(e));
  } finally {
    busy(btn, false);
  }
}

// ---------------------------------------------------------------------------
// Lobby

function inviteLink(): string {
  return `${location.origin}${location.pathname}?room=${session.roomCode}`;
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied!`, 'good', 1800);
  } catch {
    toast(`Copy failed — the code is ${session.roomCode}`, 'warn');
  }
}

function buildLevelGrid(): void {
  const grid = $('#level-grid');
  grid.innerHTML = '';
  for (const wd of WORLDS) {
    const col = document.createElement('div');
    col.className = 'world-col';
    col.innerHTML = `<div class="world-title">World ${wd.id}<b>${wd.name}</b></div>`;
    for (const l of LEVELS.filter((x) => x.world === wd.id)) {
      const b = document.createElement('button');
      b.className = 'level-card';
      b.dataset.level = l.levelId;
      b.innerHTML = `<div class="num">LEVEL ${levelNumber(l.levelId)}</div><div class="name">${l.name}</div><div class="lstars"><span>★</span><span>★</span><span>★</span></div>`;
      b.addEventListener('click', () => {
        sfx.click();
        session.send(Msg.SelectLevel, { id: l.levelId });
      });
      col.appendChild(b);
    }
    grid.appendChild(col);
  }
}

function renderLobby(s: RoomStateView): void {
  $('#room-code').textContent = session.roomCode;
  const me = session.sessionId;
  const isHost = s.host === me;
  const filled = s.slots.filter((x) => x.sid).length;
  s.slots.forEach((sl, i) => {
    const el = $(`#slot-${i}`);
    el.classList.toggle('filled', !!sl.sid);
    el.classList.toggle('ready', !!sl.sid && sl.ready);
    el.classList.toggle('me', sl.sid === me);
    el.querySelector('.slot-name')!.textContent = sl.sid ? sl.name : 'Open seat';
    const state = el.querySelector('.slot-state')!;
    state.classList.toggle('off', !!sl.sid && !sl.connected);
    state.textContent = !sl.sid ? 'Waiting for a partner to join…' : !sl.connected ? 'Reconnecting…' : sl.ready ? 'Ready ✓' : sl.sid === me ? 'Press “I’m ready” when set' : 'Not ready yet';
  });
  const mine = s.slots.find((x) => x.sid === me);
  const ready = $<HTMLButtonElement>('#btn-ready');
  ready.classList.toggle('is-on', !!mine?.ready);
  ready.textContent = mine?.ready ? (filled < 2 ? 'Ready — waiting for partner' : 'Ready ✓ — waiting for partner') : "I'm ready";
  const status = $('#lobby-status');
  status.innerHTML = filled < 2
    ? 'Share the code with your partner. They open this page on their device and tap <b>Join</b>.'
    : s.slots.every((x) => x.ready) ? 'Both ready — starting…' : 'Both players are here! Pick a level, then both press <b>I’m ready</b>.';
  $('#host-note').textContent = isHost ? 'You pick the level' : 'Your partner (host) picks the level';
  $$<HTMLButtonElement>('.level-card').forEach((b) => {
    const id = b.dataset.level!;
    b.classList.toggle('selected', id === s.level);
    b.disabled = !isHost;
    const best = Math.max(s.results.get(id)?.stars ?? 0, progress[id]?.stars ?? 0);
    b.querySelectorAll('.lstars span').forEach((st, k) => st.classList.toggle('on', k < best));
  });
}

// ---------------------------------------------------------------------------
// In-game

function renderGame(s: RoomStateView): void {
  const me = session.sessionId;
  const myIdx = s.slots.findIndex((x) => x.sid === me);
  const def = LEVELS.find((l) => l.levelId === s.level);
  if (!def) return;
  const partner = s.slots[1 - myIdx];

  if (s.seq !== lastSeq) {
    lastSeq = s.seq;
    const wd = WORLDS[def.world - 1];
    $('#hud-level-name').textContent = `${levelNumber(def.levelId)}. ${def.name} · ${wd?.name ?? ''}`;
    $('#hud-objective').textContent = def.objective;
    const you = $('#hud-you');
    you.className = `hud-you ${myIdx === 0 ? 'ember' : 'tide'}`;
    you.textContent = myIdx === 0 ? 'You are EMBER 🔥 — lava is safe, water is not' : 'You are TIDE 💧 — water is safe, lava is not';
    startMusic(def.world);
    setPause(false);
  }

  // Countdown
  if (s.phase === 'countdown' && !s.paused) {
    const n = Math.ceil(s.cd / 60);
    if (n !== lastCountdown) {
      lastCountdown = n;
      const cd = $('#countdown');
      cd.hidden = false;
      const el = myIdx === 0 ? '<span class="e">Ember</span>' : '<span class="t">Tide</span>';
      cd.innerHTML = `<div><span class="pop">${n > 0 ? n : 'GO'}</span><small>You are ${el} · ${def.tip}</small></div>`;
      if (n > 0) sfx.beep(false);
    }
  } else if (s.phase === 'playing' && lastCountdown !== 0 && lastPhase === 'countdown') {
    lastCountdown = 0;
    const cd = $('#countdown');
    cd.innerHTML = '<div><span class="pop">GO!</span></div>';
    sfx.beep(true);
    setTimeout(() => { if (session.state?.phase === 'playing') cd.hidden = true; }, 650);
  } else if (s.phase !== 'countdown') {
    if (lastCountdown !== 0) $('#countdown').hidden = true;
    lastCountdown = s.phase === 'playing' ? 0 : -1;
  }

  // Partner disconnected
  const pausedOverlay = s.paused && (s.phase === 'playing' || s.phase === 'countdown');
  show('overlay-paused', pausedOverlay);
  if (pausedOverlay) {
    const gone = !partner?.sid;
    $('#paused-title').textContent = gone ? 'Waiting for a partner' : `${partner.name || 'Your partner'} disconnected`;
    $('#paused-text').innerHTML = gone
      ? `Your partner left. Share code <b>${session.roomCode}</b> so someone can take their seat.`
      : `The level is frozen so nobody loses progress. Their seat is held for ${NetTuning.reconnectGraceSeconds} seconds.`;
  }

  // Results
  if (s.phase === 'complete') {
    renderResults(s, myIdx);
  } else {
    show('overlay-results', false);
  }
}

function renderResults(s: RoomStateView, myIdx: number): void {
  const def = LEVELS.find((l) => l.levelId === s.level)!;
  if (lastResultsSeq !== s.seq) {
    lastResultsSeq = s.seq;
    sfx.complete();
    recordBest(s.level, s.lastStars, s.lastTicks);
    const last = !nextLevelId(s.level);
    $('#results-panel').classList.toggle('victory', last);
    if (last) sfx.victory();
    $('#results-kicker').textContent = last ? 'The Sky Vault is restored — DUALITY complete!' : 'Level complete';
    $('#results-title').textContent = last ? 'Ember & Tide, together' : def.name;
    $$('#results-stars span').forEach((el, k) => {
      el.classList.remove('on');
      void (el as HTMLElement).offsetWidth;
      el.classList.toggle('on', k < s.lastStars);
    });
    $('#results-time').textContent = fmtTime(s.lastTicks);
    $('#results-deaths').textContent = String(s.lastDeaths);
    $('#results-par').textContent = fmtTime(def.par * 60);
    $('#btn-vote-next').textContent = last ? 'Finish' : 'Next level';
    const stars = starsFor(s.lastTicks, s.lastDeaths, def.par);
    void stars;
  }
  show('overlay-results', true);
  const mine = s.slots[myIdx]?.vote;
  const theirs = s.slots[1 - myIdx]?.vote;
  const label = (v: string) => (v === 'next' ? 'Next level' : 'Replay');
  $('#btn-vote-next').classList.toggle('is-on', mine === 'next');
  $('#btn-vote-replay').classList.toggle('is-on', mine === 'replay');
  $('#vote-status').textContent = mine && !theirs ? 'Waiting for your partner to choose…'
    : !mine && theirs ? `Your partner chose “${label(theirs)}”.`
      : mine && theirs && mine !== theirs ? `You picked different options — agree on one!` : '';
}

let hudTimer = 0;
export function onFrame(info: FrameInfo): void {
  if (screen !== 'game' || !info.world) return;
  const now = performance.now();
  if (now - hudTimer < 200) return;
  hudTimer = now;
  const w = info.world;
  const deaths = w.players[0].deaths + w.players[1].deaths;
  const ping = session.ping;
  const key = `${fmtTime(w.tick)}|${deaths}|${ping}|${info.fps}`;
  if (key === lastHud) return;
  lastHud = key;
  $('#hud-time').textContent = fmtTime(w.tick);
  $('#hud-deaths').textContent = String(deaths);
  const net = $('#hud-net');
  net.classList.toggle('mid', ping >= 120 && ping < 250);
  net.classList.toggle('bad', ping >= 250);
  $('#hud-ping').textContent = settings.debug ? `${ping}ms · ${info.fps}fps · Δ${info.correction.toFixed(1)} · q${info.pending}` : ping ? `${ping} ms` : '—';
}

// ---------------------------------------------------------------------------

export function applyState(s: RoomStateView): void {
  if (s.phase === 'lobby') {
    setScreen('lobby');
    renderLobby(s);
    stopMusic();
    lastSeq = -1;
  } else {
    setScreen('game');
    renderGame(s);
  }
  lastPhase = s.phase;
}

/** Main menu (Play / How to Play / Settings / Credits) or the play panel (name + create/join). */
export function openMenu(): void {
  show('home-menu', true);
  show('home-play', false);
}

export function openPlay(): void {
  show('home-menu', false);
  show('home-play', true);
  $<HTMLInputElement>('#name-input').focus({ preventScroll: true });
}

function syncMute(): void {
  const b = $('#btn-mute');
  b.textContent = settings.mute ? '🔇' : '🔊';
  b.setAttribute('aria-pressed', String(settings.mute));
  b.setAttribute('aria-label', settings.mute ? 'Unmute audio' : 'Mute audio');
  $<HTMLInputElement>('#set-mute').checked = settings.mute;
}

export function goHome(message?: string): void {
  setScreen('home');
  stopMusic();
  show('overlay-reconnect', false);
  history.replaceState(null, '', location.pathname);
  if (message) toast(message, 'warn', 5000);
  lastSeq = -1;
  lastResultsSeq = -1;
}

export function showReconnecting(on: boolean): void {
  show('overlay-reconnect', on);
}

function updateRotateHint(): void {
  const portraitPhone = touchEnabled() && window.innerHeight > window.innerWidth && window.innerWidth < 700;
  show('rotate-hint', screen === 'game' && portraitPhone && !rotateDismissed);
}

function updateTouch(): void {
  const on = touchEnabled();
  show('touch', on);
  document.body.classList.toggle('touch-on', on);
}

export function initUI(): void {
  // Home
  const nameInput = $<HTMLInputElement>('#name-input');
  nameInput.value = settings.name;
  nameInput.placeholder = settings.name || 'Player';
  $('#btn-create').addEventListener('click', () => void createRoom());
  $('#btn-join').addEventListener('click', () => void joinRoom());
  const codeInput = $<HTMLInputElement>('#code-input');
  codeInput.addEventListener('input', () => {
    const pos = codeInput.selectionStart;
    codeInput.value = normalizeRoomCode(codeInput.value);
    codeInput.setSelectionRange(pos, pos);
    homeError('');
  });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void joinRoom(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (codeInput.value ? joinRoom() : createRoom()); });
  const params = new URLSearchParams(location.search);
  const preset = params.get('room');
  if (preset) codeInput.value = normalizeRoomCode(preset);
  // Invite links skip the menu and land on the join form.
  if (preset) openPlay(); else openMenu();
  $('#btn-play').addEventListener('click', () => { unlockAudio(); sfx.confirm(); openPlay(); });
  $('#btn-menu-back').addEventListener('click', () => { sfx.click(); openMenu(); });

  // Lobby
  buildLevelGrid();
  $('#btn-copy-code').addEventListener('click', () => void copy(session.roomCode, 'Room code'));
  $('#btn-copy-link').addEventListener('click', () => {
    const link = inviteLink();
    if (navigator.share && touchEnabled()) {
      navigator.share({ title: 'Play DUALITY with me', text: `Join my DUALITY room: ${session.roomCode}`, url: link }).catch(() => undefined);
    } else void copy(link, 'Invite link');
  });
  $('#btn-swap').addEventListener('click', () => { sfx.click(); session.send(Msg.SwapElements); });
  $('#btn-ready').addEventListener('click', () => {
    unlockAudio();
    sfx.click();
    const me = session.state?.slots.find((x) => x.sid === session.sessionId);
    session.send(Msg.Ready, { ready: !me?.ready });
  });
  $('#btn-leave').addEventListener('click', () => { sfx.click(); void session.leave().then(() => goHome()); });

  // Game
  $('#btn-pause').addEventListener('click', () => { sfx.click(); togglePause(); });
  $('#btn-vote-next').addEventListener('click', () => { sfx.click(); session.send(Msg.Vote, { v: 'next' }); });
  $('#btn-vote-replay').addEventListener('click', () => { sfx.click(); session.send(Msg.Vote, { v: 'replay' }); });

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const action = t.closest<HTMLElement>('[data-action]')?.dataset.action;
    const open = t.closest<HTMLElement>('[data-open]')?.dataset.open;
    if (t.closest('[data-close]') || (t.classList.contains('modal') && t.classList.contains('overlay'))) {
      show('modal-howto', false);
      show('modal-settings', false);
      show('modal-credits', false);
    }
    if (open) { sfx.click(); show(`modal-${open}`, true); }
    if (!action) return;
    sfx.click();
    if (action === 'resume') setPause(false);
    if (action === 'restart') { session.send(Msg.Restart); setPause(false); }
    if (action === 'lobby') { session.send(Msg.ToLobby); setPause(false); }
    if (action === 'leave') { setPause(false); void session.leave().then(() => goHome()); }
  });

  // Settings
  const music = $<HTMLInputElement>('#set-music');
  const sfxIn = $<HTMLInputElement>('#set-sfx');
  const touchSel = $<HTMLSelectElement>('#set-touch');
  const motion = $<HTMLInputElement>('#set-motion');
  const debug = $<HTMLInputElement>('#set-debug');
  const art = $<HTMLSelectElement>('#set-art');
  art.value = settings.charArt;
  art.addEventListener('change', () => saveSettings({ charArt: art.value as 'classic' | 'sprites' }));
  music.value = String(settings.music);
  sfxIn.value = String(settings.sfx);
  touchSel.value = settings.touch;
  motion.checked = settings.reducedMotion;
  debug.checked = settings.debug;
  music.addEventListener('input', () => { unlockAudio(); saveSettings({ music: +music.value }); });
  sfxIn.addEventListener('input', () => { unlockAudio(); saveSettings({ sfx: +sfxIn.value }); });
  sfxIn.addEventListener('change', () => sfx.jump(0));
  touchSel.addEventListener('change', () => { saveSettings({ touch: touchSel.value as 'auto' | 'on' | 'off' }); updateTouch(); });
  motion.addEventListener('change', () => saveSettings({ reducedMotion: motion.checked }));
  debug.addEventListener('change', () => saveSettings({ debug: debug.checked }));
  $<HTMLInputElement>('#set-mute').addEventListener('change', (e) => { unlockAudio(); saveSettings({ mute: (e.target as HTMLInputElement).checked }); syncMute(); });
  $('#btn-mute').addEventListener('click', () => { unlockAudio(); saveSettings({ mute: !settings.mute }); syncMute(); sfx.click(); });
  syncMute();

  $('#btn-dismiss-rotate').addEventListener('click', () => { rotateDismissed = true; updateRotateHint(); });
  window.addEventListener('resize', updateRotateHint);
  updateTouch();
  window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
}

export { setScreen, $ };
