// Nearest-neighbour enlargement of a sprite for inspection.
// Draws a transparency checkerboard, a 1-px grid, and (optionally) the
// hitbox, baseline and pivot from spec.json. Also renders a 1:1 game-size copy.
// Usage: node tools/art/preview.mjs <in.png> <out.png> [scale=12] [--overlay]
import fs from 'node:fs';
import { decodePNG, encodePNG } from './png.mjs';

const [, , src, dst, scaleArg, flag] = process.argv;
const S = Number(scaleArg || 12);
const overlay = flag === '--overlay';
const spec = JSON.parse(fs.readFileSync('apps/web/src/art/characters/spec.json', 'utf8'));
const { width: w, height: h, rgba } = decodePNG(fs.readFileSync(src));
const PAD = 12;
// Layout: [enlarged sprite] [gap] [1x and 2x copies on a dark game-like background]
const W = w * S + PAD * 3 + w * 2 + 8, H = Math.max(h * S, h * 3 + 30) + PAD * 2;
const out = new Uint8Array(W * H * 4);
const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, [22, 19, 38]);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const o = (y * w + x) * 4;
  const a = rgba[o + 3];
  for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
    const checker = ((Math.floor(yy / (S / 2)) + Math.floor(xx / (S / 2))) & 1) ? [70, 70, 80] : [100, 100, 112];
    const c = a ? [rgba[o], rgba[o + 1], rgba[o + 2]] : checker;
    const grid = xx === 0 || yy === 0;
    put(PAD + x * S + xx, PAD + y * S + yy, grid ? c.map((v) => v * 0.8) : c);
  }
}
if (overlay) {
  const hb = spec.hitbox;
  const line = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c); };
  const L = PAD + hb.x * S, R = PAD + (hb.x + hb.w) * S, T = PAD + hb.y * S, B = PAD + (hb.y + hb.h) * S;
  const green = [0, 255, 110];
  line(L, T, R, T + 1, green); line(L, B - 1, R, B, green); line(L, T, L + 1, B, green); line(R - 1, T, R, B, green);
  const by = PAD + (spec.baseline + 1) * S;
  line(PAD, by, PAD + w * S, by + 1, [255, 255, 255]);
  const px = PAD + spec.pivot.x * S, py = PAD + spec.pivot.y * S;
  line(px - 8, py - 1, px + 8, py + 1, [255, 0, 255]); line(px - 1, py - 8, px + 1, py + 8, [255, 0, 255]);
}
// 1x and 2x game-size copies
const gx = PAD * 2 + w * S + PAD;
for (const [k, oy] of [[1, PAD], [2, PAD + h + 12]]) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (!rgba[o + 3]) continue;
    for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) put(gx + x * k + xx, oy + y * k + yy, [rgba[o], rgba[o + 1], rgba[o + 2]]);
  }
}
fs.writeFileSync(dst, encodePNG(W, H, out));
console.log(`preview ${W}x${H} -> ${dst}`);
