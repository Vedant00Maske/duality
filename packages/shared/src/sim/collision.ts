import { TILE } from '../config.js';
import { type CompiledLevel, Tile, isBlockingTile, tileAt } from '../levels/compile.js';

export const EPS = 1e-6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A dynamic solid gathered for the current step. */
export interface DynSolid extends Rect {
  /** Object index, or -(playerIndex + 10) for player bodies. */
  obj: number;
  oneWay: boolean;
  /** Gate: the element allowed through (-1 = blocks everyone). */
  passEl: number;
  isCrate: boolean;
  isPlayer: boolean;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}

export function overlapsXYWH(a: Rect, x: number, y: number, w: number, h: number): boolean {
  return a.x < x + w && a.x + a.w > x && a.y < y + h && a.y + a.h > y;
}

export type SolidFilter = (s: DynSolid) => boolean;

export interface SweepResult {
  /** Allowed displacement. */
  d: number;
  /** Index into the solids array of the blocker, -1 for terrain, -2 for none. */
  hit: number;
}

const res: SweepResult = { d: 0, hit: -2 };

/** Sweep a rect horizontally against terrain and dynamic solids. Result object is reused. */
export function sweepX(level: CompiledLevel, r: Rect, dx: number, solids: DynSolid[], filter: SolidFilter): SweepResult {
  res.d = dx;
  res.hit = -2;
  if (dx === 0) return res;
  const r0 = Math.floor((r.y + EPS) / TILE);
  const r1 = Math.floor((r.y + r.h - EPS) / TILE);
  if (dx > 0) {
    const front = r.x + r.w;
    const target = front + dx;
    const c0 = Math.floor((front - EPS) / TILE) + 1;
    const c1 = Math.floor((target - EPS) / TILE);
    outer: for (let c = c0; c <= c1; c++) {
      for (let row = r0; row <= r1; row++) {
        if (isBlockingTile(tileAt(level, c, row))) {
          res.d = Math.max(0, c * TILE - front);
          res.hit = -1;
          break outer;
        }
      }
    }
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (s.oneWay || !filter(s)) continue;
      if (s.y < r.y + r.h - EPS && s.y + s.h > r.y + EPS && s.x >= front - EPS && s.x < front + res.d) {
        res.d = Math.max(0, s.x - front);
        res.hit = i;
      }
    }
  } else {
    const front = r.x;
    const target = front + dx;
    const c0 = Math.floor((front + EPS) / TILE) - 1;
    const c1 = Math.floor((target + EPS) / TILE);
    outer: for (let c = c0; c >= c1; c--) {
      for (let row = r0; row <= r1; row++) {
        if (isBlockingTile(tileAt(level, c, row))) {
          res.d = Math.min(0, (c + 1) * TILE - front);
          res.hit = -1;
          break outer;
        }
      }
    }
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (s.oneWay || !filter(s)) continue;
      const edge = s.x + s.w;
      if (s.y < r.y + r.h - EPS && s.y + s.h > r.y + EPS && edge <= front + EPS && edge > front + res.d) {
        res.d = Math.min(0, edge - front);
        res.hit = i;
      }
    }
  }
  return res;
}

/** Sweep a rect vertically. One-way surfaces block only downward motion from above. */
export function sweepY(level: CompiledLevel, r: Rect, dy: number, solids: DynSolid[], filter: SolidFilter): SweepResult {
  res.d = dy;
  res.hit = -2;
  if (dy === 0) return res;
  const c0 = Math.floor((r.x + EPS) / TILE);
  const c1 = Math.floor((r.x + r.w - EPS) / TILE);
  if (dy > 0) {
    const front = r.y + r.h;
    const target = front + dy;
    const rStart = Math.floor((front - EPS) / TILE) + 1;
    const rEnd = Math.floor((target - EPS) / TILE);
    outer: for (let row = rStart; row <= rEnd; row++) {
      for (let c = c0; c <= c1; c++) {
        const t = tileAt(level, c, row);
        if (isBlockingTile(t) || t === Tile.OneWay) {
          res.d = Math.max(0, row * TILE - front);
          res.hit = -1;
          break outer;
        }
      }
    }
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!filter(s)) continue;
      if (s.x < r.x + r.w - EPS && s.x + s.w > r.x + EPS && s.y >= front - EPS && s.y < front + res.d) {
        res.d = Math.max(0, s.y - front);
        res.hit = i;
      }
    }
  } else {
    const front = r.y;
    const target = front + dy;
    const rStart = Math.floor((front + EPS) / TILE) - 1;
    const rEnd = Math.floor((target + EPS) / TILE);
    outer: for (let row = rStart; row >= rEnd; row--) {
      for (let c = c0; c <= c1; c++) {
        if (isBlockingTile(tileAt(level, c, row))) {
          res.d = Math.min(0, (row + 1) * TILE - front);
          res.hit = -1;
          break outer;
        }
      }
    }
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (s.oneWay || !filter(s)) continue;
      const edge = s.y + s.h;
      if (s.x < r.x + r.w - EPS && s.x + s.w > r.x + EPS && edge <= front + EPS && edge > front + res.d) {
        res.d = Math.min(0, edge - front);
        res.hit = i;
      }
    }
  }
  return res;
}

/** True when the rect overlaps any blocking terrain tile. */
export function rectHitsTerrain(level: CompiledLevel, r: Rect): boolean {
  const c0 = Math.floor((r.x + EPS) / TILE);
  const c1 = Math.floor((r.x + r.w - EPS) / TILE);
  const r0 = Math.floor((r.y + EPS) / TILE);
  const r1 = Math.floor((r.y + r.h - EPS) / TILE);
  for (let row = r0; row <= r1; row++) {
    for (let c = c0; c <= c1; c++) {
      if (isBlockingTile(tileAt(level, c, row))) return true;
    }
  }
  return false;
}

/** Liang–Barsky segment vs rect intersection test. */
export function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, r: Rect, pad = 0): boolean {
  const minX = r.x - pad, maxX = r.x + r.w + pad, minY = r.y - pad, maxY = r.y + r.h + pad;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}
