import { describe, expect, it } from 'vitest';
import { LEVELS, getLevel, validateLevel } from '../../packages/shared/src/index.js';
import { runScript } from '../bot.js';
import { SOLUTIONS } from '../solutions.js';

describe('level data', () => {
  for (const def of LEVELS) {
    it(`${def.levelId} validates`, () => {
      const r = validateLevel(def);
      expect(r.errors).toEqual([]);
    });
  }
});

describe('levels are completable with the real physics', () => {
  for (const def of LEVELS) {
    it(`${def.levelId} reference solution completes without deaths`, () => {
      const sol = SOLUTIONS[def.levelId];
      expect(sol, 'missing reference solution').toBeTruthy();
      const level = getLevel(def.levelId)!;
      const r = runScript(level, sol(level));
      expect(r.failure).toBeUndefined();
      expect(r.complete).toBe(true);
      expect(r.deaths).toBe(0);
      // A first-time pair takes longer than the bot; par must leave headroom.
      expect(r.ticks / 60).toBeLessThan(def.par);
    });
  }
});
