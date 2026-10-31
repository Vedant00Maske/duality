import Phaser from 'phaser';
import {
  type CompiledLevel, type Phase, type World, Btn, EDGE_MASK, LEVELS, NetTuning, PlayerTuning, TICK_MS, createWorld, getLevel,
  interactTarget,
} from '@duality/shared';
import { type CharArtMode, LevelView } from './levelView';
import { CHARACTER_SHEETS, SHEET_KEY } from '../art/characters';
import { Predictor } from './predictor';
import { makeTextures } from './textures';
import { Input } from './input';
import type { RoomStateView } from '../net/session';
import { session } from '../net/session';
import { onSettings, settings } from '../settings';

export interface SceneHooks {
  /** True while a menu covers the game (inputs are suppressed). */
  inputBlocked: () => boolean;
  inputEnabled: () => boolean;
  pause: () => void;
  restart: () => void;
  frame: (info: FrameInfo) => void;
}

export interface FrameInfo {
  world: World | null;
  level: CompiledLevel | null;
  local: number;
  fps: number;
  correction: number;
  pending: number;
}

const BW = PlayerTuning.bodyW;
const BH = PlayerTuning.bodyH;

function buildWorld(s: RoomStateView, level: CompiledLevel): World | null {
  if (s.objs.length !== level.objects.length) return null;
  const w = createWorld(level);
  w.tick = s.tick;
  w.exitTimer = s.exitT;
  for (let i = 0; i < 2; i++) {
    const sl = s.slots[i];
    const p = w.players[i];
    p.x = sl.x; p.y = sl.y; p.vx = sl.vx; p.vy = sl.vy;
    p.grounded = (sl.fl & 1) === 1;
    p.jumping = (sl.fl & 2) === 2;
    p.facing = sl.face || 1;
    p.coyote = sl.cy; p.jbuf = sl.jb; p.dead = sl.dead; p.held = sl.held;
    p.ground = sl.gnd; p.rx = sl.rx; p.ry = sl.ry; p.deaths = sl.deaths;
  }
  for (let i = 0; i < level.objects.length; i++) {
    const so = s.objs[i];
    const o = w.objs[i];
    o.s = so.s; o.p = so.p; o.x = so.x; o.y = so.y; o.vx = so.vx; o.vy = so.vy;
  }
  return w;
}

export class GameScene extends Phaser.Scene {
  hooks!: SceneHooks;
  view: LevelView | null = null;
  pred: Predictor | null = null;
  input2!: Input;
  private level: CompiledLevel | null = null;
  private levelKey = '';
  private seq = -1;
  local = 0;
  phase: Phase = 'lobby';
  paused = false;
  private mode: 'attract' | 'play' = 'attract';
  private acc = 0;
  private sendFirst = 0;
  private sendBits: number[] = [];
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  overview = false;
  debug = settings.debug;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 60;
  private attractT = 0;
  private seqCarry = 1;

  constructor() {
    super('game');
  }

  preload(): void {
    // Character sprite sheets (Aseprite JSON array). Failure falls back to classic art.
    for (const sheet of CHARACTER_SHEETS) this.load.aseprite(sheet.key, sheet.png, sheet.json);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`asset failed to load: ${file.key}`);
    });
  }

  /** Sprite-sheet characters are active (and pixel-art camera rules apply). */
  get pixelMode(): boolean {
    return settings.charArt === 'sprites' && this.textures.exists(SHEET_KEY[0]) && this.textures.exists(SHEET_KEY[1]);
  }

  private artMode(): CharArtMode {
    return this.pixelMode ? 'sprites' : 'classic';
  }

  create(): void {
    // Pixel art is sampled nearest-neighbour; procedural textures keep smooth filtering.
    for (const key of SHEET_KEY) {
      if (this.textures.exists(key)) this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    onSettings(() => this.view?.setArt(this.artMode()));
    makeTextures(this);
    this.cameras.main.setBackgroundColor('#0d0b17');
    this.input2 = new Input({
      pause: () => this.hooks.pause(),
      restart: () => this.hooks.restart(),
      overview: () => { this.overview = !this.overview; },
      debug: () => { this.debug = !this.debug; },
      enabled: () => this.hooks.inputEnabled(),
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    window.addEventListener('blur', () => this.releaseAll());
    this.showAttract(LEVELS[0].levelId);
    this.isReady = true;
    for (const fn of this.readyFns) fn();
    this.readyFns = [];
  }

  private isReady = false;
  private readyFns: Array<() => void> = [];
  whenReady(fn: () => void): void {
    if (this.isReady) fn(); else this.readyFns.push(fn);
  }

  /** Make sure the server never keeps walking us after focus is lost. */
  private releaseAll(): void {
    this.input2?.clear();
    if (this.mode === 'play' && this.phase === 'playing' && !this.paused && this.pred) {
      const seq = this.pred.tick(0);
      this.queueInput(seq, 0);
      this.flushInputs();
    }
  }

  // -------------------------------------------------------------------------

  private setLevel(levelId: string, local: number, initial: World | null): boolean {
    const level = getLevel(levelId);
    if (!level) return false;
    this.view?.destroy();
    if (this.pred) this.seqCarry = Math.max(this.seqCarry, this.pred.seq);
    this.level = level;
    this.local = local;
    this.view = new LevelView(this, level, local, this.artMode());
    this.pred = new Predictor(level, initial ?? createWorld(level), local);
    this.pred.setSeqBase(this.seqCarry);
    this.sendBits.length = 0;
    this.acc = 0;
    this.overview = false;
    const p = this.pred.world.players[local];
    this.camX = p.x;
    this.camY = p.y;
    this.snapCamera = true;
    return true;
  }
  private snapCamera = false;

  showAttract(levelId: string): void {
    if (this.mode === 'attract' && this.levelKey === `a:${levelId}`) return;
    this.mode = 'attract';
    this.levelKey = `a:${levelId}`;
    this.seq = -1;
    this.setLevel(levelId, 0, null);
    if (this.view) this.view.partnerName = '';
  }

  /** Feed every authoritative state patch in. */
  applyNet(s: RoomStateView): void {
    const mySid = session.sessionId;
    const myIdx = s.slots.findIndex((sl) => sl.sid === mySid);
    this.phase = s.phase;
    this.paused = s.paused;
    if (s.phase === 'lobby' || myIdx < 0) {
      this.showAttract(s.level || LEVELS[0].levelId);
      return;
    }
    const level = getLevel(s.level);
    if (!level) return;
    const auth = buildWorld(s, level);
    if (!auth) return;
    if (this.mode !== 'play' || s.seq !== this.seq || this.levelKey !== s.level || myIdx !== this.local) {
      this.mode = 'play';
      this.seq = s.seq;
      this.levelKey = s.level;
      this.setLevel(s.level, myIdx, auth);
    }
    if (this.view) this.view.partnerName = s.slots[1 - myIdx]?.name ?? '';
    if (s.phase === 'playing' && !s.paused) {
      this.pred!.reconcile(auth, s.slots[myIdx].ack, s.slots[1 - myIdx].held);
    } else {
      this.pred!.hardSet(auth);
    }
  }

  // -------------------------------------------------------------------------
  // Frame loop

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 100);
    this.fpsAcc += delta;
    this.fpsFrames++;
    if (this.fpsAcc >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    const pred = this.pred;
    if (!pred || !this.view) return;

    let alpha = 1;
    if (this.mode === 'play' && this.phase === 'playing' && !this.paused) {
      this.acc += Math.min(delta, 250);
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 6) {
        const bits = this.hooks.inputBlocked() ? 0 : this.input2.sample();
        // Interact animation is local-only: the protocol does not replicate interact presses.
        if ((bits & Btn.InteractPressed) && interactTarget(pred.level, pred.world, this.local) >= 0) this.view.notifyLocalInteract();
        const seq = pred.tick(bits);
        this.queueInput(seq, bits);
        if (this.sendBits.length >= NetTuning.inputBatchTicks || (bits & EDGE_MASK)) this.flushInputs();
        this.acc -= TICK_MS;
        steps++;
      }
      if (steps === 6) this.acc = 0;
      alpha = this.acc / TICK_MS;
    } else {
      this.acc = 0;
      this.input2.sample(); // drop stale edges
    }
    pred.decay(dt);

    this.updateCamera(dt);
    this.view.render(pred, alpha, dt, this.cameras.main, this.debug);
    this.hooks.frame({
      world: this.mode === 'play' ? pred.world : null,
      level: this.level,
      local: this.local,
      fps: this.fps,
      correction: pred.lastCorrection,
      pending: pred.pendingCount,
    });
  }

  private queueInput(seq: number, bits: number): void {
    if (!this.sendBits.length) this.sendFirst = seq;
    this.sendBits.push(bits);
  }

  private flushInputs(): void {
    if (!this.sendBits.length) return;
    session.sendInputs(this.sendFirst, this.sendBits);
    this.sendBits = [];
  }

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    const level = this.level!;
    const pred = this.pred!;
    const sw = this.scale.width, sh = this.scale.height;
    const W = level.widthPx, H = level.heightPx;

    let targetZoom: number;
    let tx: number, ty: number;
    if (this.mode === 'attract') {
      targetZoom = Math.max(sh / Math.min(H, 640), sw / Math.min(W, 1100));
      this.attractT += dt / 1000;
      const viewW = sw / targetZoom;
      const span = Math.max(0, W - viewW);
      tx = viewW / 2 + span * (0.5 + 0.5 * Math.sin(this.attractT * 0.12));
      ty = H / 2;
    } else if (this.overview) {
      targetZoom = Math.min(sw / (W + 64), sh / (H + 64));
      tx = W / 2;
      ty = H / 2;
    } else {
      // Frame roughly 960x540 world px on landscape screens; keep width on portrait.
      targetZoom = Math.min(sh / 540, sw / 760);
      targetZoom = Math.max(targetZoom, Math.min(sw / W, sh / H));
      const me = pred.world.players[this.local];
      const other = pred.world.players[1 - this.local];
      const mx = me.x + BW / 2, my = me.y + BH / 2;
      const ox = other.x + BW / 2, oy = other.y + BH / 2;
      tx = mx + me.facing * 30;
      ty = my - 30;
      const d = Math.hypot(ox - mx, oy - my);
      if (d < 640 && !other.dead) {
        const k = 0.35 * (1 - Math.max(0, d - 420) / 220);
        tx += (ox - mx) * k;
        ty += (oy - my) * k;
      }
    }

    // Pixel art needs whole-number zoom so every art pixel covers the same number of screen pixels.
    // (The overview map stays fractional so the whole level fits.)
    const pixel = this.pixelMode && !this.overview;
    if (pixel) targetZoom = Math.max(1, Math.round(targetZoom));
    const zk = this.snapCamera ? 1 : 1 - Math.exp(-dt / 160);
    this.zoom += (targetZoom - this.zoom) * zk;
    if (pixel && Math.abs(this.zoom - targetZoom) < 0.01) this.zoom = targetZoom;
    const viewW = sw / this.zoom, viewH = sh / this.zoom;
    tx = W > viewW ? Phaser.Math.Clamp(tx, viewW / 2, W - viewW / 2) : W / 2;
    ty = H > viewH ? Phaser.Math.Clamp(ty, viewH / 2, H - viewH / 2) : H / 2;
    const k = this.snapCamera ? 1 : 1 - Math.exp(-dt / (this.mode === 'attract' ? 400 : 110));
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    this.snapCamera = false;
    cam.setZoom(this.zoom);
    if (pixel) {
      // Snap the camera to the screen-pixel grid (not whole world pixels, which would judder).
      cam.centerOn(Math.round(this.camX * this.zoom) / this.zoom, Math.round(this.camY * this.zoom) / this.zoom);
    } else {
      cam.centerOn(this.camX, this.camY);
    }
  }
}
