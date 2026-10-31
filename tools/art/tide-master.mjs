// Builds the Tide production base sprite (32x40, facing right) from a
// hand-authored pixel map. Tide shares Ember's frame layout (torso, arm, leg,
// boot regions and eye positions) so both use one animation generator, but has
// a distinct water identity: a smooth droplet head with a curling crest and a
// specular highlight, rounded water hands and feet, and a blue/cyan palette.
// Usage: node tools/art/tide-master.mjs -> art-src/tide/tide_master.png + palette.json
import fs from 'node:fs';
import { encodePNG } from './png.mjs';

const W = 32, H = 40;

export const PALETTE = {
  d: { hex: '#0b3866', role: 'deep shadow: collar, limb separation' },
  r: { hex: '#1565b3', role: 'outer rim / body outline' },
  o: { hex: '#2492d6', role: 'water blue / body base' },
  a: { hex: '#3cc8ff', role: 'cyan (brand colour)' },
  g: { hex: '#72dcff', role: 'light cyan inner water' },
  y: { hex: '#a6f0ff', role: 'pale cyan (brand colour), core rim' },
  l: { hex: '#dcfaff', role: 'highlight, face shading, core heart' },
  c: { hex: '#effcff', role: 'face' },
  e: { hex: '#0c2340', role: 'eye outline / pupil' },
  i: { hex: '#2266a8', role: 'iris' },
  w: { hex: '#ffffff', role: 'catchlight / specular' },
};

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const set = (x, y, ch) => { if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = ch; };
const seg = (y, x, s) => [...s].forEach((ch, k) => { if (ch !== '.') set(x + k, y, ch); });

// ---- 1. Droplet head (final coordinates) -------------------------------------
const HEAD = {
  2: [[16, 16]], 3: [[16, 17]], 4: [[15, 17]], 5: [[15, 18]], 6: [[14, 18]], 7: [[13, 19]],
  8: [[9, 9], [12, 20]], 9: [[8, 9], [11, 21]], 10: [[8, 22]], 11: [[8, 23]], 12: [[8, 24]],
  13: [[7, 24]], 14: [[7, 25]], 15: [[7, 25]], 16: [[7, 25]], 17: [[7, 25]], 18: [[7, 25]],
  19: [[7, 25]], 20: [[8, 25]], 21: [[8, 25]], 22: [[8, 24]], 23: [[9, 24]], 24: [[10, 23]], 25: [[12, 21]],
};
// Face: same region and size as Ember's so expressions match in quality.
const FACE = {
  15: [16, 22], 16: [15, 23], 17: [14, 24], 18: [14, 24], 19: [14, 24], 20: [14, 24],
  21: [14, 23], 22: [14, 23], 23: [15, 23], 24: [16, 22], 25: [16, 21],
};
const inHead = (x, y) => (HEAD[y] ?? []).some(([a, b]) => x >= a && x <= b);
const inFace = (x, y) => FACE[y] && x >= FACE[y][0] && x <= FACE[y][1];

// Water shading by distance from the silhouette: dark rim -> pale inner water.
const BANDS = ['r', 'o', 'a', 'a', 'g'];
const dist = Array.from({ length: H }, () => Array(W).fill(Infinity));
const queue = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!inHead(x, y)) continue;
  if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inHead(x + dx, y + dy))) { dist[y][x] = 0; queue.push([x, y]); }
}
while (queue.length) {
  const [x, y] = queue.shift();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (!inHead(nx, ny) || dist[ny][nx] <= dist[y][x] + 1) continue;
    dist[ny][nx] = dist[y][x] + 1; queue.push([nx, ny]);
  }
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inHead(x, y)) set(x, y, BANDS[Math.min(dist[y][x], BANDS.length - 1)]);
// Curling crest on the upper left (Tide's "wave" hair) and flowing ripple lines.
for (const [x, y, ch] of [[9, 8, 'r'], [8, 9, 'r'], [9, 9, 'a'], [10, 10, 'o'], [11, 11, 'o'], [12, 12, 'o'], [10, 13, 'a'], [11, 13, 'a'],
  [19, 9, 'o'], [20, 10, 'o'], [21, 12, 'a'], [22, 13, 'a']]) set(x, y, ch);
// Specular highlight on the droplet (top-left), the key "water" read at 1x.
for (const [x, y, ch] of [[15, 5, 'l'], [14, 7, 'w'], [13, 8, 'l'], [14, 8, 'w'], [12, 10, 'l']]) set(x, y, ch);

// ---- 2. Face -----------------------------------------------------------------
for (const [ys, [a, b]] of Object.entries(FACE)) {
  const y = Number(ys);
  for (let x = a; x <= b; x++) set(x, y, x === a || x === b || y === 25 || !inFace(x, y + 1) ? 'l' : 'c');
}
// A droplet fringe dipping into the forehead
seg(15, 18, 'gg');
seg(16, 19, 'g');
// Brows (soft blue arches)
seg(16, 16, 'o.o');
seg(15, 17, 'o');
seg(16, 21, 'o.');
seg(15, 22, 'o');
// Eyes (identical layout to Ember)
seg(18, 16, 'eee');
seg(19, 15, 'ewii');
seg(20, 15, 'eiei');
seg(21, 16, 'iii');
seg(18, 21, 'eee');
seg(19, 21, 'wii');
seg(20, 21, 'iei');
seg(21, 21, 'iii');
// Curious little open smile
seg(22, 18, 'r..r');
seg(23, 19, 'rr');

// ---- 3. Body (same footprint as Ember, water details) -------------------------
seg(26, 14, 'rogggor');            // collar: a ring of water
seg(27, 12, 'raoooooooar');        // shoulders
seg(28, 11, 'rad');                // back arm
seg(28, 14, 'ooaylaoo'.slice(0, 7));
seg(28, 21, 'dar');                // front arm
seg(29, 10, 'rad');
seg(29, 14, 'oaylyao');            // droplet core
seg(29, 21, 'dar');
seg(30, 9, 'rao');
seg(30, 14, 'roylyao');
seg(30, 21, 'doar');
seg(31, 8, 'roar');                // back hand: rounded water blob
seg(31, 14, 'rooyao');
seg(31, 21, 'roar');               // front hand
seg(32, 8, 'rayar');
seg(32, 14, 'roooao');
seg(32, 21, 'ryar');
seg(33, 8, 'raaar');
seg(33, 14, 'roooao');
seg(33, 22, 'rr');
seg(34, 9, 'rrr');
seg(34, 14, 'oa..ao');             // legs
seg(35, 14, 'oa..ao');
seg(36, 14, 'ra..ar');
seg(37, 12, 'roag');               // rounded droplet feet
seg(37, 18, 'gaor');
seg(38, 11, 'raygr');
seg(38, 18, 'rygar');
seg(39, 11, 'rrrrr');
seg(39, 18, 'rrrrr');

// ---- Output ------------------------------------------------------------------
const rgb = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, [1, 3, 5].map((i) => parseInt(v.hex.slice(i, i + 2), 16))]));
const px = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ch = grid[y][x];
  if (ch === '.') continue;
  const c = rgb[ch];
  if (!c) throw new Error(`unknown palette key '${ch}' at ${x},${y}`);
  const o = (y * W + x) * 4;
  px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
}
fs.mkdirSync('art-src/tide', { recursive: true });
fs.writeFileSync('art-src/tide/tide_master.png', encodePNG(W, H, px));
fs.writeFileSync('art-src/tide/tide_master.map.txt', grid.map((r, y) => r.join('') + '  ' + String(y).padStart(2)).join('\n') + '\n');
fs.writeFileSync('art-src/tide/palette.json', JSON.stringify(PALETTE, null, 2) + '\n');
console.log(grid.map((r, y) => r.join('') + '  ' + String(y).padStart(2)).join('\n'));
