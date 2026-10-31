// Canvas painters for static level art: terrain (one texture per level) and
// tileable parallax backgrounds (one per world).

import { type CompiledLevel, TILE, Tile, isBlockingTile, tileAt } from '@duality/shared';
import type { Palette } from './textures';
import { roundRect } from './textures';

function hash(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const LIQUID: Record<number, [string, string, string]> = {
  [Tile.Lava]: ['#ffcf5a', '#ff7a1f', '#b8300f'],
  [Tile.Water]: ['#8fe6ff', '#2aa2ee', '#0d4f9c'],
  [Tile.Toxic]: ['#c6ff6b', '#58c43c', '#1f6e2a'],
};

export function paintTerrain(level: CompiledLevel, pal: Palette, scale: number): HTMLCanvasElement {
  const W = level.widthPx, H = level.heightPx;
  const c = document.createElement('canvas');
  c.width = Math.ceil(W * scale);
  c.height = Math.ceil(H * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);

  const solid = (cc: number, rr: number) => isBlockingTile(tileAt(level, cc, rr));
  const rockish = (cc: number, rr: number) => tileAt(level, cc, rr) === Tile.Solid;

  // Distance-to-air field gives the rock mass depth shading.
  const depth = new Uint8Array(level.cols * level.rows).fill(255);
  const q: number[] = [];
  for (let r = 0; r < level.rows; r++) {
    for (let cc = 0; cc < level.cols; cc++) {
      if (!solid(cc, r)) { depth[r * level.cols + cc] = 0; q.push(r * level.cols + cc); }
    }
  }
  while (q.length) {
    const i = q.shift()!;
    const r = Math.floor(i / level.cols), cc = i % level.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = cc + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= level.cols || nr >= level.rows) continue;
      const ni = nr * level.cols + nc;
      if (depth[ni] > depth[i] + 1) { depth[ni] = depth[i] + 1; q.push(ni); }
    }
  }

  for (let r = 0; r < level.rows; r++) {
    for (let cc = 0; cc < level.cols; cc++) {
      const t = tileAt(level, cc, r);
      const x = cc * TILE, y = r * TILE;
      if (t === Tile.Solid) {
        const d = depth[r * level.cols + cc];
        const up = !solid(cc, r - 1), down = !solid(cc, r + 1), left = !solid(cc - 1, r), right = !solid(cc + 1, r);
        const rad = 7;
        g.fillStyle = d <= 1 ? pal.rock : d === 2 ? mix(pal.rock, pal.rockDark, 0.5) : pal.rockDark;
        cornerRect(g, x, y, TILE, TILE, up && left ? rad : 0, up && right ? rad : 0, down && right ? rad : 0, down && left ? rad : 0);
        g.fill();
        // Texture speckles
        for (let k = 0; k < 3; k++) {
          const hx = hash(cc, r, k), hy = hash(r, cc, k + 7);
          g.fillStyle = k === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
          g.fillRect(x + 3 + hx * 24, y + 4 + hy * 22, 2 + hash(cc, r, k + 3) * 4, 2);
        }
        if (up) {
          // Lit rim along walkable top edges
          const lg = g.createLinearGradient(0, y, 0, y + 12);
          lg.addColorStop(0, pal.rimGlow);
          lg.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = lg;
          g.fillRect(x, y, TILE, 12);
          g.fillStyle = pal.rim;
          cornerRect(g, x + (left ? 2 : 0), y, TILE - (left ? 2 : 0) - (right ? 2 : 0), 3, left ? 2 : 0, right ? 2 : 0, 0, 0);
          g.fill();
          if (hash(cc, r, 11) > 0.72) {
            g.fillStyle = pal.accent;
            const px = x + 6 + hash(cc, r, 12) * 18;
            g.beginPath(); g.moveTo(px, y); g.lineTo(px + 3, y - 6 - hash(cc, r, 13) * 5); g.lineTo(px + 6, y); g.closePath(); g.fill();
          }
        }
        if (left) { g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, y + (up ? 3 : 0), 2, TILE - (up ? 3 : 0)); }
        if (right) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + TILE - 2, y + (up ? 3 : 0), 2, TILE - (up ? 3 : 0)); }
        if (down) {
          g.fillStyle = 'rgba(0,0,0,0.3)';
          g.fillRect(x, y + TILE - 3, TILE, 3);
          if (hash(cc, r, 21) > 0.7 && rockish(cc, r)) {
            g.fillStyle = mix(pal.rock, pal.rockDark, 0.3);
            const px = x + 8 + hash(cc, r, 22) * 14;
            const len = 6 + hash(cc, r, 23) * 8;
            g.beginPath(); g.moveTo(px, y + TILE); g.lineTo(px + 3, y + TILE + len); g.lineTo(px + 6, y + TILE); g.closePath(); g.fill();
          }
        }
      } else if (t === Tile.Lava || t === Tile.Water || t === Tile.Toxic) {
        const [a, b, d] = LIQUID[t];
        g.fillStyle = pal.rockDark;
        g.fillRect(x, y, TILE, TILE);
        const lg = g.createLinearGradient(0, y, 0, y + TILE);
        lg.addColorStop(0, a);
        lg.addColorStop(0.35, b);
        lg.addColorStop(1, d);
        g.fillStyle = lg;
        g.fillRect(x, y + 2, TILE, TILE - 2);
        // Bubbles / sparkle
        for (let k = 0; k < 3; k++) {
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.beginPath();
          g.arc(x + 4 + hash(cc, r, k) * 24, y + 10 + hash(r, cc, k) * 18, 1 + hash(cc, r, k + 5) * 2, 0, Math.PI * 2);
          g.fill();
        }
        // Pool walls where it meets rock
        if (solid(cc - 1, r) && !isLiquid(tileAt(level, cc - 1, r))) { g.fillStyle = pal.rock; g.fillRect(x, y, 3, TILE); }
        if (solid(cc + 1, r) && !isLiquid(tileAt(level, cc + 1, r))) { g.fillStyle = pal.rock; g.fillRect(x + TILE - 3, y, 3, TILE); }
      } else if (t === Tile.OneWay) {
        const lt = tileAt(level, cc - 1, r) === Tile.OneWay, rt = tileAt(level, cc + 1, r) === Tile.OneWay;
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x, y + 9, TILE, 3);
        g.fillStyle = mix(pal.rockLight, pal.rim, 0.25);
        cornerRect(g, x + (lt ? 0 : 1), y, TILE - (lt ? 0 : 1) - (rt ? 0 : 1), 9, lt ? 0 : 3, rt ? 0 : 3, rt ? 0 : 3, lt ? 0 : 3);
        g.fill();
        g.fillStyle = pal.rim;
        g.fillRect(x + (lt ? 0 : 3), y, TILE - (lt ? 0 : 3) - (rt ? 0 : 3), 2);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 8; k < TILE; k += 12) g.fillRect(x + k, y + 3, 1, 5);
        if (!lt) { g.fillStyle = pal.rockDark; g.fillRect(x + 3, y + 9, 3, 7); }
        if (!rt) { g.fillStyle = pal.rockDark; g.fillRect(x + TILE - 6, y + 9, 3, 7); }
      } else if (t === Tile.Spikes) {
        for (let k = 0; k < 4; k++) {
          const sx = x + k * 8;
          const sg = g.createLinearGradient(sx, 0, sx + 8, 0);
          sg.addColorStop(0, '#eef2f7');
          sg.addColorStop(1, '#7a8494');
          g.fillStyle = sg;
          g.beginPath();
          g.moveTo(sx, y + TILE);
          g.lineTo(sx + 4, y + TILE - 15);
          g.lineTo(sx + 8, y + TILE);
          g.closePath();
          g.fill();
        }
        g.fillStyle = 'rgba(255,107,129,0.5)';
        g.fillRect(x, y + TILE - 2, TILE, 2);
      }
    }
  }
  return c;
}

function isLiquid(t: number): boolean {
  return t === Tile.Lava || t === Tile.Water || t === Tile.Toxic;
}

function cornerRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tl: number, tr: number, br: number, bl: number): void {
  g.beginPath();
  g.moveTo(x + tl, y);
  g.lineTo(x + w - tr, y);
  if (tr) g.arcTo(x + w, y, x + w, y + tr, tr); else g.lineTo(x + w, y);
  g.lineTo(x + w, y + h - br);
  if (br) g.arcTo(x + w, y + h, x + w - br, y + h, br); else g.lineTo(x + w, y + h);
  g.lineTo(x + bl, y + h);
  if (bl) g.arcTo(x, y + h, x, y + h - bl, bl); else g.lineTo(x, y + h);
  g.lineTo(x, y + tl);
  if (tl) g.arcTo(x, y, x + tl, y, tl); else g.lineTo(x, y);
  g.closePath();
}

export function mix(a: string, b: string, t: number): string {
  const pa = parse(a), pb = parse(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const gg = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${gg},${bl})`;
}

function parse(c: string): [number, number, number] {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Sky gradient (non-repeating, stretched to the view). */
export function paintSky(pal: Palette): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const lg = g.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0, pal.skyTop);
  lg.addColorStop(1, pal.skyBot);
  g.fillStyle = lg;
  g.fillRect(0, 0, 4, 256);
  return c;
}

/** Horizontally tileable parallax silhouette layer. */
export function paintParallax(pal: Palette, world: number, layer: 0 | 1): HTMLCanvasElement {
  const W = 1024, H = 576;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const col = layer === 0 ? pal.far : pal.mid;
  g.fillStyle = col;
  const s = layer + world * 10;
  const tile = (fn: (ox: number) => void) => { fn(0); fn(W); fn(-W); };
  switch (world) {
    case 1: // caverns: stalactites & stalagmites
      tile((ox) => {
        for (let i = 0; i < 14; i++) {
          const x = ox + hash(i, s) * W, w = 40 + hash(i, s, 1) * 90, h = 80 + hash(i, s, 2) * (layer ? 160 : 220);
          g.beginPath(); g.moveTo(x - w / 2, 0); g.lineTo(x, h); g.lineTo(x + w / 2, 0); g.fill();
          const h2 = 60 + hash(i, s, 3) * (layer ? 140 : 200);
          const x2 = ox + hash(i, s, 4) * W;
          g.beginPath(); g.moveTo(x2 - w / 2, H); g.lineTo(x2, H - h2); g.lineTo(x2 + w / 2, H); g.fill();
        }
      });
      for (let i = 0; i < 26; i++) {
        g.fillStyle = layer ? 'rgba(63,208,201,0.35)' : 'rgba(255,170,90,0.25)';
        g.beginPath(); g.arc(hash(i, s, 5) * W, hash(i, s, 6) * H, 1 + hash(i, s, 7) * 2.5, 0, Math.PI * 2); g.fill();
      }
      break;
    case 2: // machineworks: gears and pipes
      tile((ox) => {
        for (let i = 0; i < 6; i++) {
          const cx = ox + hash(i, s) * W, cy = hash(i, s, 1) * H, r = 50 + hash(i, s, 2) * (layer ? 70 : 110);
          gear(g, cx, cy, r, 10 + Math.floor(hash(i, s, 3) * 8), col);
        }
        g.fillStyle = col;
        for (let i = 0; i < 4; i++) {
          const y = hash(i, s, 9) * H;
          g.fillRect(ox, y, W, 10 + layer * 6);
        }
      });
      break;
    case 3: // temple: arches and columns
      tile((ox) => {
        const n = layer ? 5 : 7;
        for (let i = 0; i < n; i++) {
          const x = ox + (i / n) * W + 20, w = W / n - 40, top = 120 + hash(i, s) * 80;
          g.fillRect(x, top, 26, H - top);
          g.fillRect(x + w - 26, top, 26, H - top);
          g.beginPath(); g.arc(x + w / 2, top, w / 2, Math.PI, 0); g.lineTo(x + w - 26, top); g.arc(x + w / 2, top, w / 2 - 26, 0, Math.PI, true); g.closePath(); g.fill();
        }
      });
      g.fillStyle = layer ? 'rgba(255,230,170,0.08)' : 'rgba(199,155,255,0.08)';
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(hash(i, s, 4) * W, 90 + hash(i, s, 5) * 120, 40 + hash(i, s, 6) * 40, 0, Math.PI * 2); g.fill(); }
      break;
    default: // sky vault: clouds and floating isles
      tile((ox) => {
        for (let i = 0; i < 9; i++) {
          const cx = ox + hash(i, s) * W, cy = 120 + hash(i, s, 1) * (H - 200), r = 30 + hash(i, s, 2) * 40;
          g.fillStyle = layer ? 'rgba(220,240,255,0.10)' : 'rgba(220,240,255,0.06)';
          for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(cx + (k - 2) * r * 0.8, cy + Math.sin(k) * 8, r, r * 0.6, 0, 0, Math.PI * 2); g.fill(); }
        }
        g.fillStyle = col;
        for (let i = 0; i < 4; i++) {
          const cx = ox + hash(i, s, 7) * W, cy = 200 + hash(i, s, 8) * 260, w = 80 + hash(i, s, 9) * 120;
          g.beginPath(); g.moveTo(cx - w / 2, cy); g.lineTo(cx + w / 2, cy); g.lineTo(cx + w * 0.15, cy + w * 0.5); g.lineTo(cx - w * 0.2, cy + w * 0.35); g.closePath(); g.fill();
        }
      });
  }
  return c;
}

function gear(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, teeth: number, col: string): void {
  g.fillStyle = col;
  g.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r : r * 1.14;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(cx, cy, r * 0.35, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
}

export { roundRect };
