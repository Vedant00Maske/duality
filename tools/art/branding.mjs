// Branding pixel art built from the approved character masters:
//   apps/web/public/favicon.png          96x96  (48x48 art at 2x): Ember + Tide heads joined by the Link
//   apps/web/public/apple-touch-icon.png 180x180 (48x48 art at 3x on a dark tile)
//   art-src/ui/icon_x8.png               enlarged preview
// Usage: node tools/art/branding.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './png.mjs';
import { Raster, hex } from './raster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (p) => { const { width, height, rgba } = decodePNG(fs.readFileSync(path.join(root, p))); const r = new Raster(width, height); r.data.set(rgba); return r; };
const ember = load('art-src/ember/ember_master.png');
const tide = load('art-src/tide/tide_master.png');

const icon = new Raster(48, 48);
const bg = hex('#151126'), rim = hex('#2a2340');
for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
  const cx = Math.min(x, 47 - x), cy = Math.min(y, 47 - y);
  if (cx + cy < 5 && !(cx >= 2 && cy >= 2 && cx + cy >= 4)) continue; // rounded corners
  icon.set(x, y, cx === 0 || cy === 0 || cx + cy === 5 ? rim : bg);
}
// Head + shoulders (rows 0..25, columns 4..27) of each master, side by side.
icon.blit(ember, 0, 7, 4, 0, 24, 31);
icon.blit(tide, 24, 7, 4, 0, 24, 31);
for (let x = 21; x < 27; x++) { icon.set(x, 27, hex('#c79bff')); icon.set(x, 28, x % 2 ? hex('#f2e6ff') : hex('#c79bff')); }

function scaled(src, k, size, fill) {
  const out = new Raster(size, size);
  const off = Math.floor((size - src.w * k) / 2);
  if (fill) out.rect(0, 0, size, size, fill);
  for (let y = 0; y < src.h * k; y++) for (let x = 0; x < src.w * k; x++) { const c = src.get(Math.floor(x / k), Math.floor(y / k)); if (c) out.set(off + x, off + y, c); }
  return out;
}
fs.writeFileSync(path.join(root, 'apps/web/public/favicon.png'), scaled(icon, 2, 96).png());
fs.writeFileSync(path.join(root, 'apps/web/public/apple-touch-icon.png'), scaled(icon, 3, 180, bg).png());
fs.mkdirSync(path.join(root, 'art-src/ui'), { recursive: true });
fs.writeFileSync(path.join(root, 'art-src/ui/icon_x8.png'), scaled(icon, 8, 384).png());
console.log('favicon.png 96x96, apple-touch-icon.png 180x180');
