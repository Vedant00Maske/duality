// Area-averages the masked concept character into the 32x40 sprite frame:
// feet on the baseline (y=39), torso centred on the pivot column, hard alpha.
// Then clusters the colours (k-means) and prints an ASCII map for hand cleanup.
// Usage: node tools/art/reduce-concept.mjs <concept.png> <analysisPrefix> <outPrefix>
import fs from 'node:fs';
import { decodePNG, encodePNG } from './png.mjs';

const [, , src, anaPrefix, outPrefix] = process.argv;
const spec = JSON.parse(fs.readFileSync('apps/web/src/art/characters/spec.json', 'utf8'));
const { w: FW, h: FH } = spec.frame;
const img = decodePNG(fs.readFileSync(src));
const W = img.width;
const mask = fs.readFileSync(`${anaPrefix}.mask.bin`);
const ana = JSON.parse(fs.readFileSync(`${anaPrefix}.json`, 'utf8'));
const { x: bx, y: by, w: bw, h: bh } = ana.bbox;

// Torso centre: mean x of character pixels in the leg/torso band (70–90% down).
let sx = 0, n = 0;
for (let y = by + Math.floor(bh * 0.7); y < by + Math.floor(bh * 0.9); y++) {
  for (let x = bx; x < bx + bw; x++) if (mask[y * W + x]) { sx += x; n++; }
}
const torsoX = sx / n;

const TOP_ROW = 2; // leave two rows above the flame tip
const rows = spec.baseline - TOP_ROW + 1;
const scale = bh / rows; // source px per sprite px
const originX = torsoX - spec.pivot.x * scale; // source x of sprite column 0
const originY = by + bh - (spec.baseline + 1) * scale; // so the feet land on row 39

const out = new Uint8Array(FW * FH * 4);
const cells = [];
for (let ty = 0; ty < FH; ty++) {
  for (let tx = 0; tx < FW; tx++) {
    const x0 = originX + tx * scale, y0 = originY + ty * scale;
    let cov = 0, tot = 0, r = 0, g = 0, b = 0;
    for (let y = Math.floor(y0); y < Math.floor(y0 + scale); y++) {
      for (let x = Math.floor(x0); x < Math.floor(x0 + scale); x++) {
        tot++;
        if (x < 0 || y < 0 || x >= W || y >= img.height || !mask[y * W + x]) continue;
        const o = (y * W + x) * 4;
        r += img.rgba[o]; g += img.rgba[o + 1]; b += img.rgba[o + 2]; cov++;
      }
    }
    const o = (ty * FW + tx) * 4;
    if (cov / tot >= 0.5) {
      out[o] = r / cov; out[o + 1] = g / cov; out[o + 2] = b / cov; out[o + 3] = 255;
      cells.push([tx, ty, out[o], out[o + 1], out[o + 2]]);
    }
  }
}

// k-means palette (deterministic init spread across luminance)
const K = 11;
const lum = (c) => 0.299 * c[2] + 0.587 * c[3] + 0.114 * c[4];
const sorted = [...cells].sort((p, q) => lum(p) - lum(q));
let cent = Array.from({ length: K }, (_, k) => sorted[Math.floor(((k + 0.5) / K) * sorted.length)].slice(2));
const assign = new Array(cells.length).fill(0);
for (let it = 0; it < 30; it++) {
  cells.forEach((c, i) => {
    let bi = 0, bd = Infinity;
    cent.forEach((m, k) => { const d = (c[2] - m[0]) ** 2 + (c[3] - m[1]) ** 2 + (c[4] - m[2]) ** 2; if (d < bd) { bd = d; bi = k; } });
    assign[i] = bi;
  });
  cent = cent.map((m, k) => {
    const mem = cells.filter((_, i) => assign[i] === k);
    if (!mem.length) return m;
    return [0, 1, 2].map((ch) => Math.round(mem.reduce((s, c) => s + c[2 + ch], 0) / mem.length));
  });
}
const order = cent.map((m, k) => [k, 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]]).sort((p, q) => p[1] - q[1]).map((p) => p[0]);
const letters = '0123456789A';
const letterOf = new Map(order.map((k, i) => [k, letters[i]]));
const grid = Array.from({ length: FH }, () => Array(FW).fill('.'));
cells.forEach((c, i) => { grid[c[1]][c[0]] = letterOf.get(assign[i]); });
const palette = order.map((k, i) => ({ id: letters[i], hex: '#' + cent[k].map((v) => v.toString(16).padStart(2, '0')).join('') }));

// Quantised underlay PNG
const q = new Uint8Array(FW * FH * 4);
cells.forEach((c, i) => { const m = cent[assign[i]]; const o = (c[1] * FW + c[0]) * 4; q[o] = m[0]; q[o + 1] = m[1]; q[o + 2] = m[2]; q[o + 3] = 255; });
fs.writeFileSync(`${outPrefix}.reduced.png`, encodePNG(FW, FH, out));
fs.writeFileSync(`${outPrefix}.quantized.png`, encodePNG(FW, FH, q));
fs.writeFileSync(`${outPrefix}.ascii.txt`, grid.map((r, y) => r.join('') + '  ' + y).join('\n') + '\n');
console.log(JSON.stringify({ torsoX: +torsoX.toFixed(1), scale: +scale.toFixed(2), palette }));
console.log(grid.map((r, y) => r.join('') + '  ' + String(y).padStart(2)).join('\n'));
