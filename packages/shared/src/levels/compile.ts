import { PlayerTuning, TILE, CrateTuning } from '../config.js';
import type { Dir, ElementName, LevelDef, ObjectProps, ObjType } from './types.js';

export const Tile = {
  Empty: 0,
  Solid: 1,
  OneWay: 2,
  Lava: 3,
  Water: 4,
  Toxic: 5,
  Spikes: 6,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

/** Tiles that block movement on every side (pools are solid floors with a lethal surface). */
export function isBlockingTile(t: number): boolean {
  return t === Tile.Solid || t === Tile.Lava || t === Tile.Water || t === Tile.Toxic;
}

const TERRAIN: Record<string, Tile> = {
  '#': Tile.Solid,
  '-': Tile.OneWay,
  L: Tile.Lava,
  W: Tile.Water,
  T: Tile.Toxic,
  '^': Tile.Spikes,
  '.': Tile.Empty,
  ' ': Tile.Empty,
  '1': Tile.Empty,
  '2': Tile.Empty,
};

export function isTerrainChar(ch: string): boolean {
  return ch in TERRAIN;
}

export interface Vec {
  x: number;
  y: number;
}

export interface ObjDef {
  index: number;
  id: string;
  ch: string;
  type: ObjType;
  /** Bounds in world px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bounds in tiles. */
  col: number;
  row: number;
  cols: number;
  rows: number;
  /** Resolved signal sources (object indices). */
  sources: number[];
  mode: 'all' | 'any';
  invert: boolean;
  element?: ElementName;
  dir: Dir;
  /** Path offset in px. */
  toX: number;
  toY: number;
  /** Progress units per tick along the path (platform/saw). */
  pathStep: number;
  loop: boolean;
  timerTicks: number;
  hold: boolean;
  latch: boolean;
  style: 'door' | 'bridge';
  orient: 0 | 1;
  fixed: boolean;
  text: string;
  /** Colour group for signal wiring visuals (index into palette). */
  hue: number;
}

export interface CompiledLevel {
  def: LevelDef;
  id: string;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  tiles: Uint8Array;
  objects: ObjDef[];
  /** Body top-left spawn positions indexed by element (0 Ember, 1 Tide). */
  spawns: [Vec, Vec];
  /** Per-tile index of the beam-interacting object (mirror/prism/receiver/emitter) or -1. */
  beamGrid: Int16Array;
  byId: Map<string, number>;
  /** Index lists by type for fast iteration. */
  ofType: Record<ObjType, number[]>;
}

export class LevelCompileError extends Error {}

function cellsByChar(grid: string[]): Map<string, Array<[number, number]>> {
  const map = new Map<string, Array<[number, number]>>();
  grid.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (!map.has(ch)) map.set(ch, []);
      map.get(ch)!.push([c, r]);
    }
  });
  return map;
}

export function compileLevel(def: LevelDef): CompiledLevel {
  const grid = def.grid;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (!rows || !cols) throw new LevelCompileError(`${def.levelId}: empty grid`);
  for (let r = 0; r < rows; r++) {
    if (grid[r].length !== cols) {
      throw new LevelCompileError(`${def.levelId}: row ${r} has length ${grid[r].length}, expected ${cols}`);
    }
  }

  const tiles = new Uint8Array(cols * rows);
  const cells = cellsByChar(grid);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      tiles[r * cols + c] = ch in TERRAIN ? TERRAIN[ch] : Tile.Empty;
    }
  }

  const spawnOf = (ch: string): Vec => {
    const list = cells.get(ch);
    if (!list || list.length !== 1) {
      throw new LevelCompileError(`${def.levelId}: expected exactly one '${ch}' spawn, found ${list?.length ?? 0}`);
    }
    const [c, r] = list[0];
    return {
      x: c * TILE + (TILE - PlayerTuning.bodyW) / 2,
      y: r * TILE + TILE - PlayerTuning.bodyH,
    };
  };
  const spawns: [Vec, Vec] = [spawnOf('1'), spawnOf('2')];

  const objects: ObjDef[] = [];
  const byId = new Map<string, number>();
  const legendEntries = Object.entries(def.legend);

  for (const [ch, props] of legendEntries) {
    if (ch.length !== 1) throw new LevelCompileError(`${def.levelId}: legend key '${ch}' must be one character`);
    if (ch in TERRAIN) throw new LevelCompileError(`${def.levelId}: legend key '${ch}' collides with terrain`);
    const list = cells.get(ch);
    if (!list) throw new LevelCompileError(`${def.levelId}: legend '${ch}' not used in grid`);
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    for (const [c, r] of list) {
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    }
    const bw = maxC - minC + 1, bh = maxR - minR + 1;
    if (bw * bh !== list.length) {
      throw new LevelCompileError(`${def.levelId}: object '${ch}' cells do not form a filled rectangle`);
    }
    const id = props.id ?? ch;
    if (byId.has(id)) throw new LevelCompileError(`${def.levelId}: duplicate object id '${id}'`);
    const obj = makeObj(objects.length, id, ch, props, minC, minR, bw, bh);
    byId.set(id, obj.index);
    objects.push(obj);
  }

  // Any non-terrain character must be in the legend.
  for (const ch of cells.keys()) {
    if (!(ch in TERRAIN) && !(ch in def.legend)) {
      throw new LevelCompileError(`${def.levelId}: grid character '${ch}' is not terrain and not in legend`);
    }
  }

  // Resolve signal sources.
  for (const [ch, props] of legendEntries) {
    const obj = objects[byId.get(props.id ?? ch)!];
    obj.sources = (props.when ?? []).map((sid) => {
      const idx = byId.get(sid);
      if (idx === undefined) throw new LevelCompileError(`${def.levelId}: '${obj.id}' listens to unknown id '${sid}'`);
      return idx;
    });
  }

  // Assign wiring hues: each activator gets a hue; consistent ordering.
  let hue = 0;
  for (const o of objects) {
    if (o.type === 'plate' || o.type === 'lever' || o.type === 'node' || o.type === 'receiver' || o.type === 'crystal') {
      o.hue = hue++ % 6;
    }
  }
  for (const o of objects) {
    if (o.sources.length) o.hue = objects[o.sources[0]].hue;
  }

  const beamGrid = new Int16Array(cols * rows).fill(-1);
  for (const o of objects) {
    if (o.type === 'mirror' || o.type === 'prism' || o.type === 'receiver' || o.type === 'emitter') {
      beamGrid[o.row * cols + o.col] = o.index;
    }
  }

  const ofType = {} as Record<ObjType, number[]>;
  for (const o of objects) (ofType[o.type] ??= []).push(o.index);
  for (const t of ['door', 'plate', 'lever', 'node', 'ice', 'crate', 'platform', 'fan', 'emitter', 'mirror', 'prism', 'receiver', 'crystal', 'field', 'saw', 'checkpoint', 'exit', 'gate', 'sign'] as ObjType[]) {
    ofType[t] ??= [];
  }

  return {
    def,
    id: def.levelId,
    cols,
    rows,
    widthPx: cols * TILE,
    heightPx: rows * TILE,
    tiles,
    objects,
    spawns,
    beamGrid,
    byId,
    ofType,
  };
}

function makeObj(index: number, id: string, ch: string, p: ObjectProps, col: number, row: number, cols: number, rows: number): ObjDef {
  let x = col * TILE, y = row * TILE, w = cols * TILE, h = rows * TILE;
  if (p.type === 'crate') {
    const s = CrateTuning.size;
    x += (TILE - s) / 2;
    y += TILE - s;
    w = s;
    h = s;
  }
  if (p.type === 'platform') h = 14;
  const toX = (p.to?.[0] ?? 0) * TILE;
  const toY = (p.to?.[1] ?? 0) * TILE;
  const len = Math.hypot(toX, toY);
  const speedPx = (p.speed ?? 2) * TILE;
  return {
    index, id, ch, type: p.type, x, y, w, h, col, row, cols, rows,
    sources: [],
    mode: p.mode ?? 'all',
    invert: p.invert ?? false,
    element: p.element,
    dir: p.dir ?? 'up',
    toX, toY,
    pathStep: len > 0 ? speedPx / len / 60 : 0,
    loop: p.loop ?? false,
    timerTicks: Math.round((p.timer ?? 0) * 60),
    hold: p.hold ?? false,
    latch: p.latch ?? false,
    style: p.style ?? 'door',
    orient: p.orient ?? 0,
    fixed: p.fixed ?? false,
    text: p.text ?? '',
    hue: 0,
  };
}

export function tileAt(level: CompiledLevel, c: number, r: number): Tile {
  if (c < 0 || c >= level.cols || r < 0) return Tile.Solid;
  if (r >= level.rows) return Tile.Empty;
  return level.tiles[r * level.cols + c] as Tile;
}
