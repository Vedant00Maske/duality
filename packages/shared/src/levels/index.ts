import { type CompiledLevel, compileLevel } from './compile.js';
import type { LevelDef } from './types.js';
import { WORLD1 } from './data/world1.js';
import { WORLD2 } from './data/world2.js';
import { WORLD3 } from './data/world3.js';
import { WORLD4 } from './data/world4.js';

export const LEVELS: readonly LevelDef[] = [...WORLD1, ...WORLD2, ...WORLD3, ...WORLD4];

const cache = new Map<string, CompiledLevel>();

export function getLevel(id: string): CompiledLevel | null {
  let c = cache.get(id);
  if (c) return c;
  const def = LEVELS.find((l) => l.levelId === id);
  if (!def) return null;
  c = compileLevel(def);
  cache.set(id, c);
  return c;
}

export function nextLevelId(id: string): string | null {
  const i = LEVELS.findIndex((l) => l.levelId === id);
  return i >= 0 && i + 1 < LEVELS.length ? LEVELS[i + 1].levelId : null;
}

export function levelNumber(id: string): number {
  return LEVELS.findIndex((l) => l.levelId === id) + 1;
}
