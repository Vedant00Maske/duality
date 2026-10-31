import { TILE } from '../config.js';
import { type CompiledLevel, LevelCompileError, Tile, compileLevel, isBlockingTile, tileAt } from './compile.js';
import { ACTIVATOR_TYPES, ELEMENTS, OBJ_TYPES, TARGET_TYPES, type LevelDef } from './types.js';

export interface ValidationReport {
  levelId: string;
  errors: string[];
  warnings: string[];
  level?: CompiledLevel;
}

const ONE_CELL = new Set(['lever', 'node', 'mirror', 'prism', 'receiver', 'emitter', 'sign', 'crate', 'saw']);

export function validateLevel(def: LevelDef): ValidationReport {
  const report: ValidationReport = { levelId: def.levelId, errors: [], warnings: [] };
  const err = (m: string) => report.errors.push(m);
  const warn = (m: string) => report.warnings.push(m);

  if (def.schemaVersion !== 1) err(`unsupported schemaVersion ${def.schemaVersion}`);
  if (!def.objective?.trim()) err('missing objective');
  if (!(def.par > 0)) err('par must be > 0');

  for (const [ch, p] of Object.entries(def.legend)) {
    if (!OBJ_TYPES.includes(p.type)) err(`'${ch}': unknown object type '${p.type}'`);
    if (p.element && !ELEMENTS.includes(p.element)) err(`'${ch}': invalid element '${p.element}'`);
    if (p.when && !TARGET_TYPES.includes(p.type)) err(`'${ch}': type '${p.type}' cannot listen to signals`);
    if ((p.type === 'node' || p.type === 'gate') && !p.element) err(`'${ch}': ${p.type} requires an element`);
    if (p.type === 'sign' && !p.text) err(`'${ch}': sign requires text`);
    if (p.type === 'platform' && !p.to) err(`'${ch}': platform requires a 'to' path`);
  }

  let level: CompiledLevel;
  try {
    level = compileLevel(def);
  } catch (e) {
    err(e instanceof LevelCompileError ? e.message : String(e));
    return report;
  }
  report.level = level;

  if (level.ofType.exit.length !== 1) err(`expected exactly one exit, found ${level.ofType.exit.length}`);

  for (const o of level.objects) {
    if (ONE_CELL.has(o.type) && (o.cols !== 1 || o.rows !== 1)) err(`'${o.id}': ${o.type} must occupy a single cell`);
    for (const si of o.sources) {
      const src = level.objects[si];
      if (!ACTIVATOR_TYPES.includes(src.type)) err(`'${o.id}' listens to '${src.id}' which is a ${src.type}, not an activator`);
    }
    if (o.type === 'plate') {
      for (let c = o.col; c < o.col + o.cols; c++) {
        const below = tileAt(level, c, o.row + o.rows);
        if (!isBlockingTile(below) && below !== Tile.OneWay) err(`'${o.id}': plate has no floor beneath column ${c}`);
      }
    }
    if ((o.type === 'emitter' || o.type === 'fan') && !def.legend[o.ch].dir) err(`'${o.id}': ${o.type} requires dir`);
  }

  // Activators nobody listens to.
  const used = new Set<number>();
  for (const o of level.objects) for (const s of o.sources) used.add(s);
  for (const o of level.objects) {
    if (ACTIVATOR_TYPES.includes(o.type) && !used.has(o.index)) warn(`activator '${o.id}' is not wired to anything`);
  }

  // Spawns must stand on something.
  level.spawns.forEach((s, i) => {
    const c = Math.floor((s.x + 10) / TILE);
    const r = Math.floor((s.y + 28) / TILE);
    const below = tileAt(level, c, r);
    if (!isBlockingTile(below) && below !== Tile.OneWay) err(`${i === 0 ? 'Ember' : 'Tide'} spawn is not standing on ground`);
    const here = tileAt(level, c, r - 1);
    if (isBlockingTile(here)) err(`${i === 0 ? 'Ember' : 'Tide'} spawn is inside terrain`);
  });

  // Border sanity: the top row should be solid so players cannot leave the map.
  for (let c = 0; c < level.cols; c++) {
    if (!isBlockingTile(tileAt(level, c, 0))) { warn('top row is not fully solid'); break; }
  }

  return report;
}
