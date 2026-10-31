// Analyses an approved concept image: separates the character from the dark
// background, sparks and ground shadow, and estimates the concept's own pixel
// grid. Writes a JSON summary next to the output prefix.
// Usage: node tools/art/analyze-concept.mjs <concept.png> <outPrefix>
import fs from 'node:fs';
import { decodePNG } from './png.mjs';

const [, , src, outPrefix] = process.argv;
const img = decodePNG(fs.readFileSync(src));
const { width: W, height: H, rgba } = img;
const px = (x, y) => { const o = (y * W + x) * 4; return [rgba[o], rgba[o + 1], rgba[o + 2]]; };

// Background = median of the image border.
const border = [];
for (let x = 0; x < W; x += 7) { border.push(px(x, 0), px(x, H - 1)); }
for (let y = 0; y < H; y += 7) { border.push(px(0, y), px(W - 1, y)); }
const med = [0, 1, 2].map((c) => border.map((p) => p[c]).sort((a, b) => a - b)[border.length >> 1]);

// Foreground: clearly brighter than the background (excludes the dim ground shadow).
const fg = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const [r, g, b] = px(x, y);
  fg[y * W + x] = Math.max(r, g, b) > 110 && (r - med[0]) + (g - med[1]) > 120 ? 1 : 0;
}

// Largest 4-connected component = the character (drops floating sparks).
const label = new Int32Array(W * H).fill(-1);
let best = -1, bestSize = 0, comp = 0;
const stack = [];
for (let i = 0; i < W * H; i++) {
  if (!fg[i] || label[i] !== -1) continue;
  let size = 0;
  stack.push(i); label[i] = comp;
  while (stack.length) {
    const j = stack.pop(); size++;
    const x = j % W, y = (j / W) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (fg[k] && label[k] === -1) { label[k] = comp; stack.push(k); }
    }
  }
  if (size > bestSize) { bestSize = size; best = comp; }
  comp++;
}
let minX = W, minY = H, maxX = 0, maxY = 0;
const mask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (label[i] === best) {
  mask[i] = 1;
  const x = i % W, y = (i / W) | 0;
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}

// Estimate the concept's pixel size from colour-change spacing along rows.
const runs = new Map();
for (let y = minY; y <= maxY; y += 3) {
  let start = minX, prev = px(minX, y);
  for (let x = minX + 1; x <= maxX; x++) {
    const c = px(x, y);
    if (Math.abs(c[0] - prev[0]) + Math.abs(c[1] - prev[1]) + Math.abs(c[2] - prev[2]) > 60) {
      const len = x - start;
      if (len >= 6 && len <= 60) runs.set(len, (runs.get(len) ?? 0) + 1);
      start = x;
    }
    prev = c;
  }
}
const runHist = [...runs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

const summary = {
  size: [W, H], background: med, components: comp, characterPixels: bestSize,
  bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  aspect: +((maxX - minX + 1) / (maxY - minY + 1)).toFixed(3),
  commonColourRunLengths: runHist,
};
fs.writeFileSync(`${outPrefix}.mask.bin`, mask);
fs.writeFileSync(`${outPrefix}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
