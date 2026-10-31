// Ember animation library (43 frames, 32x40) built from the immutable master
// sprite art-src/ember/ember_master.png. Every frame re-uses the master's own
// pixels (head, face, torso, arms, hands, legs, boots), moved by whole-pixel
// offsets — nothing is scaled. Limbs are redrawn only where a pose needs it
// (run strides, raised arms), and death/respawn use hand-drawn flame shapes
// shaded with the same palette and rim-to-core method as the head.
//
// Usage: node tools/art/ember-anims.mjs
// Output: art-src/ember/final/ (atlas, Aseprite JSON, contact sheet, previews, checks)
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG, encodeAPNG } from './png.mjs';

const OUT = 'art-src/ember/final';
fs.mkdirSync(path.join(OUT, 'previews'), { recursive: true });
const spec = JSON.parse(fs.readFileSync('apps/web/src/art/characters/spec.json', 'utf8'));
const PAL = JSON.parse(fs.readFileSync('art-src/ember/palette.json', 'utf8'));
const W = spec.frame.w, H = spec.frame.h;
const RGB = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, [1, 3, 5].map((i) => parseInt(v.hex.slice(i, i + 2), 16))]));
const KEY_OF = new Map(Object.entries(RGB).map(([k, c]) => [c.join(','), k]));

// ---------------------------------------------------------------- master parts
const master = decodePNG(fs.readFileSync('art-src/ember/ember_master.png'));
const M = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = (y * W + x) * 4;
  if (master.rgba[o + 3] !== 255) continue;
  const k = KEY_OF.get(`${master.rgba[o]},${master.rgba[o + 1]},${master.rgba[o + 2]}`);
  if (!k) throw new Error(`master pixel ${x},${y} is not in the palette`);
  M.push({ x, y, ch: k });
}
const part = (pred) => M.filter((p) => pred(p.x, p.y)).map((p) => ({ ...p }));
const HEAD = part((x, y) => y <= 25);
const TORSO = part((x, y) => y >= 26 && y <= 33 && x >= 14 && x <= 20);
const BACK_UPPER = part((x, y) => y >= 27 && y <= 30 && x <= 13);
const BACK_HAND = part((x, y) => y >= 31 && y <= 34 && x <= 13);
const FRONT_UPPER = part((x, y) => y >= 27 && y <= 30 && x >= 21);
const FRONT_HAND = part((x, y) => y >= 31 && y <= 33 && x >= 21);
const BACK_LEG = part((x, y) => y >= 34 && y <= 36 && x >= 14 && x <= 15);
const FRONT_LEG = part((x, y) => y >= 34 && y <= 36 && x >= 18 && x <= 19);
const BOOT_B = part((x, y) => y >= 37 && x <= 16);
const BOOT_F = part((x, y) => y >= 37 && x >= 17);
const used = new Set([HEAD, TORSO, BACK_UPPER, BACK_HAND, FRONT_UPPER, FRONT_HAND, BACK_LEG, FRONT_LEG, BOOT_B, BOOT_F].flat().map((p) => `${p.x},${p.y}`));
const orphan = M.filter((p) => !used.has(`${p.x},${p.y}`));
if (orphan.length) throw new Error(`master pixels not assigned to a part: ${orphan.map((p) => `${p.x},${p.y}`).join(' ')}`);

const SHOULDER = { back: [13, 27], front: [21, 27] }; // adjacent to the torso so arms never detach
const WRIST = { back: [10, 31], front: [22, 31] };
const HIP = { back: 14, front: 18 };
const BOOT_ANCHOR = { back: 3, front: 0 }; // leg column offset inside each boot

// ---------------------------------------------------------------- head variants
const FLAME = new Set(['d', 'r', 'o', 'a', 'g', 'y']);
const isFlame = (p) => p.y <= 13 || (FLAME.has(p.ch) && (p.x <= 14 || p.x >= 25));
function headVariant({ flame = 'A', eyes = 'open' } = {}) {
  let h = HEAD.map((p) => ({ ...p }));
  const sway = (y0, y1, dx) => { h = h.map((p) => (p.y >= y0 && p.y <= y1 ? { ...p, x: p.x + dx } : p)); };
  const shimmer = () => { h = h.map((p) => (isFlame(p) && (p.x + p.y) % 3 === 0 ? { ...p, ch: p.ch === 'g' ? 'y' : p.ch === 'y' ? 'g' : p.ch } : p)); };
  const add = (x, y, ch) => { h = h.filter((p) => !(p.x === x && p.y === y)); h.push({ x, y, ch }); };
  switch (flame) {
    case 'B': sway(2, 5, 1); shimmer(); break;
    case 'C': sway(2, 5, -1); sway(8, 9, 1); break;
    case 'wind1': sway(2, 6, -1); break;
    case 'wind2': sway(2, 4, -2); sway(5, 7, -1); shimmer(); break;
    case 'up': add(13, 1, 'r'); add(13, 2, 'o'); break;
    case 'up2': add(13, 1, 'r'); add(13, 2, 'o'); add(12, 2, 'r'); shimmer(); break;
    case 'flare': add(13, 1, 'r'); add(13, 2, 'o'); add(13, 0, 'r'); add(5, 15, 'r'); add(5, 16, 'r'); add(21, 7, 'r'); add(26, 16, 'r'); shimmer(); break;
    default: break;
  }
  if (eyes === 'closed') {
    h = h.map((p) => (p.y >= 18 && p.y <= 21 && ((p.x >= 15 && p.x <= 18) || (p.x >= 21 && p.x <= 23)) && 'ewi'.includes(p.ch) ? { ...p, ch: 'c' } : p));
    for (const x of [16, 17, 18, 21, 22, 23]) add(x, 20, 'e');
  }
  return h;
}

// ---------------------------------------------------------------- drawing
function newFrame() { return Array.from({ length: H }, () => Array(W).fill('.')); }
function put(F, x, y, ch) { if (x >= 0 && y >= 0 && x < W && y < H && ch !== '.') F[y][x] = ch; }
function draw(F, pixels, dx = 0, dy = 0) { for (const p of pixels) put(F, p.x + dx, p.y + dy, p.ch); }

function line(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return pts;
}

/** Arm: 'rest' re-uses the master arm (translated); otherwise a 2-px upper arm to a wrist target. */
function drawArm(F, side, arm, bx, by) {
  const upper = side === 'back' ? BACK_UPPER : FRONT_UPPER;
  const hand = side === 'back' ? BACK_HAND : FRONT_HAND;
  if (!arm || arm.mode === 'rest') {
    const dx = arm?.dx ?? 0, dy = arm?.dy ?? 0;
    draw(F, upper, bx + Math.sign(dx), by + Math.max(-1, Math.min(1, dy)));
    draw(F, hand, bx + dx, by + dy);
    return;
  }
  const [sx, sy] = SHOULDER[side];
  const [wx0, wy0] = WRIST[side];
  const wx = arm.wx + bx, wy = arm.wy + by;
  for (const [x, y] of line(sx + bx, sy + by + 1, wx, wy - 1)) {
    put(F, x, y, side === 'back' ? 'r' : 'o');
    put(F, x, y + 1, side === 'back' ? 'd' : 'r');
    put(F, x + (wx >= sx + bx ? 1 : -1), y, side === 'back' ? 'o' : 'a');
  }
  draw(F, hand, wx - wx0, wy - wy0);
}

/** Leg from hip to an ankle above the boot; the boot is the master boot, translated. */
function drawLeg(F, side, hipX, hipY, footX, footBottom) {
  const boot = side === 'back' ? BOOT_B : BOOT_F;
  const cols = side === 'back' ? ['o', 'a'] : ['a', 'o'];
  // A lifted foot bends the knee: the ankle can rise to the hip but never above it.
  const ankle = Math.max(hipY, footBottom - 3);
  // Bresenham keeps the 2-px leg connected however far the stride reaches.
  for (const [x, y] of line(hipX, hipY, footX, ankle)) {
    put(F, x, y, cols[0]);
    put(F, x + 1, y, cols[1]);
  }
  // Boots keep their master shape; the leg column sits at BOOT_ANCHOR inside the boot.
  const bootLeft = Math.min(...boot.map((p) => p.x));
  draw(F, boot, footX - BOOT_ANCHOR[side] - bootLeft, footBottom - 39);
}

/**
 * A full-body pose. Offsets are whole pixels relative to the master.
 *  body: torso/head/arms offset; head: extra head offset; legs: { back:{foot,lift}, front:{foot,lift}, hipDy }.
 */
function pose(opts = {}) {
  const F = newFrame();
  const bx = opts.bodyDx ?? 0, by = opts.bodyDy ?? 0;
  const legs = opts.legs;
  drawArm(F, 'back', opts.backArm, bx, by);
  const hipY = 34 + by + (legs?.hipDy ?? 0);
  if (legs) {
    drawLeg(F, 'back', HIP.back + bx + (legs.hipDx?.back ?? 0), hipY, HIP.back + (legs.back?.foot ?? 0), 39 - (legs.back?.lift ?? 0));
  } else {
    draw(F, BACK_LEG.filter((p) => p.y + by >= hipY), 0, 0);
    draw(F, BOOT_B);
  }
  draw(F, TORSO, bx, by);
  if (legs) {
    drawLeg(F, 'front', HIP.front + bx + (legs.hipDx?.front ?? 0), hipY, HIP.front + (legs.front?.foot ?? 0), 39 - (legs.front?.lift ?? 0));
  } else {
    draw(F, FRONT_LEG.filter((p) => p.y + by >= hipY), 0, 0);
    draw(F, BOOT_F);
  }
  // Torso bottom may hover above the master legs when the body rises; legs above fill the gap.
  if (!legs && by < 0) for (let k = 1; k <= -by; k++) { put(F, 14, 33 + by + k, 'o'); put(F, 15, 33 + by + k, 'a'); put(F, 18, 33 + by + k, 'a'); put(F, 19, 33 + by + k, 'o'); }
  draw(F, headVariant(opts.head ?? {}), bx + (opts.headDx ?? 0), by + (opts.headDy ?? 0));
  drawArm(F, 'front', opts.frontArm, bx, by);
  return F;
}

// Hand-drawn flame shapes (death / respawn), shaded rim -> heart like the head.
function flameShape(rows, bands) {
  const F = newFrame();
  const inside = (x, y) => (rows[y] ?? []).some(([a, b]) => x >= a && x <= b);
  const dist = Array.from({ length: H }, () => Array(W).fill(Infinity));
  const q = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    if ([[1, 0], [-1, 0], [0, -1]].some(([dx, dy]) => !inside(x + dx, y + dy))) { dist[y][x] = 0; q.push([x, y]); }
  }
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || dist[ny][nx] <= dist[y][x] + 1) continue;
      dist[ny][nx] = dist[y][x] + 1; q.push([nx, ny]);
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) F[y][x] = bands[Math.min(dist[y][x], bands.length - 1)];
  return F;
}
const R = (pairs) => Object.fromEntries(pairs.map(([y, ...iv]) => [y, iv]));
const PILE = R([[27, [16, 16]], [28, [15, 16]], [29, [15, 17], [12, 12]], [30, [14, 17], [12, 12]], [31, [13, 18], [21, 21]], [32, [12, 19], [21, 21]],
  [33, [11, 21]], [34, [11, 21]], [35, [10, 22]], [36, [10, 22]], [37, [10, 22]], [38, [10, 22]], [39, [11, 21]]]);
const SMALL_PILE = R([[33, [16, 16]], [34, [15, 17]], [35, [15, 17]], [36, [14, 18]], [37, [13, 19]], [38, [13, 19]], [39, [13, 19]]]);
const EMBER = R([[37, [16, 16]], [38, [15, 17]], [39, [14, 18]]]);
const COLUMN = R([[9, [15, 15]], [10, [14, 15]], [11, [14, 16]], [12, [13, 16]], [13, [13, 17], [20, 20]], [14, [12, 17], [19, 20]],
  [15, [12, 18], [19, 20]], [16, [12, 20]], [17, [11, 20]], [18, [11, 20]], [19, [10, 21]], [20, [10, 21], [8, 8]], [21, [9, 21]],
  [22, [9, 21]], [23, [10, 21]], [24, [11, 21]], [25, [11, 22]], [26, [11, 22]], [27, [11, 21]], [28, [11, 21]], [29, [11, 21]],
  [30, [11, 21]], [31, [11, 21]], [32, [11, 21]], [33, [10, 22]], [34, [10, 22]], [35, [10, 22]], [36, [10, 22]], [37, [10, 22]],
  [38, [10, 22]], [39, [11, 21]]]);
const BRIGHT = ['r', 'o', 'a', 'g', 'y', 'l'];
const DIM = ['d', 'r', 'o', 'a'];

function meltFrame() {
  // Head sinks into a pool of its own flame: master head (eyes closed) above a flame base.
  const F = flameShape(R([
    [28, [10, 10], [23, 23]], [29, [10, 11], [22, 23]], [30, [9, 11], [22, 24]], [31, [9, 12], [21, 24]], [32, [10, 23]],
    [33, [9, 23]], [34, [9, 24]], [35, [10, 24]], [36, [10, 23]], [37, [10, 23]], [38, [11, 22]], [39, [12, 21]],
  ]), BRIGHT);
  draw(F, headVariant({ flame: 'B', eyes: 'closed' }), 0, 7);
  return F;
}

// ---------------------------------------------------------------- animation specs
const RUN_FOOT = [3, 2, 0, -2, -3, -2, 0, 2];
const RUN_LIFT = [0, 0, 0, 0, 1, 2, 2, 1];
const RUN_BOB = [0, 1, 0, -1, 0, 1, 0, -1];
const RUN_ARM = [-1, -1, 0, 1, 1, 1, 0, -1];
const PUSH_FOOT = [1, 0, -1, -2, -1, 0];
const PUSH_LIFT = [0, 0, 0, 0, 1, 1];

const ANIMS = {
  idle: [0, 1, 2, 3, 4, 5].map((f) => pose({
    bodyDy: [0, 0, 1, 1, 1, 0][f],
    head: { flame: ['A', 'B', 'A', 'C', 'A', 'B'][f], eyes: f === 4 ? 'closed' : 'open' },
  })),
  run: [0, 1, 2, 3, 4, 5, 6, 7].map((f) => {
    const b = (f + 4) % 8;
    return pose({
      bodyDy: RUN_BOB[f], headDx: 1,
      head: { flame: f % 2 ? 'wind2' : 'wind1' },
      // Arms swing opposite the legs, drawn shoulder-to-wrist so they stay attached.
      backArm: { wx: 10 - RUN_ARM[f] * 2, wy: 31 - Math.abs(RUN_ARM[f]) },
      frontArm: { wx: 22 + RUN_ARM[f] * 2, wy: 31 - Math.abs(RUN_ARM[f]) },
      legs: {
        hipDx: { back: 1, front: -1 },
        front: { foot: RUN_FOOT[f] - 1, lift: RUN_LIFT[f] },
        back: { foot: RUN_FOOT[b] + 1, lift: RUN_LIFT[b] },
      },
    });
  }),
  jump_rise: [
    // Take-off (the animation starts once the body is already rising, so no crouch).
    pose({ head: { flame: 'up' }, backArm: { wx: 9, wy: 28 }, frontArm: { wx: 24, wy: 28 },
      legs: { back: { foot: 0 }, front: { foot: 0 } } }),
    pose({ bodyDy: -1, head: { flame: 'up2' }, backArm: { wx: 9, wy: 26 }, frontArm: { wx: 24, wy: 26 },
      legs: { back: { foot: -1, lift: 2 }, front: { foot: 0, lift: 1 } } }),
    pose({ bodyDy: -1, head: { flame: 'up' }, backArm: { wx: 9, wy: 25 }, frontArm: { wx: 24, wy: 25 },
      legs: { back: { foot: 0, lift: 4 }, front: { foot: 1, lift: 3 } } }),
  ],
  fall: [
    pose({ head: { flame: 'up' }, backArm: { wx: 8, wy: 27 }, frontArm: { wx: 25, wy: 26 },
      legs: { back: { foot: -2, lift: 2 }, front: { foot: 1, lift: 1 } } }),
    pose({ head: { flame: 'up2' }, backArm: { wx: 8, wy: 26 }, frontArm: { wx: 25, wy: 27 },
      legs: { back: { foot: -2, lift: 1 }, front: { foot: 1, lift: 2 } } }),
  ],
  land: [
    pose({ bodyDy: 2, head: { flame: 'C' }, backArm: { mode: 'rest', dx: -1, dy: 1 }, frontArm: { mode: 'rest', dx: 1, dy: 1 },
      legs: { back: { foot: -2 }, front: { foot: 2 } } }),
    pose({ bodyDy: 1, head: { flame: 'B' }, backArm: { mode: 'rest', dy: 1 }, frontArm: { mode: 'rest', dy: 1 },
      legs: { back: { foot: -1 }, front: { foot: 1 } } }),
    pose({ head: { flame: 'A' } }),
  ],
  push: [0, 1, 2, 3, 4, 5].map((f) => {
    const b = (f + 3) % 6;
    return pose({
      bodyDx: 1, bodyDy: 1, headDx: 1,
      head: { flame: ['wind1', 'A', 'B', 'wind1', 'A', 'C'][f] },
      backArm: { wx: 22, wy: 30 }, frontArm: { wx: 24, wy: 29 },
      legs: {
        front: { foot: PUSH_FOOT[f] + 1, lift: PUSH_LIFT[f] },
        back: { foot: PUSH_FOOT[b] - 2, lift: PUSH_LIFT[b] },
      },
    });
  }),
  interact: [
    pose({ head: { flame: 'A' }, frontArm: { wx: 24, wy: 29 } }),
    pose({ head: { flame: 'B' }, frontArm: { wx: 25, wy: 26 } }),
    pose({ headDy: 1, head: { flame: 'A' }, frontArm: { wx: 25, wy: 31 } }),
    pose({ head: { flame: 'C' } }),
  ],
  death: [
    pose({ bodyDy: -1, head: { flame: 'flare' }, backArm: { wx: 8, wy: 25 }, frontArm: { wx: 25, wy: 25 },
      legs: { back: { foot: -1 }, front: { foot: 1 } } }),
    pose({ bodyDy: 2, head: { flame: 'C', eyes: 'closed' }, backArm: { mode: 'rest', dy: 2 }, frontArm: { mode: 'rest', dy: 2 },
      legs: { back: { foot: -1 }, front: { foot: 1 } } }),
    meltFrame(),
    flameShape(PILE, BRIGHT),
    flameShape(SMALL_PILE, DIM),
    flameShape(EMBER, ['d', 'r', 'a']),
  ],
  respawn: [
    flameShape(EMBER, ['r', 'a', 'g']),
    flameShape(SMALL_PILE, BRIGHT),
    flameShape(COLUMN, BRIGHT),
    pose({ head: { flame: 'up', eyes: 'closed' } }),
    pose({ head: { flame: 'A' } }),
  ],
};

// ---------------------------------------------------------------- checks
function analyse(F) {
  let n = 0, minX = W, maxX = -1, minY = H, maxY = -1, sx = 0, sy = 0, isolated = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (F[y][x] === '.') continue;
    n++; sx += x; sy += y;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    let nb = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && F[y + dy]?.[x + dx] && F[y + dy][x + dx] !== '.') nb++;
    if (!nb) isolated++;
  }
  // 8-connected components
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  let comps = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (F[y][x] === '.' || seen[y][x]) continue;
    comps++;
    const st = [[x, y]]; seen[y][x] = true;
    while (st.length) {
      const [cx, cy] = st.pop();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx] || F[ny][nx] === '.') continue;
        seen[ny][nx] = true; st.push([nx, ny]);
      }
    }
  }
  return { pixels: n, bbox: [minX, minY, maxX, maxY], width: maxX - minX + 1, centroid: [sx / n, sy / n], isolated, components: comps, baseline: F[spec.baseline].filter((c) => c !== '.').length };
}

const report = { frames: [], defects: [] };
const GROUNDED = new Set(['idle', 'run', 'land', 'push', 'interact']);
for (const a of spec.animations) {
  const frames = ANIMS[a.tag];
  if (!frames || frames.length !== a.frames) throw new Error(`${a.tag}: expected ${a.frames} frames, got ${frames?.length}`);
  let prev = null;
  frames.forEach((F, i) => {
    const s = analyse(F);
    report.frames.push({ tag: a.tag, frame: i, ...s });
    const where = `${a.tag}[${i}]`;
    if (s.isolated) report.defects.push(`${where}: ${s.isolated} isolated pixel(s)`);
    if (s.components > 1 && !['death', 'respawn'].includes(a.tag)) report.defects.push(`${where}: ${s.components} disconnected pieces`);
    if (GROUNDED.has(a.tag) && !s.baseline && !(a.tag === 'run' && false)) report.defects.push(`${where}: no pixel on the baseline`);
    if (s.width > spec.hitbox.w + 8) report.defects.push(`${where}: silhouette ${s.width}px wide`);
    if (prev && !['death', 'respawn'].includes(a.tag)) {
      const jump = Math.hypot(s.centroid[0] - prev.centroid[0], s.centroid[1] - prev.centroid[1]);
      if (jump > 2.5) report.defects.push(`${where}: centroid jumps ${jump.toFixed(1)}px from previous frame`);
    }
    prev = s;
  });
}

// ---------------------------------------------------------------- output
const toRGBA = (F) => {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = F[y][x];
    if (ch === '.') continue;
    const c = RGB[ch];
    const o = (y * W + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  return px;
};

// Atlas: one row per tag, 1-px border + 1-px spacing (same layout as the placeholders).
const PAD = spec.padding;
const cols = Math.max(...spec.animations.map((a) => a.frames));
const AW = PAD.border * 2 + cols * W + (cols - 1) * PAD.shape;
const AH = PAD.border * 2 + spec.animations.length * H + (spec.animations.length - 1) * PAD.shape;
const atlas = new Uint8Array(AW * AH * 4);
const jsonFrames = [];
const frameTags = [];
spec.animations.forEach((a, row) => {
  const from = jsonFrames.length;
  ANIMS[a.tag].forEach((F, f) => {
    const ox = PAD.border + f * (W + PAD.shape), oy = PAD.border + row * (H + PAD.shape);
    const px = toRGBA(F);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, d = ((oy + y) * AW + ox + x) * 4;
      atlas[d] = px[s]; atlas[d + 1] = px[s + 1]; atlas[d + 2] = px[s + 2]; atlas[d + 3] = px[s + 3];
    }
    jsonFrames.push({
      filename: String(jsonFrames.length), frame: { x: ox, y: oy, w: W, h: H }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: W, h: H }, sourceSize: { w: W, h: H }, duration: Math.round(1000 / a.fps),
    });
  });
  frameTags.push({ name: a.tag, from, to: jsonFrames.length - 1, direction: 'forward', color: '#000000ff' });
});
fs.writeFileSync(path.join(OUT, 'ember.png'), encodePNG(AW, AH, atlas));
fs.writeFileSync(path.join(OUT, 'ember.json'), JSON.stringify({
  frames: jsonFrames,
  meta: {
    app: 'https://www.aseprite.org/', version: 'duality-ember-1', image: 'ember.png', format: 'RGBA8888',
    size: { w: AW, h: AH }, scale: '1', frameTags,
    layers: [{ name: 'ember', opacity: 255, blendMode: 'normal' }],
    slices: [{ name: 'hitbox', color: '#00ff00ff', keys: [{ frame: 0, bounds: { x: spec.hitbox.x, y: spec.hitbox.y, w: spec.hitbox.w, h: spec.hitbox.h }, pivot: { x: spec.pivot.x - spec.hitbox.x, y: spec.pivot.y - spec.hitbox.y } }] }],
  },
}, null, 1) + '\n');

// Tiny label font
const FONT = {
  A: '010101111101101', B: '110101110101110', X: '101101010101101', C: '111100100100111', D: '110101101101110', E: '111100110100111', F: '111100110100100', H: '101101111101101',
  I: '111010010010111', J: '001001001101111', L: '100100100100111', M: '101111111101101', N: '110101101101101', P: '110101110100100',
  R: '110101110101101', S: '111100111001111', T: '111010010010010', U: '101101101101111', W: '101101111111101', _: '000000000000111',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111',
  6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111', ' ': '000000000000000',
};
function canvas(w, h, bg) { const c = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) c.set([...bg, 255], i * 4); return { w, h, c }; }
function fill(cv, x, y, w, h, col) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < cv.w && yy < cv.h) cv.c.set([...col, 255], (yy * cv.w + xx) * 4); }
function text(cv, s, x, y, k, col) { let cx = x; for (const ch of s.toUpperCase()) { const g = FONT[ch] ?? FONT[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') fill(cv, cx + (i % 3) * k, y + Math.floor(i / 3) * k, k, k, col); cx += 4 * k; } }
function blit(cv, F, x0, y0, k, opts = {}) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = F[y][x];
    const col = ch === '.' ? (opts.checker ? (((x + y) & 1) ? [44, 40, 62] : [36, 33, 52]) : null) : RGB[ch];
    if (col) fill(cv, x0 + x * k, y0 + y * k, k, k, col);
  }
  if (opts.guides) {
    fill(cv, x0, y0 + (spec.baseline + 1) * k - 1, W * k, 1, [255, 255, 255]);
    fill(cv, x0 + spec.pivot.x * k - 1, y0 + spec.pivot.y * k - 4, 2, 8, [255, 0, 255]);
    const hb = spec.hitbox;
    fill(cv, x0 + hb.x * k, y0 + hb.y * k, hb.w * k, 1, [0, 255, 110]);
    fill(cv, x0 + hb.x * k, y0 + hb.y * k, 1, hb.h * k, [0, 255, 110]);
    fill(cv, x0 + (hb.x + hb.w) * k - 1, y0 + hb.y * k, 1, hb.h * k, [0, 255, 110]);
  }
}

// Contact sheet: all 43 frames, 4x, one row per animation.
{
  const k = 4, cw = W * k + 10, ch = H * k + 26, left = 150;
  const cv = canvas(left + cols * cw + 10, 30 + spec.animations.length * ch, [22, 19, 38]);
  text(cv, 'EMBER  43 FRAMES  32X40', 10, 8, 3, [255, 200, 120]);
  spec.animations.forEach((a, row) => {
    const y0 = 30 + row * ch;
    text(cv, a.tag, 10, y0 + 60, 2, [230, 220, 255]);
    text(cv, `${a.frames}F ${a.fps}FPS`, 10, y0 + 80, 2, [160, 150, 190]);
    ANIMS[a.tag].forEach((F, i) => {
      blit(cv, F, left + i * cw, y0 + 14, k, { checker: true, guides: true });
      text(cv, String(i + 1), left + i * cw, y0 + 2, 2, [160, 150, 190]);
    });
  });
  fs.writeFileSync(path.join(OUT, 'contact_sheet.png'), encodePNG(cv.w, cv.h, cv.c));
}

// Per-animation previews: a static strip (6x, guides) and an animated APNG (6x) at the real timing.
for (const a of spec.animations) {
  const k = 6, frames = ANIMS[a.tag];
  const strip = canvas(frames.length * (W * k + 8) + 8, H * k + 16, [22, 19, 38]);
  frames.forEach((F, i) => blit(strip, F, 8 + i * (W * k + 8), 8, k, { checker: true, guides: true }));
  fs.writeFileSync(path.join(OUT, 'previews', `${a.tag}.png`), encodePNG(strip.w, strip.h, strip.c));
  const anim = frames.map((F) => { const cv = canvas(W * k, H * k, [22, 19, 38]); blit(cv, F, 0, 0, k); fill(cv, 0, (spec.baseline + 1) * k, W * k, 1, [90, 80, 120]); return cv.c; });
  const delays = frames.map(() => 1000 / a.fps);
  if (!a.loop) delays[delays.length - 1] += 500; // hold one-shots so they read in a looping preview
  fs.writeFileSync(path.join(OUT, 'previews', `${a.tag}.apng.png`), encodeAPNG(W * k, H * k, anim, delays));
}

fs.writeFileSync(path.join(OUT, 'frame_checks.json'), JSON.stringify(report, null, 1) + '\n');
console.log(`atlas ${AW}x${AH}, ${jsonFrames.length} frames, ${frameTags.length} tags`);
console.log(report.defects.length ? `defects:\n  ${report.defects.join('\n  ')}` : 'no automated defects');
