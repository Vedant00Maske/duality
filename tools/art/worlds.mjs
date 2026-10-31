// Environment art generator: per-world terrain tilesets, shared animated
// liquids and three seamless parallax backgrounds per world. Everything is
// hard-edged pixel art (alpha 0 or 255) drawn from small per-world palettes.
//
// Outputs (production, imported through Vite):
//   apps/web/src/art/tilesets/w{1..4}.png     256x128, 8x4 tiles of 32x32
//   apps/web/src/art/liquids/{lava,water,toxic}.png   64x80: 4 surface frames (64x12) + basin (2x 32x32)
//   apps/web/src/art/backgrounds/w{n}_{sky,far,mid}.png   1024x576, seamless left-right
// Outputs (source/QA): art-src/worlds/  contact sheets, transition test maps, validation.json
//
// Tile indices (see apps/web/src/art/environment.ts):
//   0-15  solid, bit set = exposed side (N=1, E=2, S=4, W=8)
//   16-18 deep interior fills          19-21 one-way left/middle/right (top 10 px)
//   22    spikes (bottom 15 px)        23-26 inner-corner overlays NE, NW, SE, SW
//   27-29 surface decor (stands on a top edge, drawn in the air tile above)
//   30-31 hanging decor (under a ceiling, drawn in the air tile below)
//
// Usage: node tools/art/worlds.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster, hex, hash, bayer, ditherGradient } from './raster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'apps/web/src/art');
const SRC = path.join(root, 'art-src/worlds');
for (const d of ['tilesets', 'liquids', 'backgrounds']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
fs.mkdirSync(SRC, { recursive: true });

const T = 32;
const P = (list) => list.map(hex);

// ---------------------------------------------------------------- palettes
const WORLDS = [
  {
    id: 1, name: 'Elemental Caverns',
    stone: P(['#0e0a14', '#1b1522', '#261e30', '#332840', '#43354f', '#57465f']),
    rim: P(['#6b3a1f', '#b8642a', '#f0a65a', '#ffd08a']),
    acc: P(['#1f6f78', '#3fd0c9', '#a8fff6']),
    oneway: P(['#0e0a14', '#4a3527', '#6e4e33', '#94704a', '#ffd08a']),
    spike: P(['#0e0a14', '#5b5466', '#9a93a8', '#e6e1ee']),
  },
  {
    id: 2, name: 'Machineworks',
    stone: P(['#0a0f15', '#151d27', '#1f2a37', '#2b3947', '#3b4b5c', '#536579']),
    rim: P(['#5a4318', '#8f6a2a', '#c99a45', '#f2d07e']),
    acc: P(['#a8532e', '#e07a3f', '#ffb070']),
    oneway: P(['#0a0f15', '#3a2f1c', '#6b5428', '#a8823e', '#f2d07e']),
    spike: P(['#0a0f15', '#4d5866', '#8d99a8', '#e2e8ef']),
  },
  {
    id: 3, name: 'Light Temple',
    stone: P(['#100a1e', '#1d1433', '#2a1e47', '#392a5e', '#4a3a75', '#614f8f']),
    rim: P(['#6a4f22', '#a8823e', '#e3bd6a', '#fff0c0']),
    acc: P(['#3a7fa8', '#8fe9ff', '#e8fbff']),
    oneway: P(['#100a1e', '#3d2f5a', '#5a4880', '#7d69a8', '#fff0c0']),
    spike: P(['#100a1e', '#5a5470', '#a39cc0', '#f2eeff']),
  },
  {
    id: 4, name: 'Sky Vault',
    stone: P(['#0c1a30', '#172a4a', '#213b63', '#2e4f7e', '#3f6799', '#5682b5']),
    rim: P(['#4f86a8', '#8ec4e0', '#d4f4ff', '#ffffff']),
    acc: P(['#a8823e', '#e8c76a', '#fff3c4']),
    oneway: P(['#0c1a30', '#7aa9cc', '#b4daf0', '#e6f8ff', '#ffffff']),
    spike: P(['#0c1a30', '#56627a', '#9aa6bc', '#eef3fa']),
  },
];

// ---------------------------------------------------------------- terrain material
/** Partition of a 32x32 tile into blocks; edges of blocks become mortar lines. */
function blocks(world, variant) {
  const v = variant;
  switch (world) {
    case 1: { // basalt columns of irregular width
      const cut = [0, 11 + (v % 3) * 2, 22 - (v % 2) * 3, 32];
      const out = [];
      for (let i = 0; i < 3; i++) {
        const h = 13 + Math.floor(hash(i, v, 5) * 8);
        out.push([cut[i], 0, cut[i + 1] - cut[i], h], [cut[i], h, cut[i + 1] - cut[i], 32 - h]);
      }
      return out;
    }
    case 2: // riveted steel plates
      return v === 1 ? [[0, 0, 16, 16], [16, 0, 16, 16], [0, 16, 32, 16]] : [[0, 0, 32, 16], [0, 16, 32, 16]];
    case 3: { // running-bond temple bricks (16x8, offset rows; seamless at 32 px)
      const out = [];
      for (let r = 0; r < 4; r++) {
        const off = r % 2 ? 8 : 0;
        for (let x = -off; x < 32; x += 16) out.push([Math.max(0, x), r * 8, Math.min(32, x + 16) - Math.max(0, x), 8]);
      }
      return out;
    }
    default: { // earthen sky-island clods
      const out = [];
      const rows = [0, 10, 21, 32];
      for (let r = 0; r < 3; r++) {
        const s = 9 + Math.floor(hash(r, v, 9) * 14);
        out.push([0, rows[r], s, rows[r + 1] - rows[r]], [s, rows[r], 32 - s, rows[r + 1] - rows[r]]);
      }
      return out;
    }
  }
}

/** Fill a tile's material (no exposure edges). shade: 0 near the surface, -1 deep. */
function material(r, ox, oy, W, variant, shade) {
  const s = W.stone;
  const at = (i) => s[Math.max(0, Math.min(s.length - 1, i + shade))];
  for (const [bx, by, bw, bh] of blocks(W.id, variant)) {
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        let c;
        if (x === bx || y === by) c = at(1); // mortar (top/left of every block => 1 px grid)
        else if (y === by + 1 || x === bx + 1) c = at(4); // lit bevel
        else if (y === by + bh - 1 || x === bx + bw - 1) c = at(2); // shaded bevel
        else {
          const n = hash(x + ox * 0, y, variant * 31 + W.id);
          c = n < 0.08 ? at(2) : n > 0.93 ? at(4) : at(3);
          // soft vertical shading inside the block (dithered)
          if ((y - by) / bh > 0.62 && bayer(x, y) < 0.5) c = at(2);
        }
        r.set(ox + x, oy + y, c);
      }
    }
    if (W.id === 2) { // rivets
      for (const [rx, ry] of [[bx + 3, by + 3], [bx + bw - 4, by + 3], [bx + 3, by + bh - 4], [bx + bw - 4, by + bh - 4]]) {
        r.set(ox + rx, oy + ry, at(5)); r.set(ox + rx + 1, oy + ry + 1, at(1));
      }
    }
  }
}

/** Accent feature for the third deep-fill variant (crystal vein, pipe, rune, gold ore). */
function deepFeature(r, ox, oy, W) {
  const a = W.acc;
  switch (W.id) {
    case 1: // crystal vein
      for (const [x, y, c] of [[14, 12, 0], [15, 11, 1], [16, 10, 2], [16, 11, 1], [17, 12, 0], [15, 12, 1], [16, 12, 1], [16, 13, 0], [12, 16, 0], [13, 15, 1], [13, 16, 1], [19, 17, 0], [20, 16, 1]]) r.set(ox + x, oy + y, a[c]);
      break;
    case 2: // horizontal pipe through the wall
      for (let x = 0; x < 32; x++) { r.set(ox + x, oy + 13, W.stone[0]); r.set(ox + x, oy + 14, a[0]); r.set(ox + x, oy + 15, a[1]); r.set(ox + x, oy + 16, a[0]); r.set(ox + x, oy + 17, W.stone[0]); }
      for (const fx of [6, 24]) for (let y = 12; y <= 18; y++) { r.set(ox + fx, oy + y, W.rim[1]); r.set(ox + fx + 1, oy + y, W.rim[2]); }
      break;
    case 3: // carved rune
      for (const [x, y] of [[15, 9], [16, 9], [14, 10], [17, 10], [13, 11], [18, 11], [15, 12], [16, 12], [15, 13], [16, 13], [15, 14], [16, 14], [13, 15], [18, 15], [14, 16], [17, 16]]) r.set(ox + x, oy + y, W.acc[1]);
      break;
    default: // gold ore flecks
      for (const [x, y, c] of [[10, 10, 1], [11, 10, 2], [10, 11, 0], [20, 18, 1], [21, 18, 2], [21, 19, 0], [15, 24, 1], [16, 24, 2]]) r.set(ox + x, oy + y, a[c]);
  }
}

function solidTile(r, ox, oy, W, mask) {
  material(r, ox, oy, W, 0, 0);
  const s = W.stone, rim = W.rim;
  const N = mask & 1, E = mask & 2, S = mask & 4, Wt = mask & 8;
  if (Wt) for (let y = 0; y < 32; y++) { r.set(ox, oy + y, s[0]); r.set(ox + 1, oy + y, s[4]); }
  if (E) for (let y = 0; y < 32; y++) { r.set(ox + 31, oy + y, s[0]); r.set(ox + 30, oy + y, s[1]); }
  if (S) for (let x = 0; x < 32; x++) { r.set(ox + x, oy + 31, s[0]); r.set(ox + x, oy + 30, s[1]); }
  if (N) {
    for (let x = 0; x < 32; x++) {
      r.set(ox + x, oy, rim[3]);
      r.set(ox + x, oy + 1, rim[2]);
      r.set(ox + x, oy + 2, bayer(x, 2) < 0.5 ? rim[1] : rim[2]);
      r.set(ox + x, oy + 3, rim[0]);
      // irregular drips of the surface layer (moss / brass trim / gold / grass)
      const drip = Math.floor(hash(x, W.id, 77) * 4);
      for (let k = 0; k < drip; k++) r.set(ox + x, oy + 4 + k, k === drip - 1 ? s[1] : rim[0]);
    }
    if (Wt) { r.set(ox, oy + 1, rim[1]); r.set(ox, oy + 2, rim[0]); r.set(ox, oy + 3, s[0]); }
    if (E) { r.set(ox + 31, oy + 1, rim[1]); r.set(ox + 31, oy + 2, rim[0]); r.set(ox + 31, oy + 3, s[0]); }
  }
  // Rounded outer corners (2 px radius) where two exposed sides meet.
  const cut = (cx, cy, dx, dy, edge) => {
    r.clear(ox + cx, oy + cy); r.clear(ox + cx + dx, oy + cy); r.clear(ox + cx, oy + cy + dy);
    r.set(ox + cx + dx * 2, oy + cy, edge); r.set(ox + cx + dx, oy + cy + dy, edge); r.set(ox + cx, oy + cy + dy * 2, edge);
  };
  if (N && Wt) cut(0, 0, 1, 1, rim[2]);
  if (N && E) cut(31, 0, -1, 1, rim[2]);
  if (S && Wt) cut(0, 31, 1, -1, s[0]);
  if (S && E) cut(31, 31, -1, -1, s[0]);
}

function oneWayTile(r, ox, oy, W, part) { // part: 0 left, 1 middle, 2 right; rows 0..9 only
  const c = W.oneway;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 32; x++) {
      let col;
      if (y === 0) col = c[4];
      else if (y === 9) col = c[0];
      else if (y === 8) col = c[1];
      else if (y === 1) col = c[3];
      else col = (x % 16 === 0) ? c[1] : bayer(x, y) < 0.18 ? c[3] : c[2];
      if (W.id === 2 && y >= 3 && y <= 6 && (x + y) % 6 === 0) col = c[1]; // girder lattice
      if (W.id === 4 && y >= 6 && hash(x, y, 4) < 0.3) col = c[3]; // cloud fluff
      r.set(ox + x, oy + y, col);
    }
  }
  const end = (x0, dx) => { // rounded cap with outline
    r.clear(ox + x0, oy); r.clear(ox + x0, oy + 9);
    for (let y = 1; y < 9; y++) r.set(ox + x0, oy + y, c[0]);
    r.set(ox + x0 + dx, oy, c[0]); r.set(ox + x0 + dx, oy + 9, c[0]);
    r.set(ox + x0 + dx, oy + 1, c[4]);
  };
  if (part === 0) end(0, 1);
  if (part === 2) end(31, -1);
}

function spikeTile(r, ox, oy, W) { // tips at row 17, base at row 31: inside the bottom 15 px
  const c = W.spike;
  for (let k = 0; k < 4; k++) {
    const sx = k * 8;
    for (let y = 17; y < 29; y++) {
      const half = Math.floor(((y - 17) / 12) * 4) + 0.5;
      for (let x = 0; x < 8; x++) {
        const d = x + 0.5 - 4;
        if (Math.abs(d) > half) continue;
        const col = Math.abs(d) >= half - 0.6 ? c[0] : d < 0 ? c[3] : c[2];
        r.set(ox + sx + x, oy + y, col);
      }
    }
    r.set(ox + sx + 3, oy + 17, c[3]); r.set(ox + sx + 4, oy + 17, c[3]);
  }
  for (let x = 0; x < 32; x++) {
    r.set(ox + x, oy + 29, c[1]);
    r.set(ox + x, oy + 30, hex('#c2324a')); // danger strip
    r.set(ox + x, oy + 31, c[0]);
  }
}

function innerCorner(r, ox, oy, W, which) { // 0 NE, 1 NW, 2 SE, 3 SW
  const xr = which === 0 || which === 2, yb = which >= 2;
  const X = (x) => (xr ? 31 - x : x), Y = (y) => (yb ? 31 - y : y);
  const col = yb ? W.stone[0] : W.rim[2];
  r.set(ox + X(0), oy + Y(0), W.stone[0]);
  r.set(ox + X(1), oy + Y(0), col);
  r.set(ox + X(0), oy + Y(1), col);
}

function decor(r, ox, oy, W, k) { // standing decor, bottom-anchored, max 9 px tall
  const a = W.acc, rim = W.rim, s = W.stone;
  const B = oy + 31;
  const x0 = ox + 6 + k * 7;
  switch (W.id) {
    case 1:
      if (k === 0) { for (const [dx, h] of [[0, 4], [2, 7], [4, 5], [6, 3]]) for (let y = 0; y < h; y++) r.set(x0 + dx, B - y, y === h - 1 ? rim[3] : rim[1 + (y % 2)]); }
      else if (k === 1) { for (const [dx, h, c] of [[0, 5, 1], [1, 8, 2], [2, 6, 1], [3, 4, 0]]) for (let y = 0; y < h; y++) r.set(x0 + dx, B - y, y === h - 1 ? a[2] : a[c]); }
      else { for (let x = 0; x < 9; x++) for (let y = 0; y < 3 - Math.abs(x - 4) / 2; y++) r.set(x0 + x, B - y, y ? s[4] : s[3]); }
      break;
    case 2:
      if (k === 0) { for (let y = 0; y < 6; y++) { r.set(x0, B - y, s[4]); r.set(x0 + 1, B - y, s[2]); } r.set(x0 - 1, B - 6, a[2]); r.set(x0, B - 6, a[2]); r.set(x0 + 1, B - 6, a[1]); r.set(x0 + 2, B - 6, a[1]); r.set(x0, B - 7, rim[3]); }
      else if (k === 1) { for (let x = 0; x < 8; x++) for (let y = 0; y < 4; y++) r.set(x0 + x, B - y, y === 3 ? rim[2] : ((x + y) % 4 < 2 ? rim[1] : s[1])); }
      else { for (let x = 0; x < 6; x++) for (let y = 0; y < 5; y++) r.set(x0 + x, B - y, x === 0 || y === 4 ? s[4] : s[2]); r.set(x0 + 2, B - 2, a[2]); }
      break;
    case 3:
      if (k === 0) { for (let y = 0; y < 5; y++) { r.set(x0, B - y, rim[3]); r.set(x0 + 1, B - y, rim[2]); } r.set(x0, B - 6, a[2]); r.set(x0 + 1, B - 7, a[1]); r.set(x0 - 1, B, s[4]); r.set(x0 + 2, B, s[4]); }
      else if (k === 1) { for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) { if (Math.abs(x - 3) + Math.max(0, y - 4) > 3) continue; r.set(x0 + x, B - y, y === 6 ? rim[3] : x < 3 ? rim[2] : rim[1]); } }
      else { for (let x = 0; x < 5; x++) for (let y = 0; y < 8; y++) r.set(x0 + x, B - y, y === 7 ? s[5] : x === 0 ? s[4] : s[3]); r.set(x0 + 2, B - 4, a[1]); }
      break;
    default:
      if (k === 0) { for (const [dx, h] of [[0, 3], [1, 5], [3, 4], [4, 6], [6, 3]]) for (let y = 0; y < h; y++) r.set(x0 + dx, B - y, y === h - 1 ? rim[3] : rim[1]); }
      else if (k === 1) { for (const dx of [0, 4]) { for (let y = 0; y < 5; y++) r.set(x0 + dx, B - y, rim[0]); r.set(x0 + dx, B - 5, a[1]); r.set(x0 + dx - 1, B - 5, a[2]); r.set(x0 + dx + 1, B - 5, a[2]); r.set(x0 + dx, B - 6, a[2]); } }
      else { for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) r.set(x0 + x, B - y, y === 2 ? s[5] : s[4]); }
  }
}

function hanging(r, ox, oy, W, k) { // top-anchored, max 9 px; deliberately blunt (never reads as a hazard)
  const rim = W.rim, s = W.stone, a = W.acc;
  const x0 = ox + 8 + k * 10;
  switch (W.id) {
    case 1: for (const [dx, h] of [[0, 5], [1, 8], [3, 6], [4, 3]]) for (let y = 0; y < h; y++) r.set(x0 + dx, oy + y, y === h - 1 ? a[1] : rim[0]); break;
    case 2: for (let y = 0; y < 8; y++) r.set(x0 + (y % 2), oy + y, y % 2 ? s[4] : s[5]); r.set(x0, oy + 8, a[2]); r.set(x0 + 1, oy + 8, a[1]); break;
    case 3: for (let x = 0; x < 6; x++) for (let y = 0; y < 8 - (x === 0 || x === 5 ? 2 : 0); y++) r.set(x0 + x, oy + y, y === 0 ? rim[2] : x % 5 === 0 ? a[0] : W.stone[3 + (y % 2)]); r.set(x0 + 2, oy + 4, rim[3]); r.set(x0 + 3, oy + 4, rim[3]); break;
    default: for (const [dx, h] of [[0, 6], [2, 9], [3, 4], [5, 7]]) for (let y = 0; y < h; y++) r.set(x0 + dx + (y > 4 ? 1 : 0), oy + y, y === h - 1 ? rim[1] : hex('#3d6b52')); break;
  }
}

function tileset(W) {
  const r = new Raster(256, 128);
  const at = (i) => [(i % 8) * T, Math.floor(i / 8) * T];
  for (let m = 0; m < 16; m++) solidTile(r, ...at(m), W, m);
  for (let v = 0; v < 3; v++) {
    const [x, y] = at(16 + v);
    material(r, x, y, W, v, -1);
    if (v === 2) deepFeature(r, x, y, W);
  }
  for (let p = 0; p < 3; p++) oneWayTile(r, ...at(19 + p), W, p);
  spikeTile(r, ...at(22), W);
  for (let k = 0; k < 4; k++) innerCorner(r, ...at(23 + k), W, k);
  for (let k = 0; k < 3; k++) decor(r, ...at(27 + k), W, k);
  for (let k = 0; k < 2; k++) hanging(r, ...at(30 + k), W, k);
  return r;
}

// ---------------------------------------------------------------- liquids
const LIQUIDS = {
  lava: P(['#4a0e05', '#8a220b', '#c93a0e', '#ff6a1a', '#ffad3d', '#fff0a0']),
  water: P(['#082a60', '#0d4790', '#1a72c8', '#3cb0f0', '#8fe6ff', '#e6fdff']),
  toxic: P(['#0f3612', '#1b6226', '#33942e', '#62c93a', '#a8ec62', '#eaffb0']),
};

function liquid(name) {
  const c = LIQUIDS[name];
  const r = new Raster(64, 80);
  // Surface strip: tile top = strip row 5; waves stay within rows 4..6.
  for (let f = 0; f < 4; f++) {
    const oy = f * 12;
    for (let x = 0; x < 64; x++) {
      const w = Math.sin(((x + f * 4) / 32) * Math.PI * 2) + 0.5 * Math.sin(((x - f * 8) / 16) * Math.PI * 2);
      const top = 5 + (w > 0.7 ? -1 : w < -0.7 ? 1 : 0);
      for (let y = top; y < 12; y++) {
        let col = y === top ? c[5] : y === top + 1 ? c[4] : y <= top + 3 && bayer(x, y) < 0.5 ? c[4] : c[3];
        if (y > 8 && bayer(x + f, y) < 0.25) col = c[2];
        r.set(x, oy + y, col);
      }
    }
    // Sparkles on the crest / lava pops above the surface (spaced so the strip still tiles).
    for (let k = 0; k < 3; k++) {
      const x = (k * 21 + f * 6 + 5) % 64;
      if (name === 'lava') { r.set(x, oy + 2 + ((f + k) % 2), c[4]); r.set(x, oy + 1 + ((f + k) % 2), c[5]); }
      else r.set(x, oy + 7 + (k % 2), c[5]);
    }
  }
  // Basin (two 32x32 variants side by side): depth ramp + bubbles. Row 0 matches the strip body.
  for (let v = 0; v < 2; v++) {
    const ox = v * 32, oy = 48;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const t = y / 31;
        const i = t < 0.25 ? 3 : t < 0.6 ? (bayer(x, y) < (t - 0.25) / 0.35 ? 2 : 3) : (bayer(x, y) < (t - 0.6) / 0.4 ? 1 : 2);
        r.set(ox + x, oy + y, c[i]);
      }
    }
    for (let k = 0; k < 4; k++) {
      const bx = Math.floor(hash(k, v, 3) * 26) + 3, by = Math.floor(hash(k, v, 4) * 20) + 8;
      r.set(ox + bx, oy + by, c[4]); r.set(ox + bx + 1, oy + by, c[4]); r.set(ox + bx, oy + by - 1, c[5]);
    }
    if (name === 'lava') for (let k = 0; k < 6; k++) { // dark crust flecks
      const bx = Math.floor(hash(k, v, 8) * 30), by = Math.floor(hash(k, v, 9) * 22) + 6;
      r.set(ox + bx, oy + by, c[1]); r.set(ox + bx + 1, oy + by, c[1]);
    }
  }
  return r;
}

// ---------------------------------------------------------------- backgrounds
const BW = 1024, BH = 576;
const wrapPoly = (r, pts, c) => r.poly(pts, c, true);

function jaggedSpike(r, x, base, h, w, c, down, s) {
  const pts = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const jit = (hash(i, s, 3) - 0.5) * w * 0.12;
    const hx = x - w / 2 + w * t / 2 + jit, hy = base + (down ? 1 : -1) * h * t;
    pts.push([hx, hy]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const t = i / n;
    const jit = (hash(i, s, 5) - 0.5) * w * 0.12;
    pts.push([x + w / 2 - w * t / 2 + jit, base + (down ? 1 : -1) * h * t]);
  }
  wrapPoly(r, pts, c);
}

function stars(r, n, s, cols, yMax) {
  for (let i = 0; i < n; i++) {
    const x = Math.floor(hash(i, s, 1) * BW), y = Math.floor(hash(i, s, 2) * yMax);
    const c = cols[Math.floor(hash(i, s, 3) * cols.length)];
    r.set(x, y, c, true);
    if (hash(i, s, 4) > 0.9) { r.set(x + 1, y, c, true); r.set(x - 1, y, c, true); r.set(x, y + 1, c); r.set(x, y - 1, c); }
  }
}

/** Ordered-dither disc that fades between two colours (hard alpha). */
function glowDisc(r, cx, cy, rad, inner, outer) {
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const d = Math.hypot(x - cx, y - cy) / rad;
      if (d > 1) continue;
      if (d < 0.35 || bayer(x, y) > (d - 0.35) / 0.65) r.set(x, y, d < 0.55 ? inner : outer, true);
    }
  }
}

function gearShape(r, cx, cy, rad, teeth, c, hole) {
  const pts = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2;
    const rr = (i % 4 < 2) ? rad * 1.13 : rad;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  wrapPoly(r, pts, c);
  if (hole) for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y < (rad * 0.32) ** 2) r.set(cx + x, cy + y, hole, true);
}

function background(Wid, layer) {
  const r = new Raster(BW, BH);
  const s = Wid * 10 + (layer === 'far' ? 1 : layer === 'mid' ? 2 : 0);
  if (Wid === 1) {
    if (layer === 'sky') {
      ditherGradient(r, P(['#07050c', '#0c0914', '#120d1d', '#1b1124', '#271426']), 0, BH, true);
      glowDisc(r, 300, 470, 160, hex('#2e1626'), hex('#22101f'));
      glowDisc(r, 820, 120, 120, hex('#141a2a'), hex('#110f1f'));
      stars(r, 160, s, P(['#ffa25a', '#3fd0c9', '#6b3a2a']), BH);
    } else if (layer === 'far') {
      const c = hex('#140e1c'), rim = hex('#1d1528');
      for (let i = 0; i < 22; i++) jaggedSpike(r, hash(i, s) * BW, 0, 70 + hash(i, s, 2) * 170, 40 + hash(i, s, 1) * 70, i % 3 ? c : rim, true, i);
      for (let i = 0; i < 18; i++) jaggedSpike(r, hash(i, s, 4) * BW, BH, 60 + hash(i, s, 5) * 180, 50 + hash(i, s, 6) * 90, i % 3 ? c : rim, false, i + 50);
      r.rect(0, BH - 40, BW, 40, c, true);
    } else {
      const c = hex('#1a1224'), hi = hex('#2a1f37'), cr = P(['#1f6f78', '#3fd0c9', '#a8fff6']), lava = P(['#5a1e10', '#a8401a']);
      for (let i = 0; i < 6; i++) { // rock pillars
        const x = Math.floor(hash(i, s) * BW), w = 50 + Math.floor(hash(i, s, 1) * 60);
        wrapPoly(r, [[x - w / 2, 0], [x + w / 2, 0], [x + w / 3, BH * 0.45], [x + w / 2, BH], [x - w / 2, BH], [x - w / 3, BH * 0.5]], c);
        for (let y = 0; y < BH; y += 2) r.set(x - w / 2 + 2 + Math.round(Math.sin(y / 40) * 4), y, hi, true);
      }
      for (let i = 0; i < 14; i++) jaggedSpike(r, hash(i, s, 7) * BW, BH, 40 + hash(i, s, 8) * 120, 60 + hash(i, s, 9) * 80, c, false, i + 9);
      for (let i = 0; i < 9; i++) { // crystal clusters
        const x = Math.floor(hash(i, s, 10) * BW), y = BH - 20 - Math.floor(hash(i, s, 11) * 80);
        for (let k = 0; k < 3; k++) {
          const h = 10 + Math.floor(hash(i, k, 12) * 16), cx = x + k * 6 - 6;
          wrapPoly(r, [[cx - 3, y], [cx, y - h], [cx + 3, y]], cr[k === 1 ? 1 : 0]);
          r.line(cx, y - h + 2, cx, y - 2, cr[2], true);
        }
      }
      r.rect(0, BH - 22, BW, 22, c, true);
      for (let x = 0; x < BW; x++) if (Math.sin((x / BW) * Math.PI * 6) > 0.55) { r.set(x, BH - 22, lava[1], true); if (bayer(x, 0) < 0.5) r.set(x, BH - 21, lava[0], true); }
    }
  } else if (Wid === 2) {
    if (layer === 'sky') {
      ditherGradient(r, P(['#05080d', '#091019', '#0f1925', '#172433', '#2a2a2c', '#3a2c20']), 0, BH, true);
      stars(r, 60, s, P(['#ffc56b', '#6b7a8a']), BH * 0.6);
    } else if (layer === 'far') {
      const c = hex('#101822'), lit = P(['#c99a45', '#7a5a2a']);
      const X0 = 37; // skyline starts mid-building so the wrap column falls inside one
      let x = X0;
      for (let i = 0; x < BW + X0; i++) { // factory skyline (widths sum exactly to BW for a clean wrap)
        const w = Math.min(BW + X0 - x, 40 + Math.floor(hash(i, s) * 90));
        const h = 140 + Math.floor(hash(i, s, 1) * 220);
        r.rect(x, BH - h, w, h, c, true);
        if (hash(i, s, 2) > 0.5) r.rect(x + Math.floor(w / 3), BH - h - 60, 10, 60, c, true);
        for (let wy = BH - h + 12; wy < BH - 20; wy += 14) for (let wx = x + 6; wx < x + w - 6; wx += 10) if (hash(wx, wy, s) > 0.82) r.rect(wx, wy, 3, 4, lit[hash(wx, wy, 1) > 0.5 ? 0 : 1], true);
        x += w;
      }
      for (let i = 0; i < 4; i++) gearShape(r, hash(i, s, 5) * BW, 120 + hash(i, s, 6) * 160, 40 + hash(i, s, 7) * 40, 10, c, null);
    } else {
      const c = hex('#151e29'), hi = hex('#3a3022'), brass = hex('#5c4826');
      for (let i = 0; i < 5; i++) gearShape(r, hash(i, s) * BW, 80 + hash(i, s, 1) * 420, 50 + hash(i, s, 2) * 70, 12, c, hex('#0b1018'));
      for (const y of [150, 330, 470]) { // pipes with flanges
        const yy = y + Math.floor(hash(y, s) * 30);
        r.rect(0, yy, BW, 14, c, true);
        r.rect(0, yy + 2, BW, 2, hi, true);
        for (let fx = Math.floor(hash(yy, s, 2) * 128); fx < BW; fx += 128) r.rect(fx, yy - 3, 6, 20, brass, true);
      }
      for (let i = 0; i < 6; i++) { // pistons
        const x = Math.floor(hash(i, s, 8) * BW);
        r.rect(x, BH - 200, 22, 200, c, true);
        r.rect(x + 7, BH - 260, 8, 60, hi, true);
        r.rect(x - 4, BH - 205, 30, 6, brass, true);
      }
      r.rect(0, BH - 26, BW, 26, c, true);
    }
  } else if (Wid === 3) {
    if (layer === 'sky') {
      ditherGradient(r, P(['#0a0616', '#130b26', '#1e1236', '#2e1a48', '#3f2456', '#4a2b5c']), 0, BH, true);
      glowDisc(r, 512, 150, 130, hex('#3a2a5e'), hex('#2a1a46'));
      glowDisc(r, 512, 150, 46, hex('#fff0c0'), hex('#e3bd6a'));
      stars(r, 220, s, P(['#fff1c4', '#8fe9ff', '#c79bff']), BH * 0.75);
    } else if (layer === 'far') {
      const c = hex('#1b1130');
      for (let i = 0; i < 4; i++) { // stepped ziggurats
        const cx = Math.floor(hash(i, s) * BW), w = 300 + Math.floor(hash(i, s, 1) * 200);
        for (let k = 0; k < 6; k++) r.rect(cx - w / 2 + k * 24, BH - 60 - k * 34, w - k * 48, 34, c, true);
        r.rect(cx - 20, BH - 300, 40, 50, c, true);
      }
      r.rect(0, BH - 60, BW, 60, c, true);
    } else {
      const c = hex('#221639'), hi = hex('#5c4826'), rune = hex('#6fdfff');
      for (let i = 0; i < 8; i++) { // pillars with capitals
        const x = Math.floor((i / 8) * BW + hash(i, s) * 40);
        r.rect(x, 90, 34, BH - 90, c, true);
        r.rect(x - 8, 80, 50, 14, c, true);
        r.rect(x - 8, BH - 40, 50, 14, c, true);
        r.rect(x - 8, 80, 50, 2, hi, true);
        for (let y = 110; y < BH - 50; y += 6) r.set(x + 4, y, hex('#2e2050'), true);
        if (i % 2 === 0) for (let k = 0; k < 5; k++) r.set(x + 17, 200 + k * 40, rune, true);
      }
      for (let i = 0; i < 4; i++) { // hanging crystal lanterns
        const x = Math.floor(hash(i, s, 3) * BW), len = 60 + Math.floor(hash(i, s, 4) * 100);
        for (let y = 0; y < len; y += 2) r.set(x, y, hi, true);
        wrapPoly(r, [[x - 5, len], [x, len - 8], [x + 5, len], [x, len + 12]], hex('#c79bff'));
        r.set(x, len + 1, hex('#ffffff'), true);
      }
      r.rect(0, BH - 26, BW, 26, c, true);
      for (let x = 0; x < BW; x += 2) r.set(x, BH - 26, hi, true);
    }
  } else {
    if (layer === 'sky') {
      ditherGradient(r, P(['#081430', '#0f2550', '#1a3f76', '#2a5d96', '#3b74a8', '#4f86b4']), 0, BH, true);
      stars(r, 90, s, P(['#ffffff', '#cfe9ff']), BH * 0.3);
      glowDisc(r, 760, 110, 60, hex('#fff3c4'), hex('#e8c76a'));
    } else if (layer === 'far') {
      const cloud = hex('#46799f'), cloud2 = hex('#3b6a94'), isle = hex('#1e3f6a');
      for (let i = 0; i < 26; i++) { // cloud bank
        const cx = hash(i, s) * BW, cy = BH - 70 - hash(i, s, 1) * 60, rad = 30 + hash(i, s, 2) * 40;
        r.circle(cx, cy, rad, i % 2 ? cloud : cloud2, true);
      }
      r.rect(0, BH - 80, BW, 80, cloud2, true);
      for (let i = 0; i < 5; i++) { // distant islands
        const cx = hash(i, s, 5) * BW, cy = 160 + hash(i, s, 6) * 160, w = 60 + hash(i, s, 7) * 80;
        wrapPoly(r, [[cx - w / 2, cy], [cx + w / 2, cy], [cx + w * 0.15, cy + w * 0.55], [cx - w * 0.2, cy + w * 0.4]], isle);
        r.rect(cx - w / 2, cy - 3, w, 3, hex('#3f6f9e'), true);
      }
    } else {
      const isle = hex('#1a3660'), top = hex('#5d9cc4'), root = hex('#24476f'), cloud = hex('#6a9cc4');
      for (let i = 0; i < 4; i++) { // floating islands with roots
        const cx = (i / 4) * BW + hash(i, s) * 120, cy = 200 + hash(i, s, 1) * 220, w = 130 + hash(i, s, 2) * 120;
        wrapPoly(r, [[cx - w / 2, cy], [cx + w / 2, cy], [cx + w * 0.3, cy + w * 0.3], [cx + w * 0.05, cy + w * 0.6], [cx - w * 0.25, cy + w * 0.35]], isle);
        r.rect(cx - w / 2, cy - 4, w, 4, top, true);
        for (let k = 0; k < 5; k++) { const rx = cx - w / 3 + k * w / 7; for (let y = 0; y < 20 + hash(i, k, 3) * 30; y++) r.set(rx + Math.round(Math.sin(y / 6 + k) * 2), cy + w * 0.25 + y, root, true); }
        if (i % 2 === 0) { // wind turbine
          const tx = cx + w / 6, ty = cy - 4;
          r.rect(tx - 2, ty - 70, 4, 70, isle, true);
          for (let a = 0; a < 3; a++) { const ang = a * 2.094 + i; r.line(tx, ty - 70, tx + Math.cos(ang) * 30, ty - 70 + Math.sin(ang) * 30, top, true); }
          r.circle(tx, ty - 70, 3, hex('#e8c76a'), true);
        }
      }
      for (let i = 0; i < 10; i++) { // cloud wisps
        const cx = hash(i, s, 8) * BW, cy = 60 + hash(i, s, 9) * 420, w = 60 + hash(i, s, 10) * 120;
        r.rect(cx, cy, w, 4, cloud, true);
        r.rect(cx + w * 0.2, cy - 3, w * 0.5, 3, cloud, true);
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------- QA helpers
function enlarge(src, k, grid = 0) {
  const out = new Raster(src.w * k, src.h * k);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const sx = Math.floor(x / k), sy = Math.floor(y / k);
    const c = src.get(sx, sy);
    const chk = ((sx >> 2) + (sy >> 2)) & 1 ? [44, 40, 56] : [58, 54, 72];
    let col = c ?? chk;
    if (grid && (sx % grid === 0 && x % k === 0 || sy % grid === 0 && y % k === 0)) col = [255, 0, 255];
    out.set(x, y, col);
  }
  return out;
}

/** Test map exercising every exposure mask, inner corners, one-way runs, spikes and pools. */
const TEST_MAP = [
  '................',
  '..###....---....',
  '..###...........',
  '..###..#....#...',
  '.......#....#.^^',
  '.#####.###..####',
  '.#...#.......##.',
  '.#####..LLWWTT#.',
  '#######.########',
  '################',
];
function testComposite(W, tiles, liquids) {
  const r = new Raster(TEST_MAP[0].length * T, TEST_MAP.length * T);
  ditherGradient(r, P(['#101018', '#1c1c2c']));
  const at = (c, rr) => (TEST_MAP[rr]?.[c] ?? '#');
  const solid = (c, rr) => '#LWT'.includes(at(c, rr));
  for (let rr = 0; rr < TEST_MAP.length; rr++) for (let c = 0; c < TEST_MAP[0].length; c++) {
    const ch = at(c, rr), x = c * T, y = rr * T;
    const blit = (i) => r.blit(tiles, x, y, (i % 8) * T, Math.floor(i / 8) * T, T, T);
    if (ch === '#') {
      const m = (solid(c, rr - 1) ? 0 : 1) | (solid(c + 1, rr) ? 0 : 2) | (solid(c, rr + 1) ? 0 : 4) | (solid(c - 1, rr) ? 0 : 8);
      blit(m);
      if (!m && !solid(c + 1, rr - 1)) blit(23);
      if (!m && !solid(c - 1, rr - 1)) blit(24);
    } else if (ch === '-') blit(19 + (at(c - 1, rr) === '-' ? (at(c + 1, rr) === '-' ? 1 : 2) : 0));
    else if (ch === '^') blit(22);
    else if ('LWT'.includes(ch)) {
      const L = liquids[ch === 'L' ? 'lava' : ch === 'W' ? 'water' : 'toxic'];
      r.blit(L, x, y, 0, 48, T, T);
      r.blit(L, x, y - 5, (c % 2) * 32, 0, T, 12);
    }
  }
  return r;
}

// ---------------------------------------------------------------- run
const report = { generated: new Date().toISOString(), tilesets: {}, liquids: {}, backgrounds: {}, errors: [] };
const fail = (m) => report.errors.push(m);
const hardAlpha = (r) => { for (let i = 3; i < r.data.length; i += 4) if (r.data[i] !== 0 && r.data[i] !== 255) return false; return true; };
const colDiff = (r, a, b) => { // mean colour difference between two columns
  let d = 0;
  for (let y = 0; y < r.h; y++) { const p = r.get(a, y), q = r.get(b, y); d += p && q ? Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) : (p || q) ? 255 : 0; }
  return d / r.h;
};

const liquids = {};
for (const name of Object.keys(LIQUIDS)) {
  const r = liquid(name);
  liquids[name] = r;
  fs.writeFileSync(path.join(OUT, 'liquids', `${name}.png`), r.png());
  // Seamless: every frame's last column must flow into its first like any interior pair.
  const seam = colDiff(r, 63, 0), interior = Math.max(...[10, 20, 30, 40, 50].map((x) => colDiff(r, x, x + 1)));
  // Hazard line: in every frame the mean surface row is the tile top (strip row 5).
  const rows = [];
  for (let f = 0; f < 4; f++) for (let x = 0; x < 64; x++) { let y = 0; while (y < 12 && !r.get(x, f * 12 + y)) y++; if (y >= 3) rows.push(y); }
  const meanTop = rows.reduce((a, b) => a + b, 0) / rows.length;
  report.liquids[name] = { size: [r.w, r.h], frames: 4, hardAlpha: hardAlpha(r), seam: +seam.toFixed(1), interiorMax: +interior.toFixed(1), meanSurfaceRow: +meanTop.toFixed(2) };
  if (seam > interior * 1.5 + 5) fail(`${name}: surface strip seam ${seam.toFixed(1)} > interior ${interior.toFixed(1)}`);
  if (Math.abs(meanTop - 5) > 0.5) fail(`${name}: surface line at row ${meanTop.toFixed(2)}, expected 5 (tile top)`);
  fs.writeFileSync(path.join(SRC, `liquid_${name}_x6.png`), enlarge(r, 6).png());
}

for (const W of WORLDS) {
  const tiles = tileset(W);
  fs.writeFileSync(path.join(OUT, 'tilesets', `w${W.id}.png`), tiles.png());
  fs.writeFileSync(path.join(SRC, `w${W.id}_tileset_x4.png`), enlarge(tiles, 4, 32).png());
  fs.writeFileSync(path.join(SRC, `w${W.id}_transitions_x2.png`), enlarge(testComposite(W, tiles, liquids), 2).png());
  const tile = (i) => [(i % 8) * T, Math.floor(i / 8) * T];
  const checks = { size: [tiles.w, tiles.h], hardAlpha: hardAlpha(tiles) };
  // Interior (mask 0) and deep fills are fully opaque; spikes stay in the bottom 15 px; one-way only in the top 10 px.
  for (const i of [0, 16, 17, 18]) { const [x, y] = tile(i); for (let yy = 0; yy < T; yy++) for (let xx = 0; xx < T; xx++) if (!tiles.get(x + xx, y + yy)) { fail(`w${W.id} tile ${i} has a hole at ${xx},${yy}`); yy = T; break; } }
  { const [x, y] = tile(22); let top = T; for (let yy = 0; yy < T; yy++) for (let xx = 0; xx < T; xx++) if (tiles.get(x + xx, y + yy)) top = Math.min(top, yy); checks.spikeTopRow = top; if (top < 17) fail(`w${W.id} spikes start at row ${top} (must be >= 17)`); }
  for (const i of [19, 20, 21]) { const [x, y] = tile(i); for (let yy = 10; yy < T; yy++) for (let xx = 0; xx < T; xx++) if (tiles.get(x + xx, y + yy)) { fail(`w${W.id} one-way ${i} draws below row 9`); yy = T; break; } }
  { const [x, y] = tile(20); for (let xx = 0; xx < T; xx++) if (!tiles.get(x + xx, y)) fail(`w${W.id} one-way middle top row has a gap at ${xx}`); }
  // Seams: the material repeats every 32 px, so left/right edges of the plain tile must abut like interior columns.
  { const [x, y] = tile(0); const sub = new Raster(T, T); sub.blit(tiles, 0, 0, x, y, T, T); checks.tileSeam = +colDiff(sub, 31, 0).toFixed(1); }
  report.tilesets[`w${W.id}`] = checks;
  for (const layer of ['sky', 'far', 'mid']) {
    const r = background(W.id, layer);
    fs.writeFileSync(path.join(OUT, 'backgrounds', `w${W.id}_${layer}.png`), r.png());
    const seam = colDiff(r, BW - 1, 0);
    const interior = [100, 300, 500, 700, 900].map((x) => colDiff(r, x, x + 1));
    const imax = Math.max(...interior);
    report.backgrounds[`w${W.id}_${layer}`] = { size: [r.w, r.h], hardAlpha: hardAlpha(r), opaque: layer === 'sky' ? r.data.every((v, i) => i % 4 !== 3 || v === 255) : undefined, seam: +seam.toFixed(1), interiorMax: +imax.toFixed(1) };
    if (seam > imax * 1.5 + 8) fail(`w${W.id}_${layer}: wrap seam ${seam.toFixed(1)} vs interior ${imax.toFixed(1)}`);
    if (layer === 'sky' && !report.backgrounds[`w${W.id}_${layer}`].opaque) fail(`w${W.id}_sky must be opaque`);
  }
}
for (const [k, v] of Object.entries(report.tilesets)) if (!v.hardAlpha) fail(`${k} soft alpha`);
fs.writeFileSync(path.join(SRC, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 1));
if (report.errors.length) process.exit(1);
