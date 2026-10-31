// Interactive-object pixel art, packed into one atlas (Phaser JSON-hash format).
// Parts that show a wiring colour are drawn in greyscale (frames ending in
// "_g") so the renderer can tint them with any of the six colour codes; every
// other part is final colour. Frame sizes match the simulation's object bounds.
//
// Outputs: apps/web/src/art/objects/objects.{png,json}
//          art-src/objects/objects_x4.png (enlarged contact sheet), validation.json
// Usage:   node tools/art/objects.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster, hex, hash, bayer } from './raster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'apps/web/src/art/objects');
const SRC = path.join(root, 'art-src/objects');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SRC, { recursive: true });

const C = Object.fromEntries(Object.entries({
  ink: '#0d0b17', d1: '#1b1726', d2: '#2a2538', d3: '#3d3650', d4: '#5a5270', d5: '#8a82a0', d6: '#c4bdd6',
  st0: '#2b3442', st1: '#45505f', st2: '#68768a', st3: '#98a6b8', st4: '#d6dfea',
  w0: '#3b2112', w1: '#5c3a1f', w2: '#7a4f2c', w3: '#9a6a3c', w4: '#c99a62', w5: '#e6c48e',
  g0: '#5a5a5a', g1: '#8a8a8a', g2: '#b4b4b4', g3: '#d8d8d8', g4: '#ffffff',
  e0: '#8e2213', e1: '#ee5019', e2: '#fca82a', e3: '#fde27f',
  t0: '#0b3866', t1: '#1565b3', t2: '#3cc8ff', t3: '#a6f0ff',
  p0: '#3a1f7a', p1: '#6a3fd1', p2: '#c79bff', p3: '#f2e6ff',
  gold: '#ffd166', gold2: '#fff3c4', red: '#ff6b81',
}).map(([k, v]) => [k, hex(v)]));

const frames = []; // { name, r }
const add = (name, w, h, draw) => { const r = new Raster(w, h); draw(r); frames.push({ name, r }); };
const outlineRect = (r, x, y, w, h, fill, line) => { r.rect(x, y, w, h, line); r.rect(x + 1, y + 1, w - 2, h - 2, fill); };

// ---------------------------------------------------------------- crate (30x30)
add('crate', 30, 30, (r) => {
  outlineRect(r, 0, 0, 30, 30, C.w2, C.w0);
  r.rect(1, 1, 28, 3, C.w4); r.rect(1, 26, 28, 3, C.w1); r.rect(1, 1, 3, 28, C.w3); r.rect(26, 1, 3, 28, C.w1);
  r.rect(1, 1, 28, 1, C.w5);
  for (let k = 4; k < 26; k++) { r.set(k, k, C.w1); r.set(k + 1, k, C.w4); r.set(29 - k, k, C.w1); r.set(28 - k, k, C.w4); }
  for (let y = 5; y < 25; y += 5) for (let x = 5; x < 25; x++) if (hash(x, y, 2) > 0.6 && Math.abs(x - y) > 1 && Math.abs(29 - x - y) > 1) r.set(x, y, C.w3);
  for (const [x, y] of [[2, 2], [27, 2], [2, 27], [27, 27]]) { r.set(x, y, C.w5); }
  r.set(0, 0, null); r.clear(0, 0); r.clear(29, 0); r.clear(0, 29); r.clear(29, 29);
});

// ---------------------------------------------------------------- saw (32x32, 4 spin frames; hazard radius 13)
for (let f = 0; f < 4; f++) add(`saw${f}`, 32, 32, (r) => {
  const teeth = 12, rot = (f / 4) * (Math.PI * 2 / teeth);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const dx = x + 0.5 - 16, dy = y + 0.5 - 16, d = Math.hypot(dx, dy);
    let a = Math.atan2(dy, dx) - rot; a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const ph = (a / (Math.PI * 2 / teeth)) % 1;
    const edge = 11.5 + (1 - ph) * 3.5; // sawtooth profile
    if (d > edge) continue;
    let c = d > edge - 1 ? C.st1 : d > 10 ? (ph < 0.5 ? C.st4 : C.st3) : d > 8.5 ? C.st2 : C.st3;
    if (d < 7.5) c = (dx + dy < 0) ? C.st2 : C.st1;
    if (d < 4) c = C.red;
    if (d < 1.6) c = C.gold2;
    r.set(x, y, c);
  }
  for (let k = 0; k < 3; k++) { const a = rot * 4 + k * 2.094; r.set(Math.round(16 + Math.cos(a) * 6 - 0.5), Math.round(16 + Math.sin(a) * 6 - 0.5), C.st4); }
});

// ---------------------------------------------------------------- resonance crystal (20x28)
add('crystal', 20, 28, (r) => {
  const pts = [[10, 0], [19, 10], [10, 27], [1, 10]];
  r.poly(pts, C.p1);
  r.poly([[10, 1], [14, 10], [10, 22], [5, 10]], C.p2);
  r.poly([[10, 2], [11, 10], [10, 15], [7, 10]], C.p3);
  for (let y = 11; y < 26; y++) for (let x = 10; x < 19; x++) if (r.get(x, y) && bayer(x, y) < 0.35) r.set(x, y, C.p0);
  r.line(10, 0, 19, 10, C.p3); r.line(1, 10, 10, 0, C.p3);
});

// ---------------------------------------------------------------- lever (base, stick and tintable knob in 3 poses)
add('lever_base', 24, 8, (r) => { outlineRect(r, 0, 0, 24, 8, C.d2, C.ink); r.rect(1, 1, 22, 1, C.d4); r.clear(0, 0); r.clear(23, 0); });
add('lever_strip_g', 18, 2, (r) => { r.rect(0, 0, 18, 1, C.g4); r.rect(0, 1, 18, 1, C.g2); });
const LEVER_ANG = [-40, 0, 40];
for (let k = 0; k < 3; k++) {
  const a = (LEVER_ANG[k] * Math.PI) / 180;
  const px = 12, py = 21; // pivot inside a 24x22 box, base sits under it
  const hx = px + Math.sin(a) * 15, hy = py - Math.cos(a) * 15;
  add(`lever_stick${k}`, 24, 22, (r) => {
    for (let t = 0; t <= 1; t += 0.04) { const x = px + (hx - px) * t, y = py + (hy - py) * t; r.set(x - 0.5, y, C.st3); r.set(x + 0.5, y, C.st2); }
    r.rect(px - 2, py - 2, 4, 2, C.st1);
  });
  add(`lever_knob${k}_g`, 24, 22, (r) => {
    r.circle(hx, hy, 4.2, C.g1); r.circle(hx - 0.6, hy - 0.6, 3.2, C.g3); r.set(hx - 2, hy - 2, C.g4); r.set(hx - 1, hy - 2, C.g4);
  });
}

// ---------------------------------------------------------------- pressure plate (64 wide; trigger zone is the bottom 10 px)
add('plate_base', 64, 6, (r) => { outlineRect(r, 0, 0, 64, 6, C.d2, C.ink); r.rect(1, 1, 62, 1, C.d4); r.clear(0, 0); r.clear(63, 0); for (let x = 6; x < 60; x += 8) r.set(x, 3, C.d1); });
add('plate_up_g', 56, 5, (r) => { outlineRect(r, 0, 0, 56, 5, C.g2, C.g0); r.rect(1, 1, 54, 1, C.g4); r.clear(0, 0); r.clear(55, 0); });
add('plate_down_g', 56, 3, (r) => { outlineRect(r, 0, 0, 56, 3, C.g3, C.g1); r.rect(1, 1, 54, 1, C.g4); });

// ---------------------------------------------------------------- doors (32 wide, vertical, any height in 16 px segments)
add('door_seg', 32, 16, (r) => {
  r.rect(0, 0, 32, 16, C.ink);
  r.rect(3, 0, 26, 16, C.st0);
  r.rect(4, 0, 1, 16, C.st1); r.rect(27, 0, 1, 16, C.ink);
  r.rect(3, 15, 26, 1, C.ink);
  for (const x of [6, 25]) { r.set(x, 3, C.st2); r.set(x, 12, C.st2); }
});
add('door_stripe_g', 32, 16, (r) => { r.rect(8, 6, 16, 3, C.g2); r.rect(8, 6, 16, 1, C.g4); });
add('door_edge_g', 32, 4, (r) => { r.rect(0, 0, 32, 4, C.g1); r.rect(0, 0, 32, 1, C.g4); r.rect(0, 3, 32, 1, C.g0); });

// ---------------------------------------------------------------- light bridge (32x32 segment, solid and ghost)
add('bridge_on_g', 32, 32, (r) => {
  r.rect(0, 2, 32, 28, C.g1);
  r.rect(0, 2, 32, 3, C.g4); r.rect(0, 5, 32, 1, C.g3);
  r.rect(0, 29, 32, 1, C.g0);
  for (let x = 4; x < 32; x += 12) { r.rect(x, 10, 6, 2, C.g3); r.rect(x + 6, 18, 6, 2, C.g2); }
  for (let y = 6; y < 29; y++) for (let x = 0; x < 32; x++) if (bayer(x, y) < 0.12) r.set(x, y, C.g2);
});
add('bridge_off_g', 32, 32, (r) => { for (let x = 0; x < 32; x += 8) { r.rect(x, 3, 4, 1, C.g3); r.rect(x + 2, 28, 2, 1, C.g1); } });

// ---------------------------------------------------------------- moving platform (N x 32 wide, 14 high)
const platPiece = (r, part) => {
  r.rect(0, 0, 32, 14, C.ink);
  r.rect(0, 1, 32, 10, C.st1);
  r.rect(0, 3, 32, 1, C.st2);
  r.rect(0, 10, 32, 1, C.st0);
  r.rect(0, 11, 32, 3, C.d1);
  for (let x = 6; x < 32; x += 14) { r.set(x, 7, C.ink); r.set(x + 1, 6, C.st3); }
  if (part === 0) { r.clear(0, 0); r.clear(0, 13); r.rect(0, 1, 1, 12, C.ink); }
  if (part === 2) { r.clear(31, 0); r.clear(31, 13); r.rect(31, 1, 1, 12, C.ink); }
};
['plat_l', 'plat_m', 'plat_r'].forEach((n, i) => add(n, 32, 14, (r) => platPiece(r, i)));
add('plat_stripe_g', 32, 3, (r) => { r.rect(0, 0, 32, 1, C.g4); r.rect(0, 1, 32, 2, C.g2); });

// ---------------------------------------------------------------- fan housing (blows up; 32x10 per tile, 4 blade frames)
for (let f = 0; f < 4; f++) add(`fan${f}`, 32, 10, (r) => {
  outlineRect(r, 0, 0, 32, 10, C.d2, C.ink);
  for (let k = 0; k < 4; k++) {
    const x = 2 + k * 8, open = (k + f) % 2;
    r.rect(x, 2, 6, 6, C.d1);
    r.rect(x + (open ? 0 : 2), 3, open ? 6 : 2, 4, open ? C.st3 : C.st2);
  }
  r.rect(1, 1, 30, 1, C.d4);
});

// ---------------------------------------------------------------- light emitter (32x32, faces right)
for (const on of [0, 1]) add(`emitter_${on ? 'on' : 'off'}`, 32, 32, (r) => {
  outlineRect(r, 3, 3, 26, 26, C.d2, C.ink);
  r.rect(4, 4, 24, 2, C.d4);
  r.rect(5, 26, 22, 2, C.d1);
  for (const [x, y] of [[6, 6], [25, 6], [6, 25], [25, 25]]) r.set(x, y, C.gold);
  r.circle(15, 16, 6, C.ink);
  r.circle(15, 16, 5, on ? C.gold : hex('#6b5a4a'));
  if (on) { r.circle(15, 16, 3, C.gold2); r.set(14, 14, C.g4); }
  r.rect(26, 12, 5, 8, C.st1); r.rect(26, 13, 5, 6, on ? C.gold2 : C.st2); r.rect(31, 14, 1, 4, on ? C.g4 : C.st3);
});

// ---------------------------------------------------------------- mirror (tintable ring + 5 plate angles from '/' to '\')
add('mirror_ring_g', 32, 32, (r) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16); if (d <= 14 && d > 11.5) r.set(x, y, d > 13 ? C.g1 : (y < 16 ? C.g4 : C.g2)); }
  r.rect(13, 28, 6, 4, C.g0);
});
add('mirror_back', 32, 32, (r) => r.circle(16, 16, 11.5, C.d1));
for (let k = 0; k < 5; k++) {
  const ang = ((45 - k * 22.5) * Math.PI) / 180;
  add(`mirror_a${k}`, 32, 32, (r) => {
    const dx = Math.cos(ang), dy = -Math.sin(ang);
    for (let t = -12; t <= 12; t += 0.25) {
      const x = 16 + dx * t, y = 16 + dy * t;
      for (let w = -2; w <= 2; w++) {
        const px = x - dy * w * 0.9, py = y + dx * w * 0.9;
        r.set(px - 0.5, py - 0.5, w === -2 ? C.st1 : w === 2 ? C.st0 : w <= 0 ? C.g4 : C.st4);
      }
    }
  });
}

// ---------------------------------------------------------------- prism (32x32)
add('prism', 32, 32, (r) => {
  r.poly([[16, 2], [30, 27], [2, 27]], C.p3);
  r.poly([[16, 4], [28, 26], [4, 26]], C.p1);
  r.poly([[16, 6], [22, 22], [10, 22]], C.p2);
  r.line(16, 5, 11, 21, C.p3);
  for (let x = 4; x < 28; x++) if (bayer(x, 25) < 0.5) r.set(x, 25, C.p0);
  r.rect(6, 27, 20, 3, C.d2); r.rect(6, 27, 20, 1, C.d4);
});

// ---------------------------------------------------------------- receiver (housing, tintable ring, core states)
add('recv_base', 32, 32, (r) => { r.circle(16, 16, 13.5, C.ink); r.circle(16, 16, 12, C.d2); r.rect(10, 28, 12, 4, C.d2); r.rect(10, 31, 12, 1, C.ink); });
add('recv_ring_g', 32, 32, (r) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16); if (d <= 12 && d > 9.5) r.set(x, y, y < 15 ? C.g4 : C.g2); }
});
for (const [n, cols] of [['off', [C.d3, C.d4]], ['mid', [C.gold, C.d5]], ['on', [C.gold2, C.g4]]]) add(`recv_core_${n}`, 32, 32, (r) => {
  r.circle(16, 16, 7, cols[0]); r.circle(15, 15, 3, cols[1]);
  if (n === 'on') for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; r.set(16 + Math.cos(a) * 5 - 0.5, 16 + Math.sin(a) * 5 - 0.5, C.g4); }
});

// ---------------------------------------------------------------- elemental nodes (Ember brazier, Tide font)
for (const on of [0, 1]) {
  add(`node_ember_${on ? 'on' : 'off'}`, 32, 32, (r) => {
    r.poly([[2, 18], [30, 18], [24, 32], [8, 32]], C.ink);
    r.poly([[4, 19], [28, 19], [23, 31], [9, 31]], C.d2);
    r.rect(3, 17, 26, 3, on ? C.e2 : hex('#4a2a1f'));
    r.rect(3, 17, 26, 1, on ? C.e3 : hex('#6b3a22'));
    for (const x of [9, 16, 23]) r.set(x, 25, on ? C.e1 : C.d1);
    if (on) { for (const [dx, h, c] of [[-4, 7, C.e1], [0, 11, C.e2], [4, 8, C.e1], [-1, 6, C.e3], [2, 5, C.e3]]) for (let y = 0; y < h; y++) r.set(16 + dx + (y > h / 2 ? (y % 2) : 0), 16 - y, y > h - 3 ? C.e3 : c); }
    else { r.rect(13, 14, 6, 3, hex('#3a2a24')); r.set(15, 13, hex('#6b3a22')); }
  });
  add(`node_tide_${on ? 'on' : 'off'}`, 32, 32, (r) => {
    outlineRect(r, 3, 18, 26, 14, C.d2, C.ink);
    r.rect(4, 19, 24, 1, C.d4);
    r.rect(6, 21, 20, 7, on ? C.t2 : hex('#1d3446'));
    r.rect(6, 21, 20, 1, on ? C.t3 : hex('#2a4a60'));
    if (on) { for (const [dx, h] of [[-3, 6], [0, 10], [3, 7]]) for (let y = 0; y < h; y++) r.set(16 + dx, 20 - y, y === h - 1 ? C.t3 : C.t2); r.set(12, 9, C.t3); r.set(20, 11, C.t3); }
  });
}

// ---------------------------------------------------------------- checkpoint (pole for a 32x64 slot + tintable flag)
add('cp_pole', 18, 64, (r) => {
  r.rect(1, 59, 16, 5, C.ink); r.rect(2, 60, 14, 3, C.d3); r.rect(2, 60, 14, 1, C.d5);
  r.rect(8, 6, 3, 54, C.d6); r.rect(10, 6, 1, 54, C.d4);
  r.circle(9.5, 5, 2.6, C.gold); r.set(9, 4, C.gold2);
});
for (let f = 0; f < 3; f++) add(`cp_flag${f}_g`, 18, 14, (r) => {
  for (let x = 0; x < 17; x++) {
    const wave = Math.round(Math.sin(x / 3 + f * 2.1) * 1.2);
    const half = Math.round(6.5 * (1 - x / 17));
    for (let y = -half; y <= half; y++) r.set(x, 7 + y + wave, y === -half ? C.g4 : y > half - 2 ? C.g1 : C.g3);
  }
});

// ---------------------------------------------------------------- exit portal arches (64x96, 64x64)
for (const h of [96, 64]) add(`exit${h}`, 64, h, (r) => {
  const R = 30;
  for (let y = 0; y < h; y++) for (let x = 0; x < 64; x++) {
    const cx = x + 0.5 - 32, top = 6 + R, inArch = y >= top ? Math.abs(cx) <= R : Math.hypot(cx, y + 0.5 - top) <= R;
    if (!inArch) continue;
    const inner = y >= top ? Math.abs(cx) <= R - 4 : Math.hypot(cx, y + 0.5 - top) <= R - 4;
    if (!inner) { r.set(x, y, (y < top + 4 && cx < 0) || cx < -R + 2 ? C.d6 : C.d4); continue; }
    r.set(x, y, bayer(x, y) < 0.25 + (y / h) * 0.3 ? C.d1 : C.ink);
  }
  for (let k = 0; k < 18; k++) r.set(10 + hash(k, h) * 44, 14 + hash(k, h, 1) * (h - 20), [C.p2, C.e2, C.t2][k % 3]);
  r.rect(0, h - 4, 64, 4, C.d3); r.rect(0, h - 4, 64, 1, C.d6);
  for (const x of [4, 57]) for (let y = 40; y < h - 4; y += 10) r.set(x, y, C.p2);
});

// ---------------------------------------------------------------- sign post (32x32)
add('sign', 32, 32, (r) => {
  r.rect(14, 22, 4, 10, C.w1); r.rect(14, 22, 1, 10, C.w3);
  outlineRect(r, 5, 6, 22, 17, C.w4, C.w0);
  r.rect(6, 7, 20, 1, C.w5); r.rect(6, 21, 20, 1, C.w2);
  for (const [x, y] of [[14, 10], [15, 9], [16, 9], [17, 10], [17, 11], [16, 12], [15, 13], [15, 14], [15, 17]]) r.set(x, y, C.ink);
  r.set(15, 18, C.ink);
});

// ---------------------------------------------------------------- ice block (32x32 tile)
add('ice', 32, 32, (r) => {
  r.rect(1, 0, 30, 32, hex('#9fe8ff'));
  for (let y = 0; y < 32; y++) for (let x = 1; x < 31; x++) if (bayer(x, y) < 0.3 + (y / 32) * 0.25) r.set(x, y, hex('#6cc8f0'));
  r.rect(1, 0, 30, 2, hex('#e8fbff'));
  r.rect(1, 0, 1, 32, hex('#cff6ff')); r.rect(30, 0, 1, 32, hex('#3d9ac8'));
  r.line(6, 8, 15, 14, hex('#ffffff')); r.line(15, 14, 25, 10, hex('#e8fbff')); r.line(9, 24, 18, 21, hex('#ffffff'));
});

// ---------------------------------------------------------------- pack (shelf packer, 2 px gaps)
frames.sort((a, b) => b.r.h - a.r.h || b.r.w - a.r.w);
const AW = 256;
let x = 1, y = 1, rowH = 0;
for (const f of frames) {
  if (x + f.r.w + 1 > AW) { x = 1; y += rowH + 2; rowH = 0; }
  f.x = x; f.y = y; x += f.r.w + 2; rowH = Math.max(rowH, f.r.h);
}
const AH = y + rowH + 1;
const atlas = new Raster(AW, AH);
const json = { frames: {}, meta: { app: 'tools/art/objects.mjs', version: 'duality-objects-1', image: 'objects.png', format: 'RGBA8888', size: { w: AW, h: AH }, scale: '1' } };
for (const f of frames) {
  atlas.blit(f.r, f.x, f.y);
  json.frames[f.name] = { frame: { x: f.x, y: f.y, w: f.r.w, h: f.r.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.r.w, h: f.r.h }, sourceSize: { w: f.r.w, h: f.r.h } };
}
fs.writeFileSync(path.join(OUT, 'objects.png'), atlas.png());
fs.writeFileSync(path.join(OUT, 'objects.json'), JSON.stringify(json, null, 1) + '\n');

// ---------------------------------------------------------------- validation
const errors = [];
const expect = { crate: [30, 30], crystal: [20, 28], saw0: [32, 32], plate_base: [64, 6], door_seg: [32, 16], plat_m: [32, 14], exit96: [64, 96], exit64: [64, 64], cp_pole: [18, 64], ice: [32, 32] };
for (const [n, [w, h]] of Object.entries(expect)) { const f = json.frames[n]; if (!f || f.frame.w !== w || f.frame.h !== h) errors.push(`${n} should be ${w}x${h}`); }
for (let i = 3; i < atlas.data.length; i += 4) if (atlas.data[i] !== 0 && atlas.data[i] !== 255) { errors.push('soft alpha in atlas'); break; }
for (const f of frames.filter((f) => f.name.endsWith('_g'))) { // tintable parts must be neutral grey
  for (let i = 0; i < f.r.data.length; i += 4) if (f.r.data[i + 3] && (f.r.data[i] !== f.r.data[i + 1] || f.r.data[i + 1] !== f.r.data[i + 2])) { errors.push(`${f.name} is not greyscale`); break; }
}
{ // saw art must cover the 13 px hazard radius but stay within the 32 px frame
  const s = frames.find((f) => f.name === 'saw0').r;
  let minR = 99; for (let a = 0; a < 360; a += 5) { let d = 0; while (s.get(Math.floor(16 + Math.cos(a * Math.PI / 180) * d), Math.floor(16 + Math.sin(a * Math.PI / 180) * d))) d += 0.5; minR = Math.min(minR, d); }
  if (minR < 11) errors.push(`saw body radius ${minR} too small for the 13 px hazard`);
}
const big = new Raster(AW * 4, AH * 4);
for (let yy = 0; yy < big.h; yy++) for (let xx = 0; xx < big.w; xx++) big.set(xx, yy, atlas.get(xx >> 2, yy >> 2) ?? ((((xx >> 4) + (yy >> 4)) & 1) ? [40, 36, 52] : [56, 52, 70]));
fs.writeFileSync(path.join(SRC, 'objects_x4.png'), big.png());
fs.writeFileSync(path.join(SRC, 'validation.json'), JSON.stringify({ frames: frames.length, size: [AW, AH], errors }, null, 2) + '\n');
console.log(`objects atlas ${AW}x${AH}, ${frames.length} frames`, errors.length ? errors : 'OK');
if (errors.length) process.exit(1);
