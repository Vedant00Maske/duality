// Generates TEMPORARY placeholder sprite sheets for Ember and Tide in the exact
// format final art must use (Aseprite JSON array + RGBA PNG). Each frame shows:
//   - the 20x28 hitbox (x 6–25, y 12–39) filled with a per-animation colour,
//   - a white baseline on row 39 with the pivot (16, 40) marked in magenta,
//   - a facing arrow on the right (so mirroring is visible),
//   - the animation code and frame number.
// Usage: node tools/art/make-placeholders.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../../apps/web/src/art/characters');
const spec = JSON.parse(fs.readFileSync(path.join(outDir, 'spec.json'), 'utf8'));
const { w: FW, h: FH } = spec.frame;
const HB = spec.hitbox;
const PAD = spec.padding;

const FONT = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'], D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'], I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '111'],
  L: ['100', '100', '100', '100', '111'], N: ['101', '111', '111', '111', '101'], P: ['110', '101', '110', '100', '100'],
  R: ['110', '101', '110', '101', '101'], S: ['111', '100', '111', '001', '111'], U: ['101', '101', '101', '101', '111'],
};
const CODES = { idle: 'ID', run: 'RU', jump_rise: 'JR', fall: 'FA', land: 'LA', push: 'PU', interact: 'IN', death: 'DE', respawn: 'RS' };
const TAG_COLORS = {
  idle: [120, 200, 120], run: [240, 200, 80], jump_rise: [110, 170, 255], fall: [170, 120, 255], land: [255, 150, 90],
  push: [200, 140, 90], interact: [90, 220, 210], death: [230, 80, 100], respawn: [235, 235, 140],
};
const CHARS = {
  ember: { outline: [255, 138, 61], head: [255, 209, 102] },
  tide: { outline: [60, 200, 255], head: [166, 240, 255] },
};
const WHITE = [255, 255, 255], INK = [27, 21, 48], PIVOT = [255, 0, 255];

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function makeSheet(name) {
  const anims = spec.animations;
  const cols = Math.max(...anims.map((a) => a.frames));
  const W = PAD.border * 2 + cols * FW + (cols - 1) * PAD.shape;
  const H = PAD.border * 2 + anims.length * FH + (anims.length - 1) * PAD.shape;
  const px = new Uint8Array(W * H * 4); // fully transparent
  const frames = [];
  const frameTags = [];
  const ch = CHARS[name];

  anims.forEach((a, row) => {
    const from = frames.length;
    for (let f = 0; f < a.frames; f++) {
      const ox = PAD.border + f * (FW + PAD.shape);
      const oy = PAD.border + row * (FH + PAD.shape);
      const set = (x, y, c) => {
        if (x < 0 || y < 0 || x >= FW || y >= FH) return;
        const o = ((oy + y) * W + ox + x) * 4;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      };
      const clear = (x, y) => { const o = ((oy + y) * W + ox + x) * 4; px[o + 3] = 0; };
      const text = (str, x0, y0, c, scale = 1) => {
        let x = x0;
        for (const chr of str) {
          const g = FONT[chr];
          g.forEach((line, gy) => [...line].forEach((bit, gx) => {
            if (bit === '1') for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) set(x + gx * scale + sx, y0 + gy * scale + sy, c);
          }));
          x += 4 * scale;
        }
      };

      // Hitbox body
      const fill = TAG_COLORS[a.tag];
      for (let y = HB.y; y < HB.y + HB.h; y++) for (let x = HB.x; x < HB.x + HB.w; x++) set(x, y, fill);
      for (let y = HB.y; y < HB.y + HB.h; y++) { set(HB.x, y, ch.outline); set(HB.x + HB.w - 1, y, ch.outline); }
      for (let x = HB.x; x < HB.x + HB.w; x++) set(x, HB.y, ch.outline);
      // Head marker above the hitbox (character identity, bobs on idle)
      const bob = a.tag === 'idle' && f % 2 ? 1 : 0;
      if (name === 'ember') {
        for (const [cx, hgt] of [[10, 6], [15, 9], [20, 7]]) for (let k = 0; k < hgt; k++) for (let d = -1; d <= 1; d++) if (Math.abs(d) <= (hgt - k) / 3) set(cx + d, HB.y - 1 - k + bob, ch.head);
      } else {
        for (let k = 0; k < 9; k++) { const half = Math.floor(k / 2); for (let d = -half; d <= half; d++) set(15 + d, HB.y - 9 + k + bob, ch.head); }
      }
      // Labels
      text(CODES[a.tag], HB.x + 3, HB.y + 3, INK);
      text(String(f + 1), HB.x + 7, HB.y + 10, INK, 2);
      // Progress bar
      const len = Math.round(((HB.w - 4) * (f + 1)) / a.frames);
      for (let x = 0; x < len; x++) { set(HB.x + 2 + x, HB.y + HB.h - 4, WHITE); set(HB.x + 2 + x, HB.y + HB.h - 5, WHITE); }
      // Facing arrow (points right; mirrors when facing left)
      for (let k = 0; k < 4; k++) for (let d = -(3 - k); d <= 3 - k; d++) set(HB.x + HB.w + k, HB.y + 8 + d, WHITE);
      // Death dissolves, respawn materialises (hard alpha only)
      if (a.tag === 'death' || a.tag === 'respawn') {
        const t = a.tag === 'death' ? (f + 1) / a.frames : 1 - (f + 1) / a.frames;
        for (let y = 0; y < FH - 1; y++) for (let x = 0; x < FW; x++) if (hash(x, y) < t * 0.85) clear(x, y);
      }
      // Baseline (row 39) and pivot marker (columns 15–16)
      for (let x = HB.x; x < HB.x + HB.w; x++) set(x, spec.baseline, WHITE);
      set(spec.pivot.x - 1, spec.baseline, PIVOT);
      set(spec.pivot.x, spec.baseline, PIVOT);

      frames.push({
        filename: String(frames.length),
        frame: { x: ox, y: oy, w: FW, h: FH },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: FW, h: FH },
        sourceSize: { w: FW, h: FH },
        duration: Math.round(1000 / a.fps),
      });
    }
    frameTags.push({ name: a.tag, from, to: frames.length - 1, direction: 'forward', color: '#000000ff' });
  });

  const json = {
    frames,
    meta: {
      app: 'https://www.aseprite.org/',
      version: 'duality-placeholder-1',
      image: `${name}.png`,
      format: 'RGBA8888',
      size: { w: W, h: H },
      scale: '1',
      frameTags,
      layers: [{ name: 'placeholder', opacity: 255, blendMode: 'normal' }],
      slices: [{
        name: 'hitbox',
        color: '#00ff00ff',
        keys: [{ frame: 0, bounds: { x: HB.x, y: HB.y, w: HB.w, h: HB.h }, pivot: { x: spec.pivot.x - HB.x, y: spec.pivot.y - HB.y } }],
      }],
    },
  };
  fs.writeFileSync(path.join(outDir, `${name}.png`), encodePNG(W, H, px));
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(json, null, 1) + '\n');
  console.log(`${name}: ${W}x${H}, ${frames.length} frames, ${frameTags.length} tags`);
}

makeSheet('ember');
makeSheet('tide');
