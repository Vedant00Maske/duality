// Tiny hard-edged raster library for pixel-art generators (no anti-aliasing).
import { encodePNG } from './png.mjs';

export const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Deterministic hash -> [0,1). */
export function hash(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/** Ordered-dither threshold in [0,1) for pixel (x,y). */
export const bayer = (x, y) => (BAYER4[y & 3][x & 3] + 0.5) / 16;

export class Raster {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  set(x, y, c, wrapX = false) {
    x = Math.floor(x); y = Math.floor(y);
    if (wrapX) x = ((x % this.w) + this.w) % this.w;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    const o = (y * this.w + x) * 4;
    this.data[o] = c[0]; this.data[o + 1] = c[1]; this.data[o + 2] = c[2]; this.data[o + 3] = 255;
  }
  clear(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[(y * this.w + x) * 4 + 3] = 0;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const o = (y * this.w + x) * 4;
    return this.data[o + 3] ? [this.data[o], this.data[o + 1], this.data[o + 2]] : null;
  }
  rect(x, y, w, h, c, wrapX = false) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, wrapX); }
  /** Scanline polygon fill (points: [[x,y],...]). */
  poly(pts, c, wrapX = false) {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) xs.push(ax + ((y + 0.5 - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, c, wrapX);
    }
  }
  circle(cx, cy, r, c, wrapX = false) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2 <= r * r) this.set(x, y, c, wrapX);
    }
  }
  line(x0, y0, x1, y1, c, wrapX = false) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c, wrapX);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  /** Copy another raster (alpha-tested) at (dx, dy). */
  blit(src, dx, dy, sx = 0, sy = 0, w = src.w, h = src.h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = src.get(sx + x, sy + y); if (c) this.set(dx + x, dy + y, c); }
  }
  png() { return encodePNG(this.w, this.h, this.data); }
}

/** Vertical gradient through palette stops with ordered dithering (classic pixel-art banding). */
export function ditherGradient(r, stops, y0 = 0, y1 = r.h, wrapX = false) {
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0 - 1);
    const f = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(f));
    const frac = f - i;
    for (let x = 0; x < r.w; x++) r.set(x, y, frac > bayer(x, y) ? stops[i + 1] : stops[i], wrapX);
  }
}
