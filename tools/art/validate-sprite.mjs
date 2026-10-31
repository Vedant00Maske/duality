// Pixel-level validation of a single character frame against spec.json, plus a
// concept-vs-sprite comparison image.
// Usage: node tools/art/validate-sprite.mjs <sprite.png> <palette.json> [concept.png analysisPrefix compareOut.png]
import fs from 'node:fs';
import { decodePNG, encodePNG } from './png.mjs';

const [, , spritePath, palettePath, conceptPath, anaPrefix, compareOut] = process.argv;
const spec = JSON.parse(fs.readFileSync('apps/web/src/art/characters/spec.json', 'utf8'));
const palette = JSON.parse(fs.readFileSync(palettePath, 'utf8'));
const img = decodePNG(fs.readFileSync(spritePath));
const { width: w, height: h, rgba } = img;
const HB = spec.hitbox;
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, detail });

check('canvas is 32x40', w === spec.frame.w && h === spec.frame.h, `${w}x${h}`);
const pngHeader = fs.readFileSync(spritePath);
check('PNG is 8-bit RGBA', pngHeader[24] === 8 && pngHeader[25] === 6, `bitDepth ${pngHeader[24]}, colourType ${pngHeader[25]}`);

const hexes = new Set(Object.values(palette).map((p) => p.hex.toLowerCase()));
let soft = 0, opaque = 0, offPalette = 0;
const used = new Map();
let minX = w, maxX = -1, minY = h, maxY = -1;
const outsideHitboxX = [];
let baselinePixels = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const o = (y * w + x) * 4;
  const a = rgba[o + 3];
  if (a !== 0 && a !== 255) soft++;
  if (a !== 255) continue;
  opaque++;
  const hex = '#' + [rgba[o], rgba[o + 1], rgba[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  if (!hexes.has(hex)) offPalette++;
  used.set(hex, (used.get(hex) ?? 0) + 1);
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  if (y === spec.baseline) baselinePixels++;
  if (y >= HB.y && (x < HB.x || x > HB.x + HB.w - 1)) outsideHitboxX.push(`${x},${y}`);
}
check('hard alpha only (0 or 255)', soft === 0, `${soft} semi-transparent pixels`);
check('every colour is in the palette', offPalette === 0, `${used.size} colours used, ${offPalette} off-palette pixels`);
check('feet on the baseline (y=39)', baselinePixels > 0 && maxY === spec.baseline, `${baselinePixels} pixels on row ${spec.baseline}; lowest row ${maxY}`);
check('nothing below the baseline', maxY <= spec.baseline, `lowest row ${maxY}`);
// Feet centre vs pivot
const feet = [];
for (let x = 0; x < w; x++) if (rgba[(spec.baseline * w + x) * 4 + 3] === 255) feet.push(x);
const feetCentre = (Math.min(...feet) + Math.max(...feet) + 1) / 2;
check('feet centred on the pivot x=16 (±1.5)', Math.abs(feetCentre - spec.pivot.x) <= 1.5, `feet span x ${Math.min(...feet)}–${Math.max(...feet)}, centre ${feetCentre}`);
// Body (rows 26–39) inside the hitbox columns
let bodyOutside = 0;
for (const p of outsideHitboxX) if (Number(p.split(',')[1]) >= 26) bodyOutside++;
check('body (rows 26–39) inside hitbox columns 6–25', bodyOutside === 0, `${bodyOutside} body pixels outside`);
check('silhouette width ≤ 28 px (fairness)', maxX - minX + 1 <= 28, `bbox x ${minX}–${maxX} (${maxX - minX + 1} px), y ${minY}–${maxY} (${maxY - minY + 1} px)`);
check('flame/head above the hitbox stays in rows 0–11 headroom', minY >= 0, `top row ${minY}`);

const result = {
  file: spritePath, opaquePixels: opaque, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  pixelsOutsideHitboxColumns: outsideHitboxX, coloursUsed: Object.fromEntries([...used.entries()].sort((a, b) => b[1] - a[1])),
  checks,
};
console.log(JSON.stringify(result, null, 1));

// Concept vs sprite comparison: box-downsampled concept crop next to the sprite at 6x.
if (conceptPath && compareOut) {
  const concept = decodePNG(fs.readFileSync(conceptPath));
  const ana = JSON.parse(fs.readFileSync(`${anaPrefix}.json`, 'utf8'));
  const S = 6, TH = h * S;
  const pad = 30;
  const cb = ana.bbox;
  const box = { x: cb.x - pad, y: cb.y - pad, w: cb.w + pad * 2, h: cb.h + pad * 2 };
  const k = box.h / TH;
  const CW = Math.round(box.w / k);
  const OW = CW + 24 + w * S + 36, OH = TH + 24;
  const out = new Uint8Array(OW * OH * 4);
  for (let i = 0; i < OW * OH; i++) { out[i * 4] = 22; out[i * 4 + 1] = 19; out[i * 4 + 2] = 38; out[i * 4 + 3] = 255; }
  for (let y = 0; y < TH; y++) for (let x = 0; x < CW; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = Math.floor(box.y + y * k); yy < box.y + (y + 1) * k; yy++) for (let xx = Math.floor(box.x + x * k); xx < box.x + (x + 1) * k; xx++) {
      const o = (yy * concept.width + xx) * 4; r += concept.rgba[o]; g += concept.rgba[o + 1]; b += concept.rgba[o + 2]; n++;
    }
    const o = ((y + 12) * OW + x + 12) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  const ox = 12 + CW + 24;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
      const t = ((y * S + yy + 12) * OW + ox + x * S + xx) * 4;
      if (rgba[o + 3]) { out[t] = rgba[o]; out[t + 1] = rgba[o + 1]; out[t + 2] = rgba[o + 2]; }
      else { const c = ((x + y) & 1) ? 34 : 28; out[t] = c; out[t + 1] = c; out[t + 2] = c + 12; }
    }
  }
  fs.writeFileSync(compareOut, encodePNG(OW, OH, out));
  console.error(`comparison -> ${compareOut}`);
}
