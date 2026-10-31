// Builds the Ember production base sprite (32x40, facing right) from a
// hand-authored pixel map. Silhouette and proportions follow the reduced
// approved concept (art-src/ember/underlay.*); details are hand-placed.
// Usage: node tools/art/ember-master.mjs   -> art-src/ember/ember_master.png + palette.json
import fs from 'node:fs';
import { encodePNG } from './png.mjs';

const W = 32, H = 40;
const DX = -1; // centre the torso/feet on the pivot column (16)

export const PALETTE = {
  d: { hex: '#8e2213', role: 'deep shadow: collar, limb separation' },
  r: { hex: '#c8341b', role: 'outer flame rim / body outline' },
  o: { hex: '#ee5019', role: 'flame orange / body base' },
  a: { hex: '#fa7c1b', role: 'amber mid-flame / body light' },
  g: { hex: '#fca82a', role: 'gold inner flame / boots' },
  y: { hex: '#fcc845', role: 'yellow inner flame / core rim' },
  l: { hex: '#fde27f', role: 'light yellow: flame heart, face shading, core' },
  c: { hex: '#fdf2cf', role: 'face cream' },
  e: { hex: '#3f120b', role: 'eye outline / pupil' },
  i: { hex: '#a8321a', role: 'iris' },
  w: { hex: '#ffffff', role: 'eye sclera / highlight' },
};

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const set = (x, y, ch) => { x += DX; if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = ch; };
const seg = (y, x, s) => [...s].forEach((ch, k) => { if (ch !== '.') set(x + k, y, ch); });

// ---- 1. Flame head silhouette (row: [from, to] intervals) --------------------
const HEAD = {
  2: [[14, 14]], 3: [[13, 14]], 4: [[12, 14]], 5: [[12, 15]], 6: [[11, 15]], 7: [[11, 17]],
  8: [[11, 18], [22, 22]], 9: [[11, 19], [21, 22]], 10: [[10, 23]], 11: [[10, 24]], 12: [[9, 25]],
  13: [[8, 25]], 14: [[7, 8], [10, 26]], 15: [[7, 26]], 16: [[7, 26]], 17: [[7, 26]], 18: [[8, 26]],
  19: [[9, 26]], 20: [[9, 26]], 21: [[8, 25]], 22: [[9, 25]], 23: [[10, 25]], 24: [[11, 24]], 25: [[14, 23]],
};
// Face (cream) region inside the head.
const FACE = {
  15: [17, 23], 16: [16, 24], 17: [15, 25], 18: [15, 25], 19: [15, 25], 20: [15, 25],
  21: [15, 24], 22: [15, 24], 23: [16, 24], 24: [17, 23], 25: [17, 22],
};
const inHead = (x, y) => (HEAD[y] ?? []).some(([a, b]) => x >= a && x <= b);
const inFace = (x, y) => FACE[y] && x >= FACE[y][0] && x <= FACE[y][1];

// Flame shading by distance from the outer silhouette: red rim -> yellow heart.
const FLAME_BANDS = ['r', 'o', 'a', 'g', 'y'];
const dist = Array.from({ length: H }, () => Array(W).fill(Infinity));
const queue = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!inHead(x, y)) continue;
  const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inHead(x + dx, y + dy));
  if (edge) { dist[y][x] = 0; queue.push([x, y]); }
}
while (queue.length) {
  const [x, y] = queue.shift();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (!inHead(nx, ny) || dist[ny][nx] <= dist[y][x] + 1) continue;
    dist[ny][nx] = dist[y][x] + 1;
    queue.push([nx, ny]);
  }
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (inHead(x, y)) set(x, y, FLAME_BANDS[Math.min(dist[y][x], FLAME_BANDS.length - 1)]);
}
// Flame-strand accents so the head reads as tongues of fire, not a blob.
for (const [x, y] of [[13, 7], [12, 9], [12, 10], [11, 12], [17, 9], [18, 10], [21, 11], [9, 15], [10, 18], [10, 21]]) set(x, y, 'a');
for (const [x, y] of [[14, 6], [16, 9], [20, 12]]) set(x, y, 'g');

// ---- 2. Face -----------------------------------------------------------------
for (const [y, [a, b]] of Object.entries(FACE)) {
  for (let x = a; x <= b; x++) {
    const nearEdge = x === a || x === b || Number(y) === 25 || !inFace(x, Number(y) + 1);
    set(x, Number(y), nearEdge ? 'l' : 'c');
  }
}
// Forehead flame lock dipping into the face (as in the concept).
seg(15, 19, 'yy');
seg(16, 20, 'y');
// Soft arched brows (amber, not dark, to keep the friendly expression)
seg(16, 17, 'a.a');
seg(15, 18, 'a');
seg(16, 22, 'a.');
seg(15, 23, 'a');
// Big round eyes: dark upper lash, large catchlight, red-brown iris, dark pupil.
seg(18, 17, 'eee');
seg(19, 16, 'ewii');
seg(20, 16, 'eiei');
seg(21, 17, 'iii');
seg(18, 22, 'eee');
seg(19, 22, 'wii');
seg(20, 22, 'iei');
seg(21, 22, 'iii');
// Small smile
seg(22, 19, 'o..o');
seg(23, 20, 'rr');

// ---- 3. Body -----------------------------------------------------------------
seg(26, 15, 'rodddor');            // collar under the chin
seg(27, 13, 'raoooooooar');        // shoulders
seg(28, 12, 'rad');                // left arm
seg(28, 15, 'ooyyyoo');            // torso + top of the chest core
seg(28, 22, 'dar');                // right arm
seg(29, 11, 'rad');
seg(29, 15, 'ooyllyo');
seg(29, 22, 'dar');
seg(30, 10, 'rao');                // left hand begins
seg(30, 15, 'roylly');
seg(30, 21, 'odoar');              // right hand begins
seg(31, 9, 'ragr');
seg(31, 15, 'rooyyo');
seg(31, 22, 'ragr');
seg(32, 9, 'ragyr');
seg(32, 15, 'rooooa');
seg(32, 22, 'rygr');
seg(33, 9, 'raygr');
seg(33, 15, 'rooooa');
seg(33, 23, 'rr');
seg(34, 10, 'rgr');
seg(34, 15, 'oa..ao');            // legs split
seg(35, 15, 'oa..ao');
seg(36, 15, 'ra..ar');
seg(37, 13, 'raag');               // boots
seg(37, 19, 'gaar');
seg(38, 12, 'ragya');
seg(38, 19, 'ayggr');
seg(39, 12, 'raggr');
seg(39, 19, 'rggar');

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
fs.mkdirSync('art-src/ember', { recursive: true });
fs.writeFileSync('art-src/ember/ember_master.png', encodePNG(W, H, px));
fs.writeFileSync('art-src/ember/ember_master.map.txt', grid.map((r, y) => r.join('') + '  ' + String(y).padStart(2)).join('\n') + '\n');
fs.writeFileSync('art-src/ember/palette.json', JSON.stringify(PALETTE, null, 2) + '\n');
console.log(grid.map((r, y) => r.join('') + '  ' + String(y).padStart(2)).join('\n'));
