// Everything drawn for one level: background, terrain, puzzle objects,
// characters, beams and the Resonance Link. Rendering only — it never decides
// game outcomes; it reads the (predicted) World each frame.

import Phaser from 'phaser';
import {
  type CompiledLevel, type ObjDef, type PlayerSim, type World, Btn, CrateTuning, PlayerTuning, TILE, Tile, WorldTuning, exitMask,
  interactTarget, tileAt,
} from '@duality/shared';
import { COLORS, HUES, CHAR_W, CHAR_H, PALETTES, type Palette } from './textures';
import { ANIM_LOOPS, SHEET_KEY, type CharAnim } from '../art/characters';
import { paintParallax, paintSky, paintTerrain } from './painter';
import type { Predictor, Vec2 } from './predictor';
import { sfx, setLinkHum } from '../audio/sfx';
import { settings } from '../settings';

const BW = PlayerTuning.bodyW;
const BH = PlayerTuning.bodyH;
const ELEMENT_COLOR = [COLORS.ember, COLORS.tide];

export type CharArtMode = 'classic' | 'sprites';

interface CharView {
  root: Phaser.GameObjects.Container;
  /** Classic procedural body + eyes (null in sprite mode). */
  body: Phaser.GameObjects.Image | null;
  eyes: Phaser.GameObjects.Graphics | null;
  /** Sprite-sheet character (null in classic mode). */
  sprite: Phaser.GameObjects.Sprite | null;
  anim: CharAnim | '';
  /** One-shot animation currently allowed to finish (respawn, land, interact). */
  oneShot: CharAnim | null;
  interactPending: boolean;
  glow: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
  label: Phaser.GameObjects.Text | null;
  squash: number;
  stretchV: number;
  wasGrounded: boolean;
  wasDead: boolean;
  prevVy: number;
  blink: number;
  lookX: number;
}

interface ObjView {
  def: ObjDef;
  g?: Phaser.GameObjects.Graphics;
  img?: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  tile?: Phaser.GameObjects.TileSprite;
  text?: Phaser.GameObjects.Text;
  emitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  last: string;
  anim: number;
  sfxAt: number;
  prevS: number;
}

const tmpA: Vec2 = { x: 0, y: 0 };
const tmpB: Vec2 = { x: 0, y: 0 };

export class LevelView {
  readonly pal: Palette;
  private layers: Phaser.GameObjects.GameObject[] = [];
  private sky: Phaser.GameObjects.Image;
  private para: Phaser.GameObjects.TileSprite[] = [];
  private objViews: ObjView[] = [];
  private chars: CharView[] = [];
  private beamG: Phaser.GameObjects.Graphics;
  private linkG: Phaser.GameObjects.Graphics;
  private fxG: Phaser.GameObjects.Graphics;
  private debugG: Phaser.GameObjects.Graphics;
  private surfaces: Phaser.GameObjects.TileSprite[] = [];
  private burst: Phaser.GameObjects.Particles.ParticleEmitter;
  private motes: Phaser.GameObjects.Particles.ParticleEmitter;
  private promptText: Phaser.GameObjects.Text;
  private linkWas = false;
  private lastWorld: World | null = null;
  private nearestSign = -1;
  private linkLevel = 0;
  private time = 0;
  partnerName = '';

  constructor(private scene: Phaser.Scene, readonly level: CompiledLevel, readonly local: number, private art: CharArtMode = 'classic') {
    const world = Math.max(1, Math.min(4, level.def.world));
    this.pal = PALETTES[world - 1];
    const W = level.widthPx, H = level.heightPx;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.layers.push(o); return o; };

    // Background: sky gradient + two parallax layers (fixed to the camera).
    const skyKey = `sky-${world}`;
    if (!scene.textures.exists(skyKey)) scene.textures.addCanvas(skyKey, paintSky(this.pal));
    this.sky = add(scene.add.image(0, 0, skyKey).setOrigin(0).setScrollFactor(0).setDepth(-100));
    for (const layer of [0, 1] as const) {
      const key = `para-${world}-${layer}`;
      if (!scene.textures.exists(key)) scene.textures.addCanvas(key, paintParallax(this.pal, world, layer));
      const ts = add(scene.add.tileSprite(0, 0, 1024, 576, key).setOrigin(0).setScrollFactor(0).setDepth(-90 + layer));
      ts.setAlpha(layer === 0 ? 0.9 : 1);
      this.para.push(ts);
    }

    // Ambient motes
    this.motes = add(scene.add.particles(0, 0, 'dot', {
      x: { min: 0, max: W }, y: { min: 0, max: H },
      lifespan: 6000, speedY: world === 4 ? { min: -6, max: 6 } : { min: -18, max: -4 }, speedX: world === 4 ? { min: 20, max: 50 } : { min: -6, max: 6 },
      scale: { start: 0.35, end: 0 }, alpha: { start: 0.6, end: 0 }, tint: this.pal.mote,
      frequency: settings.reducedMotion ? 600 : 160, blendMode: 'ADD', maxParticles: 60,
    }).setDepth(-50));

    // Terrain: one texture for the whole level.
    const scale = Math.min(2, 4096 / Math.max(W, H));
    const tkey = `terrain-${level.id}`;
    if (scene.textures.exists(tkey)) scene.textures.remove(tkey);
    scene.textures.addCanvas(tkey, paintTerrain(level, this.pal, scale));
    add(scene.add.image(0, 0, tkey).setOrigin(0).setScale(1 / scale).setDepth(0));

    // Animated liquid surfaces, one TileSprite per horizontal run.
    for (let r = 0; r < level.rows; r++) {
      let c = 0;
      while (c < level.cols) {
        const t = tileAt(level, c, r);
        if (t === Tile.Lava || t === Tile.Water || t === Tile.Toxic) {
          let e = c;
          while (e + 1 < level.cols && tileAt(level, e + 1, r) === t) e++;
          const key = t === Tile.Lava ? 'lava' : t === Tile.Water ? 'water' : 'toxic';
          const s = add(scene.add.tileSprite(c * TILE, r * TILE - 5, (e - c + 1) * TILE, 12, `surf-${key}`).setOrigin(0).setDepth(6));
          s.setData('speed', key === 'lava' ? 12 : key === 'water' ? 22 : 16);
          this.surfaces.push(s);
          if (key !== 'water') {
            const gl = add(scene.add.image((c + e + 1) * TILE / 2, r * TILE, 'glow').setDepth(5).setBlendMode('ADD'));
            gl.setDisplaySize((e - c + 1) * TILE * 1.3, 70).setTint(key === 'lava' ? 0xff7a2a : 0x7dde4a).setAlpha(0.35);
          }
          c = e + 1;
        } else c++;
      }
    }

    // Static decoration graphics (tracks).
    const deco = add(scene.add.graphics().setDepth(1));
    for (const o of level.objects) {
      if ((o.type === 'platform' || o.type === 'saw') && (o.toX || o.toY)) {
        const cx = o.x + o.w / 2, cy = o.y + (o.type === 'platform' ? 7 : o.h / 2);
        deco.lineStyle(2, 0xffffff, 0.12);
        const steps = Math.max(2, Math.round(Math.hypot(o.toX, o.toY) / 10));
        for (let i = 0; i < steps; i += 2) {
          const a = i / steps, b = Math.min(1, (i + 1) / steps);
          deco.lineBetween(cx + o.toX * a, cy + o.toY * a, cx + o.toX * b, cy + o.toY * b);
        }
        deco.fillStyle(0xffffff, 0.18);
        deco.fillCircle(cx, cy, 3);
        deco.fillCircle(cx + o.toX, cy + o.toY, 3);
      }
    }

    for (const o of level.objects) this.objViews.push(this.createObj(o));

    this.beamG = add(scene.add.graphics().setDepth(14).setBlendMode('ADD'));
    this.linkG = add(scene.add.graphics().setDepth(19).setBlendMode('ADD'));
    this.fxG = add(scene.add.graphics().setDepth(40));
    this.debugG = add(scene.add.graphics().setDepth(60));

    for (let i = 0; i < 2; i++) this.chars.push(this.createChar(i));

    this.burst = add(scene.add.particles(0, 0, 'dot', {
      speed: { min: 60, max: 260 }, lifespan: { min: 300, max: 800 }, scale: { start: 0.7, end: 0 },
      gravityY: 300, blendMode: 'ADD', emitting: false,
    }).setDepth(30));

    this.promptText = add(scene.add.text(0, 0, '', {
      fontFamily: 'Fredoka, sans-serif', fontSize: '13px', color: '#1a1424', backgroundColor: '#f3eefc',
      padding: { x: 6, y: 2 }, resolution: Math.min(3, window.devicePixelRatio * 2),
    }).setOrigin(0.5, 1).setDepth(45).setVisible(false));
  }

  destroy(): void {
    for (const o of this.layers) o.destroy();
    for (const v of this.objViews) {
      v.g?.destroy(); v.img?.destroy(); v.glow?.destroy(); v.tile?.destroy(); v.text?.destroy(); v.emitter?.destroy();
    }
    this.destroyChars();
    setLinkHum(0);
    this.layers = [];
  }

  // -------------------------------------------------------------------------
  // Creation

  private destroyChars(): void {
    for (const c of this.chars) { c.root.destroy(); c.trail.destroy(); c.glow.destroy(); c.label?.destroy(); }
    this.chars = [];
  }

  /** Switch between classic and sprite-sheet characters without rebuilding the level. */
  setArt(art: CharArtMode): void {
    if (art === this.art) return;
    this.art = art;
    this.destroyChars();
    for (let i = 0; i < 2; i++) this.chars.push(this.createChar(i));
  }

  get artMode(): CharArtMode {
    return this.art;
  }

  /** The local player pressed interact next to something usable (drives the interact animation). */
  notifyLocalInteract(): void {
    const c = this.chars[this.local];
    if (c) c.interactPending = true;
  }

  /** Current animation state of a character (for tests and debugging). */
  animState(i: number): { anim: string; flipX: boolean; frame: string; x: number; y: number; mode: CharArtMode } | null {
    const c = this.chars[i];
    if (!c) return null;
    return { anim: c.anim, flipX: c.sprite?.flipX ?? false, frame: String(c.sprite?.frame.name ?? ''), x: c.root.x, y: c.root.y, mode: this.art };
  }

  private createChar(i: number): CharView {
    const s = this.scene;
    const glow = s.add.image(0, 0, 'glow').setBlendMode('ADD').setTint(ELEMENT_COLOR[i]).setAlpha(0.55).setDisplaySize(110, 110).setDepth(20);
    let body: Phaser.GameObjects.Image | null = null;
    let eyes: Phaser.GameObjects.Graphics | null = null;
    let sprite: Phaser.GameObjects.Sprite | null = null;
    let root: Phaser.GameObjects.Container;
    if (this.art === 'sprites' && s.textures.exists(SHEET_KEY[i])) {
      // Frame bottom-centre (16, 40) is the pivot; feet sit on the body's bottom edge.
      sprite = s.add.sprite(0, 0, SHEET_KEY[i], '0').setOrigin(0.5, 1);
      // Animations live on the sprite itself so Ember's and Tide's tag names never collide.
      s.anims.createFromAseprite(SHEET_KEY[i], undefined, sprite);
      root = s.add.container(0, 0, [sprite]).setDepth(22);
    } else {
      body = s.add.image(0, 0, i === 0 ? 'ember-body' : 'tide-body').setOrigin(0.5, 1).setDisplaySize(CHAR_W, CHAR_H);
      eyes = s.add.graphics();
      root = s.add.container(0, 0, [body, eyes]).setDepth(22);
    }
    const trail = s.add.particles(0, 0, i === 0 ? 'spark' : 'dot', i === 0 ? {
      speedY: { min: -70, max: -30 }, speedX: { min: -20, max: 20 }, lifespan: { min: 250, max: 550 },
      scale: { start: 0.55, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xffd166, 0xff8a3d, 0xff5a1f],
      frequency: settings.reducedMotion ? 160 : 55, blendMode: 'ADD', maxParticles: 40,
    } : {
      speedY: { min: 10, max: 60 }, speedX: { min: -15, max: 15 }, gravityY: 300, lifespan: { min: 250, max: 500 },
      scale: { start: 0.45, end: 0.1 }, alpha: { start: 0.8, end: 0 }, tint: [0xa6f0ff, 0x3cc8ff],
      frequency: settings.reducedMotion ? 220 : 90, blendMode: 'ADD', maxParticles: 30,
    }).setDepth(21);
    let label: Phaser.GameObjects.Text | null = null;
    if (i !== this.local) {
      label = s.add.text(0, 0, '', {
        fontFamily: 'Nunito, sans-serif', fontStyle: '800', fontSize: '11px', color: i === 0 ? '#ffcf9e' : '#bff3ff',
        stroke: '#0d0b17', strokeThickness: 3, resolution: Math.min(3, window.devicePixelRatio * 2),
      }).setOrigin(0.5, 1).setDepth(23);
    }
    const view: CharView = {
      root, body, eyes, sprite, anim: '', oneShot: null, interactPending: false, glow, trail, label,
      squash: 0, stretchV: 0, wasGrounded: true, wasDead: false, prevVy: 0, blink: 2 + Math.random() * 3, lookX: 0,
    };
    // A finished one-shot hands control back to the state machine.
    sprite?.on(Phaser.Animations.Events.ANIMATION_COMPLETE, (anim: Phaser.Animations.Animation) => {
      if (view.oneShot === anim.key) view.oneShot = null;
    });
    return view;
  }

  private createObj(o: ObjDef): ObjView {
    const s = this.scene;
    const v: ObjView = { def: o, last: '', anim: 0, sfxAt: 0, prevS: -1 };
    const hue = HUES[o.hue % HUES.length];
    switch (o.type) {
      case 'crate':
        v.img = s.add.image(o.x, o.y, 'crate').setOrigin(0).setDisplaySize(CrateTuning.size, CrateTuning.size).setDepth(12);
        break;
      case 'saw':
        v.img = s.add.image(o.x, o.y, 'saw').setDisplaySize(30, 30).setDepth(13);
        break;
      case 'crystal':
        v.glow = s.add.image(o.x + o.w / 2, o.y + o.h / 2, 'glow').setBlendMode('ADD').setTint(COLORS.link).setDisplaySize(90, 90).setAlpha(0.2).setDepth(9);
        v.img = s.add.image(o.x + o.w / 2, o.y + o.h / 2, 'crystal').setDisplaySize(20, 28).setDepth(10);
        break;
      case 'gate':
        v.tile = s.add.tileSprite(o.x, o.y, o.w, o.h, o.element === 'tide' ? 'gate-tide' : 'gate-ember').setOrigin(0).setDepth(11).setAlpha(0.85);
        v.g = s.add.graphics().setDepth(11);
        v.g.lineStyle(2, o.element === 'tide' ? COLORS.tide : COLORS.ember, 0.8);
        if (o.h >= o.w) { v.g.lineBetween(o.x, o.y, o.x, o.y + o.h); v.g.lineBetween(o.x + o.w, o.y, o.x + o.w, o.y + o.h); }
        else { v.g.lineBetween(o.x, o.y, o.x + o.w, o.y); v.g.lineBetween(o.x, o.y + o.h, o.x + o.w, o.y + o.h); }
        break;
      case 'sign': {
        v.g = s.add.graphics().setDepth(3);
        const cx = o.x + TILE / 2, by = o.y + TILE;
        v.g.fillStyle(0x000000, 0.25).fillRoundedRect(cx - 9, by - 22, 18, 22, 3);
        v.g.fillStyle(0xf3eefc, 0.92).fillRoundedRect(cx - 10, by - 24, 20, 16, 4);
        v.g.fillStyle(0x6b5a8a, 1).fillRect(cx - 1.5, by - 8, 3, 8);
        v.text = s.add.text(cx, by - 16, '?', { fontFamily: 'Fredoka, sans-serif', fontSize: '13px', color: '#2a1d3d', resolution: 3 }).setOrigin(0.5).setDepth(4);
        const bubble = s.add.text(cx, by - 30, o.text, {
          fontFamily: 'Nunito, sans-serif', fontStyle: '700', fontSize: '13px', color: '#f3eefc', backgroundColor: 'rgba(20,16,34,0.92)',
          padding: { x: 10, y: 7 }, wordWrap: { width: 230 }, align: 'center', resolution: Math.min(3, window.devicePixelRatio * 2),
        }).setOrigin(0.5, 1).setDepth(44).setAlpha(0);
        v.img = bubble as unknown as Phaser.GameObjects.Image;
        break;
      }
      case 'exit':
        v.g = s.add.graphics().setDepth(2);
        v.glow = s.add.image(o.x + o.w / 2, o.y + o.h / 2, 'glow').setBlendMode('ADD').setDisplaySize(o.w * 2.4, o.h * 1.8).setAlpha(0.35).setDepth(1);
        v.emitter = s.add.particles(0, 0, 'dot', {
          x: { min: o.x + 6, max: o.x + o.w - 6 }, y: { min: o.y + o.h * 0.3, max: o.y + o.h },
          speedY: { min: -40, max: -15 }, lifespan: 1400, scale: { start: 0.4, end: 0 }, alpha: { start: 0.8, end: 0 },
          tint: [COLORS.ember2, COLORS.tide2, COLORS.link], frequency: 90, blendMode: 'ADD', maxParticles: 30,
        }).setDepth(3);
        break;
      case 'fan':
        v.g = s.add.graphics().setDepth(8);
        v.emitter = s.add.particles(0, 0, 'streak', this.fanParticles(o)).setDepth(7);
        break;
      case 'node':
        v.g = s.add.graphics().setDepth(8);
        v.glow = s.add.image(o.x + o.w / 2, o.y + o.h / 2, 'glow').setBlendMode('ADD').setTint(o.element === 'tide' ? COLORS.tide : COLORS.ember).setDisplaySize(100, 100).setAlpha(0).setDepth(7);
        v.emitter = s.add.particles(o.x + o.w / 2, o.y + o.h - 14, o.element === 'tide' ? 'dot' : 'spark', o.element === 'tide' ? {
          speedY: { min: -60, max: -20 }, speedX: { min: -25, max: 25 }, gravityY: 160, lifespan: 600, scale: { start: 0.4, end: 0 },
          tint: [0xa6f0ff, 0x3cc8ff], frequency: 70, blendMode: 'ADD', emitting: false, maxParticles: 24,
        } : {
          speedY: { min: -90, max: -40 }, speedX: { min: -12, max: 12 }, lifespan: 500, scale: { start: 0.7, end: 0 },
          tint: [0xffd166, 0xff8a3d, 0xff4d1f], frequency: 40, blendMode: 'ADD', emitting: false, maxParticles: 30,
        }).setDepth(9);
        break;
      case 'receiver': case 'plate': case 'lever': case 'checkpoint':
        v.g = s.add.graphics().setDepth(o.type === 'plate' ? 7 : 8);
        v.glow = s.add.image(o.x + o.w / 2, o.y + o.h - (o.type === 'plate' ? 4 : o.h / 2), 'glow').setBlendMode('ADD')
          .setTint(o.type === 'checkpoint' ? 0xffffff : hue).setDisplaySize(o.type === 'plate' ? o.w * 1.8 : 80, o.type === 'plate' ? 40 : 80).setAlpha(0).setDepth(6);
        break;
      default:
        v.g = s.add.graphics().setDepth(o.type === 'door' ? 10 : o.type === 'platform' ? 12 : 9);
        if (o.type === 'field') v.glow = s.add.image(o.x + o.w / 2, o.y + o.h / 2, 'glow').setBlendMode('ADD').setTint(0xa6c8ff).setDisplaySize(o.w * 2, o.h * 1.5).setAlpha(0).setDepth(8);
        if (o.type === 'emitter') v.glow = s.add.image(o.x + o.w / 2, o.y + o.h / 2, 'glow').setBlendMode('ADD').setTint(0xffe9a8).setDisplaySize(70, 70).setAlpha(0).setDepth(8);
    }
    return v;
  }

  private fanParticles(o: ObjDef): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
    const sp = 260;
    const base = { lifespan: 900, alpha: { start: 0.5, end: 0 }, scale: { start: 0.9, end: 0.6 }, frequency: settings.reducedMotion ? 120 : 45, blendMode: 'ADD', emitting: false, maxParticles: 40, tint: 0xdff6ff };
    switch (o.dir) {
      case 'up': return { ...base, x: { min: o.x + 4, max: o.x + o.w - 4 }, y: o.y + o.h - 4, speedY: { min: -sp, max: -sp * 0.6 }, lifespan: (o.h / sp) * 1300 };
      case 'down': return { ...base, x: { min: o.x + 4, max: o.x + o.w - 4 }, y: o.y + 4, speedY: { min: sp * 0.6, max: sp }, lifespan: (o.h / sp) * 1300 };
      case 'left': return { ...base, y: { min: o.y + 4, max: o.y + o.h - 4 }, x: o.x + o.w - 4, speedX: { min: -sp, max: -sp * 0.6 }, rotate: 90, lifespan: (o.w / sp) * 1300 };
      default: return { ...base, y: { min: o.y + 4, max: o.y + o.h - 4 }, x: o.x + 4, speedX: { min: sp * 0.6, max: sp }, rotate: 90, lifespan: (o.w / sp) * 1300 };
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame render

  render(pred: Predictor, alpha: number, dtMs: number, cam: Phaser.Cameras.Scene2D.Camera, debug: boolean): void {
    const w = pred.world;
    this.lastWorld = w;
    this.time += dtMs / 1000;
    const t = this.time;

    // Background follows the camera.
    const view = cam.worldView;
    // Scroll-factor-0 objects are still scaled around the camera centre, so
    // offset them to keep the backdrop covering the whole screen at any zoom.
    const bw = cam.width / cam.zoom + 4, bh = cam.height / cam.zoom + 4;
    const bx = (cam.width - bw) / 2, by = (cam.height - bh) / 2;
    this.sky.setPosition(bx, by).setDisplaySize(bw, bh);
    this.para.forEach((p, i) => {
      p.setPosition(bx, by).setSize(bw, bh);
      p.tilePositionX = view.x * (i === 0 ? 0.15 : 0.35);
      p.tilePositionY = view.y * (i === 0 ? 0.05 : 0.12);
    });
    for (const s of this.surfaces) s.tilePositionX += (s.getData('speed') as number) * dtMs / 1000;

    // Only the nearest sign shows its bubble, so tutorial text never overlaps.
    this.nearestSign = -1;
    let best = Infinity;
    const lp = w.players[this.local];
    for (const si of this.level.ofType.sign) {
      const o = this.level.objects[si];
      const dx = Math.abs(lp.x + BW / 2 - (o.x + TILE / 2)), dy = Math.abs(lp.y + BH / 2 - (o.y + TILE / 2));
      if (dx < TILE * 3.5 && dy < TILE * 3 && dx + dy < best) { best = dx + dy; this.nearestSign = si; }
    }
    for (let i = 0; i < this.objViews.length; i++) this.renderObj(this.objViews[i], w, pred, alpha, t, i);
    this.renderBeams(w, t);
    for (let i = 0; i < 2; i++) this.renderChar(i, pred, alpha, dtMs, t, cam);
    this.renderLink(pred, alpha, t);
    this.renderPrompt(w, pred);
    this.renderPartnerArrow(pred, alpha, cam);
    if (debug) this.renderDebug(w); else this.debugG.clear();
  }

  private renderObj(v: ObjView, w: World, pred: Predictor, alpha: number, t: number, i: number): void {
    const o = v.def;
    const st = w.objs[i];
    const g = v.g;
    const hue = HUES[o.hue % HUES.length];
    const now = this.time;
    const changed = v.prevS !== -1 && v.prevS !== st.s;
    const canSfx = changed && now - v.sfxAt > 0.25;
    if (canSfx) v.sfxAt = now;

    switch (o.type) {
      case 'door': {
        const key = `${st.p.toFixed(3)}|${o.sources.map((si) => w.sig[si]).join('')}`;
        if (canSfx && v.prevS !== -1) sfx.door(st.s === 1);
        if (key === v.last) break;
        v.last = key;
        g!.clear();
        if (o.style === 'bridge') {
          const solid = st.p < 0.5;
          if (solid) {
            g!.fillStyle(hue, 0.35).fillRect(o.x, o.y + 2, o.w, o.h - 4);
            g!.fillStyle(0xffffff, 0.85).fillRect(o.x, o.y + 2, o.w, 3);
            g!.lineStyle(1, hue, 0.9).strokeRect(o.x + 0.5, o.y + 2.5, o.w - 1, o.h - 5);
            for (let x = o.x + 6; x < o.x + o.w; x += 12) g!.fillStyle(0xffffff, 0.25).fillRect(x, o.y + 8, 6, 2);
          } else {
            g!.lineStyle(1, hue, 0.35);
            for (let x = o.x; x < o.x + o.w; x += 8) g!.lineBetween(x, o.y + 3, Math.min(x + 4, o.x + o.w), o.y + 3);
          }
        } else {
          const vertical = o.h >= o.w;
          const open = Math.min(1, st.p);
          const sx = vertical ? o.x : o.x + o.w * open, sy = o.y;
          const sw = vertical ? o.w : o.w * (1 - open), sh = vertical ? o.h * (1 - open) : o.h;
          if (sw > 0.5 && sh > 0.5) {
            g!.fillStyle(0x1b1f2a, 1).fillRect(sx, sy, sw, sh);
            g!.fillStyle(0x3a4252, 1).fillRect(sx + 3, sy, sw - 6, sh);
            g!.fillStyle(hue, 0.85);
            if (vertical) { for (let y = sy + sh - 10; y > sy; y -= 16) g!.fillRect(sx + 7, y, sw - 14, 3); }
            else { for (let x = sx + sw - 10; x > sx; x -= 16) g!.fillRect(x, sy + 7, 3, sh - 14); }
            g!.fillStyle(hue, 1);
            if (vertical) g!.fillRect(sx, sy + sh - 3, sw, 3); else g!.fillRect(sx, sy, 3, sh);
          }
          // Frame & lamps (one per input)
          g!.fillStyle(0x0d0b17, 0.6);
          const lamps = o.sources.length;
          for (let k = 0; k < lamps; k++) {
            const on = w.sig[o.sources[k]] === 1;
            const lx = vertical ? o.x + o.w / 2 : o.x - 6, ly = vertical ? o.y - 6 - k * 9 : o.y + o.h / 2 + (k - (lamps - 1) / 2) * 9;
            g!.fillStyle(0x0d0b17, 0.9).fillCircle(lx, ly, 4.5);
            g!.fillStyle(HUES[this.level.objects[o.sources[k]].hue % HUES.length], on ? 1 : 0.28).fillCircle(lx, ly, 3.2);
          }
        }
        break;
      }
      case 'plate': {
        if (canSfx) sfx.plate(st.s === 1);
        const key = `${st.s}`;
        v.glow!.setAlpha(st.s ? 0.55 + Math.sin(t * 6) * 0.1 : 0);
        if (key === v.last) break;
        v.last = key;
        const by = o.y + o.h;
        g!.clear();
        g!.fillStyle(0x15121e, 1).fillRoundedRect(o.x + 1, by - 5, o.w - 2, 5, 2);
        const capY = st.s ? by - 6 : by - 9;
        g!.fillStyle(hue, st.s ? 1 : 0.75).fillRoundedRect(o.x + 4, capY, o.w - 8, st.s ? 3 : 5, 2);
        g!.fillStyle(0xffffff, st.s ? 0.7 : 0.35).fillRect(o.x + 6, capY, o.w - 12, 1);
        break;
      }
      case 'lever': {
        if (canSfx) sfx.lever();
        const timer = o.timerTicks > 0 && st.s ? 1 - st.p / o.timerTicks : 0;
        const key = `${st.s}|${timer.toFixed(2)}`;
        v.glow!.setAlpha(st.s ? 0.5 : 0);
        if (key === v.last) break;
        v.last = key;
        const cx = o.x + o.w / 2, by = o.y + o.h;
        g!.clear();
        const elc = o.element === 'ember' ? COLORS.ember : o.element === 'tide' ? COLORS.tide : 0x5a5170;
        g!.fillStyle(0x15121e, 1).fillRoundedRect(cx - 11, by - 8, 22, 8, 3);
        g!.fillStyle(elc, 1).fillRect(cx - 9, by - 3, 18, 2);
        const ang = (st.s ? 40 : -40) * Math.PI / 180;
        const hx = cx + Math.sin(ang) * 18, hy = by - 6 - Math.cos(ang) * 18;
        g!.lineStyle(4, 0xb8b0c8, 1).lineBetween(cx, by - 6, hx, hy);
        g!.fillStyle(hue, 1).fillCircle(hx, hy, 5);
        g!.fillStyle(0xffffff, 0.6).fillCircle(hx - 1.5, hy - 1.5, 1.5);
        if (timer > 0) {
          g!.lineStyle(3, hue, 0.9);
          g!.beginPath(); g!.arc(cx, by - 22, 14, -Math.PI / 2, -Math.PI / 2 + timer * Math.PI * 2); g!.strokePath();
        }
        break;
      }
      case 'node': {
        const lit = st.s === 1;
        const isTide = o.element === 'tide';
        if (canSfx && lit) sfx.node(isTide ? 1 : 0);
        v.emitter!.emitting = lit;
        v.glow!.setAlpha(lit ? 0.6 + Math.sin(t * 8) * 0.12 : 0.08);
        const timer = o.timerTicks > 0 && lit ? 1 - st.p / o.timerTicks : 0;
        const key = `${st.s}|${timer.toFixed(2)}`;
        if (key === v.last) break;
        v.last = key;
        const cx = o.x + o.w / 2, by = o.y + o.h;
        g!.clear();
        if (isTide) {
          g!.fillStyle(0x15121e, 1).fillRoundedRect(cx - 13, by - 14, 26, 14, 5);
          g!.fillStyle(lit ? COLORS.tide : 0x1d3446, 1).fillRoundedRect(cx - 10, by - 11, 20, 8, 3);
          g!.fillStyle(COLORS.tide2, lit ? 0.9 : 0.25).fillCircle(cx, by - 20, 5);
          g!.lineStyle(2, COLORS.tide, 0.8).strokeCircle(cx, by - 20, 7);
        } else {
          g!.fillStyle(0x15121e, 1);
          g!.beginPath(); g!.moveTo(cx - 14, by - 14); g!.lineTo(cx + 14, by - 14); g!.lineTo(cx + 8, by); g!.lineTo(cx - 8, by); g!.closePath(); g!.fillPath();
          g!.fillStyle(lit ? COLORS.ember2 : 0x4a2a1f, 1).fillRect(cx - 12, by - 15, 24, 3);
          if (!lit) { g!.fillStyle(0x6b3a22, 1).fillCircle(cx, by - 18, 3); }
        }
        g!.fillStyle(hue, 1).fillCircle(cx, by - 3, 2.5);
        if (timer > 0) {
          g!.lineStyle(3, isTide ? COLORS.tide2 : COLORS.ember2, 0.9);
          g!.beginPath(); g!.arc(cx, by - 20, 15, -Math.PI / 2, -Math.PI / 2 + timer * Math.PI * 2); g!.strokePath();
        }
        break;
      }
      case 'ice': {
        if (canSfx && st.s === 1) { sfx.ice(); this.burst.explode(16, o.x + o.w / 2, o.y + o.h / 2); }
        const fade = st.s === 0 ? 1 : st.s === 1 ? 1 - st.p / WorldTuning.iceMeltTicks : 0;
        const key = fade.toFixed(2);
        if (key === v.last) break;
        v.last = key;
        g!.clear();
        if (fade <= 0) break;
        g!.fillStyle(0x9fe8ff, 0.55 * fade).fillRect(o.x + 1, o.y, o.w - 2, o.h);
        g!.fillStyle(0xe8fbff, 0.7 * fade).fillRect(o.x + 1, o.y, o.w - 2, 3);
        g!.lineStyle(1, 0xffffff, 0.6 * fade);
        for (let y = o.y + 8; y < o.y + o.h; y += 22) { g!.lineBetween(o.x + 5, y, o.x + o.w / 2, y + 7); g!.lineBetween(o.x + o.w / 2, y + 7, o.x + o.w - 6, y + 2); }
        g!.lineStyle(2, 0xcff6ff, 0.8 * fade).strokeRect(o.x + 1, o.y, o.w - 2, o.h);
        break;
      }
      case 'crate': {
        pred.objPos(i, alpha, tmpA);
        v.img!.setPosition(tmpA.x, tmpA.y);
        break;
      }
      case 'platform': {
        pred.objPos(i, alpha, tmpA);
        const key = `${tmpA.x.toFixed(2)},${tmpA.y.toFixed(2)}`;
        if (key === v.last) break;
        v.last = key;
        g!.clear();
        g!.fillStyle(0x15121e, 1).fillRoundedRect(tmpA.x, tmpA.y, o.w, o.h, 4);
        g!.fillStyle(0x4a5468, 1).fillRoundedRect(tmpA.x + 1, tmpA.y + 1, o.w - 2, o.h - 4, 3);
        g!.fillStyle(hue, 1).fillRect(tmpA.x + 2, tmpA.y, o.w - 4, 3);
        for (let x = tmpA.x + 8; x < tmpA.x + o.w - 4; x += 14) g!.fillStyle(0x15121e, 0.6).fillCircle(x, tmpA.y + 8, 1.6);
        break;
      }
      case 'saw': {
        pred.objPos(i, alpha, tmpA);
        v.img!.setPosition(tmpA.x, tmpA.y).setRotation(t * 14);
        break;
      }
      case 'fan': {
        const on = st.s === 1;
        v.emitter!.emitting = on;
        const key = `${on}|${Math.floor(t * 30) % 4}`;
        if (key === v.last) break;
        v.last = key;
        g!.clear();
        const horizontal = o.dir === 'left' || o.dir === 'right';
        const bx = o.dir === 'right' ? o.x : o.dir === 'left' ? o.x + o.w - 10 : o.x;
        const by = o.dir === 'up' ? o.y + o.h - 10 : o.dir === 'down' ? o.y : o.y;
        g!.fillStyle(0x15121e, 1).fillRect(bx, by, horizontal ? 10 : o.w, horizontal ? o.h : 10);
        g!.fillStyle(on ? 0xdff6ff : 0x4a5468, 1);
        const n = Math.floor((horizontal ? o.h : o.w) / 8);
        const phase = on ? Math.floor(t * 30) % 4 : 0;
        for (let k = 0; k < n; k++) {
          const ww = ((k + phase) % 2) ? 5 : 2;
          if (horizontal) g!.fillRect(bx + 2, o.y + k * 8 + 2, 6, ww);
          else g!.fillRect(o.x + k * 8 + 2, by + 2, ww, 6);
        }
        g!.fillStyle(hue, 1).fillRect(bx, by, horizontal ? 2 : 6, horizontal ? 6 : 2);
        break;
      }
      case 'emitter': {
        const on = st.s === 1;
        v.glow!.setAlpha(on ? 0.6 : 0.1);
        const key = `${on}`;
        if (key === v.last) break;
        v.last = key;
        const cx = o.x + TILE / 2, cy = o.y + TILE / 2;
        g!.clear();
        g!.fillStyle(0x2a2238, 1).fillRoundedRect(o.x + 3, o.y + 3, TILE - 6, TILE - 6, 6);
        g!.lineStyle(2, 0xf6e9c8, 0.9).strokeRoundedRect(o.x + 3, o.y + 3, TILE - 6, TILE - 6, 6);
        g!.fillStyle(on ? 0xfff3c4 : 0x6b5a4a, 1).fillCircle(cx, cy, 6);
        const d = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] }[o.dir];
        g!.fillStyle(0xf6e9c8, 1).fillTriangle(cx + d[0] * 14 + d[1] * 5, cy + d[1] * 14 + d[0] * 5, cx + d[0] * 14 - d[1] * 5, cy + d[1] * 14 - d[0] * 5, cx + d[0] * 19, cy + d[1] * 19);
        break;
      }
      case 'mirror': {
        if (canSfx) sfx.mirror();
        const target = st.s ? -Math.PI / 4 : Math.PI / 4;
        v.anim += (target - v.anim) * 0.35;
        if (Math.abs(target - v.anim) < 0.001) v.anim = target;
        const key = v.anim.toFixed(3);
        if (key === v.last) break;
        v.last = key;
        const cx = o.x + TILE / 2, cy = o.y + TILE / 2;
        g!.clear();
        g!.fillStyle(0x1d1830, 0.9).fillCircle(cx, cy, 13);
        const ring = o.fixed ? 0x6b5a8a : o.element === 'ember' ? COLORS.ember : o.element === 'tide' ? COLORS.tide : 0xf6e9c8;
        g!.lineStyle(3, ring, 0.9).strokeCircle(cx, cy, 13);
        // '/' when angle = +45° (s=0): from bottom-left to top-right
        const ang = v.anim;
        const dx = Math.cos(ang) * 14, dy = -Math.sin(ang) * 14;
        g!.lineStyle(5, 0xdfe7f5, 1).lineBetween(cx - dx, cy - dy, cx + dx, cy + dy);
        g!.lineStyle(2, 0xffffff, 1).lineBetween(cx - dx * 0.8, cy - dy * 0.8, cx + dx * 0.8, cy + dy * 0.8);
        break;
      }
      case 'prism': {
        if (v.last) break;
        v.last = '1';
        const cx = o.x + TILE / 2, cy = o.y + TILE / 2;
        g!.fillStyle(0xc79bff, 0.5).fillTriangle(cx, cy - 13, cx + 13, cy + 10, cx - 13, cy + 10);
        g!.lineStyle(2, 0xf2e6ff, 1).strokeTriangle(cx, cy - 13, cx + 13, cy + 10, cx - 13, cy + 10);
        break;
      }
      case 'receiver': {
        if (canSfx) sfx.receiver(st.s === 1);
        v.glow!.setAlpha(st.s ? 0.65 + Math.sin(t * 7) * 0.1 : 0);
        const key = `${st.s}`;
        if (key === v.last) break;
        v.last = key;
        const cx = o.x + TILE / 2, cy = o.y + TILE / 2;
        g!.clear();
        g!.fillStyle(0x1d1830, 1).fillCircle(cx, cy, 13);
        g!.lineStyle(3, hue, 1).strokeCircle(cx, cy, 12);
        g!.fillStyle(st.s ? 0xfff3c4 : 0x3a3050, 1).fillCircle(cx, cy, 7);
        break;
      }
      case 'crystal': {
        if (canSfx) sfx.crystal(st.s === 1);
        const on = st.s === 1;
        const cy = o.y + o.h / 2 + Math.sin(t * 2 + i) * 2.5;
        v.img!.setY(cy).setTint(on ? 0xffffff : 0x9a88c0).setAlpha(on ? 1 : 0.8);
        v.glow!.setY(cy).setAlpha(on ? 0.75 + Math.sin(t * 10) * 0.15 : 0.15 + Math.sin(t * 2) * 0.05);
        break;
      }
      case 'field': {
        const on = st.s === 1;
        v.glow!.setAlpha(on ? 0.35 + Math.random() * 0.15 : 0);
        const key = on ? `${Math.floor(t * 20)}` : 'off';
        if (key === v.last) break;
        v.last = key;
        g!.clear();
        const vertical = o.h >= o.w;
        g!.fillStyle(0x2a2238, 1);
        if (vertical) { g!.fillRect(o.x + o.w / 2 - 5, o.y, 10, 5); g!.fillRect(o.x + o.w / 2 - 5, o.y + o.h - 5, 10, 5); }
        else { g!.fillRect(o.x, o.y + o.h / 2 - 5, 5, 10); g!.fillRect(o.x + o.w - 5, o.y + o.h / 2 - 5, 5, 10); }
        if (!on) {
          g!.lineStyle(1, 0xa6c8ff, 0.18);
          if (vertical) g!.lineBetween(o.x + o.w / 2, o.y + 5, o.x + o.w / 2, o.y + o.h - 5); else g!.lineBetween(o.x + 5, o.y + o.h / 2, o.x + o.w - 5, o.y + o.h / 2);
          break;
        }
        for (let k = 0; k < 3; k++) {
          g!.lineStyle(k === 0 ? 3 : 1.5, k === 0 ? 0x7fb2ff : 0xffffff, k === 0 ? 0.6 : 0.9);
          g!.beginPath();
          const n = 8;
          for (let s2 = 0; s2 <= n; s2++) {
            const a = s2 / n;
            const j = s2 === 0 || s2 === n ? 0 : (Math.random() - 0.5) * (vertical ? o.w * 0.8 : o.h * 0.8);
            const x = vertical ? o.x + o.w / 2 + j : o.x + 5 + (o.w - 10) * a;
            const y = vertical ? o.y + 5 + (o.h - 10) * a : o.y + o.h / 2 + j;
            if (s2 === 0) g!.moveTo(x, y); else g!.lineTo(x, y);
          }
          g!.strokePath();
        }
        break;
      }
      case 'checkpoint': {
        if (changed && st.s > v.prevS && v.prevS !== -1) { sfx.checkpoint(); this.burst.explode(18, o.x + o.w / 2, o.y + 10); }
        v.glow!.setAlpha(st.s ? 0.35 + Math.sin(t * 3) * 0.08 : 0);
        const key = `${st.s}|${Math.floor(t * 8) % 8}`;
        if (key === v.last) break;
        v.last = key;
        const px = o.x + o.w / 2, by = o.y + o.h;
        g!.clear();
        g!.fillStyle(0x15121e, 1).fillRoundedRect(px - 8, by - 5, 16, 5, 2);
        g!.fillStyle(0xd9d2e8, 1).fillRect(px - 1.5, by - o.h + 6, 3, o.h - 8);
        const wave = Math.sin(t * 6) * 2;
        const flagCol = st.s === 3 ? COLORS.link : st.s === 1 ? COLORS.ember : st.s === 2 ? COLORS.tide : 0x5a5170;
        g!.fillStyle(flagCol, 1);
        g!.beginPath(); g!.moveTo(px + 1.5, by - o.h + 6); g!.lineTo(px + 18, by - o.h + 12 + wave); g!.lineTo(px + 1.5, by - o.h + 19); g!.closePath(); g!.fillPath();
        break;
      }
      case 'exit': {
        const mask = exitMask(this.level, w);
        const prog = Math.min(1, w.exitTimer / WorldTuning.exitHoldTicks);
        v.glow!.setAlpha(0.3 + (mask ? 0.25 : 0) + Math.sin(t * 2) * 0.06).setTint(mask === 3 ? 0xffffff : COLORS.link);
        const key = `${mask}|${prog.toFixed(2)}|${Math.floor(t * 20)}`;
        if (key === v.last) break;
        v.last = key;
        g!.clear();
        const cx = o.x + o.w / 2, top = o.y;
        g!.fillStyle(0x0d0b17, 0.55);
        g!.fillRoundedRect(o.x + 2, top + 6, o.w - 4, o.h - 6, { tl: o.w / 2 - 2, tr: o.w / 2 - 2, bl: 0, br: 0 });
        for (let k = 0; k < 2; k++) {
          const a = t * 2.2 + k * Math.PI;
          g!.fillStyle(k === 0 ? COLORS.ember : COLORS.tide, 0.55);
          g!.fillCircle(cx + Math.cos(a) * (o.w * 0.22), top + o.h * 0.55 + Math.sin(a) * (o.h * 0.18), 5);
        }
        g!.lineStyle(3, 0xf3eefc, 0.85);
        g!.strokeRoundedRect(o.x + 2, top + 6, o.w - 4, o.h - 6, { tl: o.w / 2 - 2, tr: o.w / 2 - 2, bl: 0, br: 0 });
        // Rune lamps for each player
        g!.fillStyle(COLORS.ember, mask & 1 ? 1 : 0.25).fillCircle(cx - 8, top - 2, 4);
        g!.fillStyle(COLORS.tide, mask & 2 ? 1 : 0.25).fillCircle(cx + 8, top - 2, 4);
        if (prog > 0) {
          g!.lineStyle(4, 0xffffff, 0.9);
          g!.beginPath(); g!.arc(cx, top + o.h / 2, o.w * 0.42, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); g!.strokePath();
        }
        break;
      }
      case 'gate':
        v.tile!.tilePositionY -= 0.6;
        break;
      case 'sign': {
        const near = this.nearestSign === i;
        const bubble = v.img as unknown as Phaser.GameObjects.Text;
        const target = near ? 1 : 0;
        bubble.setAlpha(bubble.alpha + (target - bubble.alpha) * 0.15);
        v.text!.setY(o.y + TILE - 16 + Math.sin(t * 3) * 1.5);
        break;
      }
      default:
        break;
    }
    v.prevS = st.s;
  }

  private renderBeams(w: World, t: number): void {
    const g = this.beamG;
    g.clear();
    const b = w.beams;
    if (!b.length) return;
    const flicker = 0.85 + Math.sin(t * 30) * 0.05;
    for (const [width, color, a] of [[12, 0xffc76b, 0.18], [6, 0xffe9a8, 0.5], [2, 0xffffff, 0.95]] as const) {
      g.lineStyle(width, color, a * flicker);
      for (let k = 0; k < b.length; k += 4) g.lineBetween(b[k], b[k + 1], b[k + 2], b[k + 3]);
    }
    // Impact sparkle at every segment end
    for (let k = 0; k < b.length; k += 4) {
      g.fillStyle(0xffffff, 0.6 * flicker).fillCircle(b[k + 2], b[k + 3], 3 + Math.sin(t * 20 + k) * 1);
    }
  }

  private renderChar(i: number, pred: Predictor, alpha: number, dtMs: number, t: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    const c = this.chars[i];
    const p = pred.world.players[i];
    pred.playerPos(i, alpha, tmpA);
    const cx = tmpA.x + BW / 2, by = tmpA.y + BH;
    const dead = p.dead > 0;

    // Events (shared by both art modes)
    const died = dead && !c.wasDead;
    const respawned = !dead && c.wasDead;
    const landed = !dead && p.grounded && !c.wasGrounded && c.prevVy > 180;
    const jumped = !dead && p.vy < -400 && c.prevVy >= -50 && !p.grounded;
    // A real landing (not the one-tick settle after spawning, which falls at ~20 px/s).
    const newlyGrounded = !dead && p.grounded && !c.wasGrounded && c.prevVy > 60;
    if (died) {
      this.burst.setParticleTint(i === 0 ? 0xff8a3d : 0x3cc8ff);
      this.burst.explode(settings.reducedMotion ? 14 : 32, cx, by - BH / 2);
      sfx.death(i);
      if (i === this.local && !settings.reducedMotion) this.scene.cameras.main.shake(180, 0.006);
    }
    if (respawned) {
      sfx.respawn();
      this.burst.setParticleTint(0xffffff);
      this.burst.explode(12, cx, by - BH / 2);
      c.squash = -0.4;
    }
    if (landed) {
      c.squash = Math.min(0.35, c.prevVy / 1400);
      if (i === this.local || c.prevVy > 400) sfx.land();
    }
    if (jumped) {
      c.stretchV = 0.3;
      sfx.jump(i);
    }
    c.wasDead = dead;
    c.wasGrounded = p.grounded;
    c.prevVy = p.vy;

    c.glow.setVisible(!dead);
    c.trail.emitting = !dead && (i === 0 || Math.abs(p.vx) > 40 || !p.grounded);
    c.glow.setPosition(cx, by - BH / 2).setAlpha(0.45 + (i === 0 ? Math.sin(t * 13) * 0.08 : 0));
    c.trail.setPosition(cx, by - (i === 0 ? BH * 0.75 : BH * 0.3));
    if (c.label) {
      c.label.setText(this.partnerName).setPosition(cx, by - CHAR_H - 4).setVisible(!!this.partnerName && !dead);
    }

    if (c.sprite) {
      this.renderSpriteChar(c, p, dead, respawned, newlyGrounded, cx, by, cam);
      return;
    }

    c.root.setVisible(!dead);
    if (dead) return;

    // Classic procedural character: squash & stretch, lean, breathing, flicker, eyes.
    const k = Math.exp(-dtMs / 90);
    c.squash *= k;
    c.stretchV *= k;
    const breathe = p.grounded && Math.abs(p.vx) < 10 ? Math.sin(t * 3 + i) * 0.03 : 0;
    const flicker = i === 0 ? Math.sin(t * 23) * 0.025 + Math.sin(t * 37) * 0.02 : 0;
    const sy = 1 - c.squash + c.stretchV + breathe + flicker;
    const sx = 1 + c.squash * 0.8 - c.stretchV * 0.5 - breathe * 0.5;
    c.root.setPosition(cx, by);
    c.body!.setScale((CHAR_W / 90) * sx, (CHAR_H / 108) * sy);
    c.root.setRotation(Phaser.Math.Clamp(p.vx / 2600, -0.09, 0.09));
    c.lookX += ((p.facing > 0 ? 1 : -1) * (Math.abs(p.vx) > 5 ? 2.2 : 1.2) - c.lookX) * 0.2;
    c.blink -= dtMs / 1000;
    const blinking = c.blink < 0.12;
    if (c.blink < 0) c.blink = 2.5 + Math.random() * 3.5;
    const eyeY = -CHAR_H * 0.42 * sy;
    const eyes = c.eyes!;
    eyes.clear();
    for (const ex of [-5, 5]) {
      const x = ex * sx + c.lookX;
      if (blinking) {
        eyes.fillStyle(0x1b1530, 1).fillRect(x - 3, eyeY, 6, 1.6);
      } else {
        eyes.fillStyle(0xffffff, 1).fillEllipse(x, eyeY, 6.4, 8);
        eyes.fillStyle(0x1b1530, 1).fillEllipse(x + c.lookX * 0.45, eyeY + 0.8, 3.4, 4.6);
      }
    }
  }

  /**
   * Sprite-sheet character. The animation is chosen purely from replicated
   * player state, so it works the same for the local player and the partner.
   * No procedural scaling or rotation: pixel art is only translated or mirrored.
   */
  private renderSpriteChar(
    c: CharView, p: PlayerSim, dead: boolean, respawned: boolean, newlyGrounded: boolean,
    cx: number, by: number, cam: Phaser.Cameras.Scene2D.Camera,
  ): void {
    const sprite = c.sprite!;
    c.root.setVisible(true);
    c.root.setRotation(0);
    // Snap to the screen-pixel grid; the physics position itself stays fractional.
    const z = cam.zoom;
    c.root.setPosition(Math.round(cx * z) / z, Math.round(by * z) / z);
    if (!dead) sprite.setFlipX(p.facing < 0);

    let want: CharAnim;
    if (dead) {
      c.oneShot = null;
      c.interactPending = false;
      want = 'death';
    } else {
      if (respawned) c.oneShot = 'respawn';
      if (newlyGrounded && c.oneShot !== 'respawn' && !respawned) c.oneShot = 'land';
      if (c.interactPending) { c.oneShot = 'interact'; c.interactPending = false; }
      // A body at rest (spawn, respawn, countdown) has not been grounded by a tick yet:
      // exactly zero velocity never happens mid-flight, so treat it as standing.
      const airborne = !p.grounded && !(p.vx === 0 && p.vy === 0);
      if (airborne) {
        // Only a real jump/fall cancels respawn; interact may finish in the air.
        if (c.oneShot !== 'interact') c.oneShot = null;
        want = c.oneShot ?? (p.vy < 0 ? 'jump_rise' : 'fall');
      } else if (c.oneShot) {
        want = c.oneShot;
      } else if (this.isPushing(p)) {
        want = 'push';
      } else if (Math.abs(p.vx) > 20) {
        want = 'run';
      } else {
        want = 'idle';
      }
    }

    if (want !== c.anim) {
      c.anim = want;
      sprite.play({ key: want, repeat: ANIM_LOOPS[want] ? -1 : 0 });
    }
    sprite.anims.timeScale = want === 'run' ? Phaser.Math.Clamp(Math.abs(p.vx) / PlayerTuning.maxSpeed, 0.6, 1.3) : 1;
  }

  /** Grounded, holding a direction, and flush against a crate on that side. */
  private isPushing(p: PlayerSim): boolean {
    const dir = ((p.held & Btn.Right) ? 1 : 0) - ((p.held & Btn.Left) ? 1 : 0);
    if (!dir || !p.grounded) return false;
    const S = CrateTuning.size;
    for (const idx of this.level.ofType.crate) {
      const cr = this.lastWorld?.objs[idx];
      if (!cr) continue;
      if (cr.y >= p.y + BH || cr.y + S <= p.y) continue;
      if (dir > 0 && Math.abs(cr.x - (p.x + BW)) < 1.5) return true;
      if (dir < 0 && Math.abs(p.x - (cr.x + S)) < 1.5) return true;
    }
    return false;
  }

  private renderLink(pred: Predictor, alpha: number, t: number): void {
    const g = this.linkG;
    g.clear();
    const w = pred.world;
    const linked = w.linked;
    if (linked !== this.linkWas) {
      sfx.link(linked);
      this.linkWas = linked;
    }
    this.linkLevel += ((linked ? 1 : 0) - this.linkLevel) * 0.2;
    setLinkHum(this.linkLevel);
    pred.playerPos(0, alpha, tmpA);
    pred.playerPos(1, alpha, tmpB);
    const ax = tmpA.x + BW / 2, ay = tmpA.y + BH / 2, bx = tmpB.x + BW / 2, by = tmpB.y + BH / 2;
    const dist = Math.hypot(bx - ax, by - ay);
    const hasCrystals = this.level.ofType.crystal.length > 0;

    if (!linked) {
      if (w.linkBlocked && !w.players[0].dead && !w.players[1].dead) {
        g.lineStyle(1.5, 0xc79bff, 0.25);
        const n = Math.floor(dist / 10);
        for (let k = 0; k < n; k += 2) {
          const a = k / n, b = (k + 1) / n;
          g.lineBetween(ax + (bx - ax) * a, ay + (by - ay) * a, ax + (bx - ax) * b, ay + (by - ay) * b);
        }
      } else if (hasCrystals && dist < WorldTuning.linkRange * 1.6 && !w.players[this.local].dead) {
        // Range hint around the local player.
        const lp = this.local === 0 ? [ax, ay] : [bx, by];
        g.lineStyle(1.5, 0xc79bff, 0.12 + 0.06 * Math.sin(t * 4));
        g.strokeCircle(lp[0], lp[1], WorldTuning.linkRange);
      }
      return;
    }
    const lvl = this.linkLevel;
    const nx = -(by - ay) / (dist || 1), ny = (bx - ax) / (dist || 1);
    const segs = Math.max(8, Math.floor(dist / 12));
    for (const [width, a, amp] of [[9, 0.12, 5], [4, 0.35, 3.5], [1.6, 0.95, 2.5]] as const) {
      let px = ax, py = ay;
      for (let s = 1; s <= segs; s++) {
        const u = s / segs;
        const wob = Math.sin(u * Math.PI) * Math.sin(u * 10 - t * 9) * amp;
        const x = ax + (bx - ax) * u + nx * wob;
        const y = ay + (by - ay) * u + ny * wob;
        const col = lerpColor(COLORS.ember2, COLORS.tide2, u);
        g.lineStyle(width, width < 2 ? 0xffffff : col, a * lvl);
        g.lineBetween(px, py, x, y);
        px = x; py = y;
      }
    }
    // Pulses travelling along the tether.
    for (let k = 0; k < 3; k++) {
      const u = (t * 0.8 + k / 3) % 1;
      g.fillStyle(0xffffff, 0.9 * lvl).fillCircle(ax + (bx - ax) * u, ay + (by - ay) * u, 2.5);
    }
  }

  private renderPrompt(w: World, pred: Predictor): void {
    const idx = interactTarget(this.level, w, this.local);
    if (idx < 0) { this.promptText.setVisible(false); return; }
    const o = this.level.objects[idx];
    const label = 'ontouchstart' in window ? 'Tap E' : 'Press E';
    const verb = o.type === 'mirror' ? 'rotate' : 'use';
    this.promptText.setText(`${label} · ${verb}`).setPosition(o.x + o.w / 2, o.y - 8 + Math.sin(this.time * 4) * 2).setVisible(true);
    void pred;
  }

  private renderPartnerArrow(pred: Predictor, alpha: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    const g = this.fxG;
    g.clear();
    const r = 1 - this.local;
    if (pred.world.players[r].dead) return;
    pred.playerPos(r, alpha, tmpA);
    const px = tmpA.x + BW / 2, py = tmpA.y + BH / 2;
    const v = cam.worldView;
    const m = 26 / cam.zoom;
    if (px > v.x && px < v.right && py > v.y && py < v.bottom) return;
    const cx = Phaser.Math.Clamp(px, v.x + m, v.right - m), cy = Phaser.Math.Clamp(py, v.y + m, v.bottom - m);
    const ang = Math.atan2(py - cy, px - cx);
    const s = 1 / cam.zoom;
    const col = ELEMENT_COLOR[r];
    g.fillStyle(0x0d0b17, 0.7).fillCircle(cx, cy, 15 * s);
    g.lineStyle(2 * s, col, 1).strokeCircle(cx, cy, 15 * s);
    g.fillStyle(col, 1).fillTriangle(
      cx + Math.cos(ang) * 11 * s, cy + Math.sin(ang) * 11 * s,
      cx + Math.cos(ang + 2.4) * 8 * s, cy + Math.sin(ang + 2.4) * 8 * s,
      cx + Math.cos(ang - 2.4) * 8 * s, cy + Math.sin(ang - 2.4) * 8 * s,
    );
  }

  private renderDebug(w: World): void {
    const g = this.debugG;
    g.clear();
    g.lineStyle(1, 0x00ff88, 0.9);
    for (const p of w.players) {
      g.strokeRect(p.x, p.y, BW, BH);
      // Sprite pivot: bottom-centre of the body
      g.lineStyle(1, 0xff00ff, 1).lineBetween(p.x + BW / 2 - 4, p.y + BH, p.x + BW / 2 + 4, p.y + BH);
      g.lineBetween(p.x + BW / 2, p.y + BH - 4, p.x + BW / 2, p.y + BH + 4);
      g.lineStyle(1, 0x00ff88, 0.9);
    }
    g.lineStyle(1, 0xff00ff, 0.6);
    for (const o of this.level.objects) g.strokeRect(o.x, o.y, o.w, o.h);
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | (ab + (bb - ab) * t);
}
