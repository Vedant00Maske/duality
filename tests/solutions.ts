// Scripted reference solutions, one per level. Each must complete the level
// through the real simulation without anyone dying.

import type { CompiledLevel, World } from '../packages/shared/src/index.js';
import { type Phase, go, jump, run, steer, until, use, wait } from './bot.js';

type Solution = (lvl: CompiledLevel) => Phase[];

const idx = (lvl: CompiledLevel, id: string) => {
  const i = lvl.byId.get(id);
  if (i === undefined) throw new Error(`no object ${id}`);
  return i;
};
const doorOpen = (lvl: CompiledLevel, id: string) => (w: World) => w.objs[idx(lvl, id)].p >= 0.99;
const sig = (lvl: CompiledLevel, id: string) => (w: World) => w.objs[idx(lvl, id)].s === 1;
const col = (w: World, i: number) => (w.players[i].x + 10) / 32;

export const SOLUTIONS: Record<string, Solution> = {
  w1_l1_first_contact: (l) => [
    {
      e: [jump(1, 4), jump(-1, 2), jump(1, 6), go(26)],
      t: [go(26), jump(1, 27), jump(1, 30), jump(1, 32)],
    },
    { e: [until(doorOpen(l, 'D'), 'door D')], t: [until(doorOpen(l, 'D'), 'door D')] },
    { e: [go(27), jump(1, 31), go(37)], t: [go(30), go(32), go(37)] },
  ],

  w1_l2_twin_valves: (l) => [
    { e: [go(8)], t: [until(doorOpen(l, 'D')), go(14)] },
    {
      e: [until(doorOpen(l, 'D')), go(13), jump(1, 15), jump(1, 17), jump(1, 21), go(28)],
      t: [until((w) => col(w, 0) > 14.5, 'ember past door'), go(26)],
    },
    { e: [until(doorOpen(l, 'E')), go(36)], t: [until(doorOpen(l, 'F')), go(37)] },
  ],

  w1_l3_meltwater: (l) => [
    { e: [go(12)], t: [go(4), jump(1, 6), jump(1, 9), go(11)] },
    { e: [go(14)], t: [until((w) => w.objs[idx(l, 'I')].s === 2, 'ice melted'), go(21), jump(1, 23)] },
    { e: [until((w) => w.objs[idx(l, 'B')].p < 0.5, 'bridge'), go(28)], t: [go(28)] },
    { e: [jump(1, 29), jump(1, 32), go(38)], t: [go(38)] },
    { e: [until(doorOpen(l, 'E')), go(41)], t: [until(doorOpen(l, 'E')), go(42)] },
  ],

  w2_l4_counterweight: (l) => {
    const P = (w: World) => w.objs[idx(l, 'P')].p;
    return [
      { e: [go(15), jump(1, 19), go(24)], t: [go(6), run(9), jump(1, 15), go(28)] },
      { t: [until((w) => P(w) < 0.02 && w.objs[idx(l, 'a')].s === 1, 'lift down'), jump(1, 30), until((w) => P(w) > 0.98, 'lift up'), go(25.6)] },
      {
        e: [go(28), until((w) => P(w) < 0.02, 'lift down'), jump(1, 30), until((w) => P(w) > 0.98, 'lift up'), go(32)],
        t: [jump(-1, 22), go(8), use(), go(21), run(22), jump(1, 27), go(26), run(28), jump(1, 33)],
      },
      { e: [until(doorOpen(l, 'D')), go(36)], t: [until(doorOpen(l, 'D')), go(37)] },
    ];
  },

  w2_l5_long_gear: (l) => {
    const M = (w: World) => w.objs[idx(l, 'M')].p;
    const saw = (w: World) => w.objs[idx(l, 'S')];
    // Wait at col 24 until the saw is coming toward us, then hop it.
    const sawApproaching = (i: number) => (w: World) => {
      const s = saw(w);
      const gap = s.x - (w.players[i].x + 10);
      return s.s === 1 && gap > 70 && gap < 110;
    };
    return [
      { e: [jump(0), jump(-1, 1)], t: [jump(1, 8)] },
      { e: [use()], t: [until((w) => M(w) >= 0.999, 'M right'), go(21)] },
      {
        e: [use(), until((w) => M(w) <= 0.001, 'M left'), go(5), jump(1, 8)],
        t: [jump(0), jump(1, 23), until((w) => {
          const e = w.players[0];
          return e.ground === idx(l, 'M') && Math.abs(e.vx) < 1 && Math.abs(e.x + 10 - (w.objs[idx(l, 'M')].x + 48)) < 24;
        }, 'ember settled on M'), use()],
      },
      { e: [until((w) => M(w) >= 0.999, 'M right'), go(24), until(sawApproaching(0), 'saw'), jump(1, 31), go(35)] },
      { t: [go(24), until(sawApproaching(1), 'saw'), jump(1, 31), go(37)] },
      { e: [use()], t: [use()] },
      { e: [until(doorOpen(l, 'E')), go(41)], t: [until(doorOpen(l, 'E')), go(42)] },
    ];
  },

  w2_l6_resonance_test: (l) => [
    { e: [jump(1, 4)], t: [go(6), jump(1, 9)] },
    { e: [until(doorOpen(l, 'D')), go(6), jump(1, 9), go(14)], t: [until(doorOpen(l, 'D')), go(17)] },
    { e: [jump(0)], t: [until(sig(l, 'b'), 'crystal b')] },
    { e: [go(25)], t: [go(26)] },
    { e: [go(24), jump(0), jump(1, 26), jump(1, 27)], t: [go(33)] },
    { e: [until(doorOpen(l, 'E')), go(37)], t: [until(doorOpen(l, 'E')), go(38)] },
  ],

  w3_l7_first_reflection: (l) => [
    {
      e: [jump(-1, 2), jump(1, 4), jump(-1, 2), jump(1, 5), go(19), use(), go(20)],
      t: [go(30), jump(1, 31), jump(1, 33), jump(-1, 30), go(21), use(), go(31)],
    },
    { e: [until(doorOpen(l, 'D')), go(37)], t: [until(doorOpen(l, 'D')), go(38)] },
  ],

  w3_l8_split_signal: (l) => [
    { e: [go(32), jump(1, 33), jump(-1, 31), jump(1, 33), jump(-1, 31), jump(-1, 28)], t: [go(11), use()] },
    { e: [until((w) => w.objs[idx(l, 'B')].p < 0.5, 'light bridge'), go(13), use(), go(11)] },
    { e: [until(doorOpen(l, 'E')), go(37)], t: [until(doorOpen(l, 'E')), go(38)] },
  ],

  w3_l9_shadow_bridge: (l) => {
    const solid = (id: string) => (w: World) => w.objs[idx(l, id)].p < 0.5;
    const sawApproaching = (i: number) => (w: World) => {
      const s = w.objs[idx(l, 'S')];
      const gap = s.x - (w.players[i].x + 10);
      return s.s === 1 && gap > 70 && gap < 110;
    };
    return [
      { t: [go(8)], e: [until(solid('B'), 'shadow bridge'), go(24)] },
      { e: [until(sawApproaching(0), 'saw'), jump(1, 31), until(solid('G'), 'light bridge'), go(38), jump(1, 39)] },
      { t: [go(15), until(solid('B'), 'shadow bridge'), go(24), until(sawApproaching(1), 'saw'), jump(1, 31), go(33)] },
      { e: [go(41)], t: [until(solid('G'), 'light bridge'), go(42)] },
    ];
  },

  w4_l10_updraft: () => {
    const feetBelow = (i: number, y: number) => (w: World) => w.players[i].y + 28 < y;
    return [
      { e: [steer(6.5, feetBelow(0, 250), 'float'), go(14)], t: [steer(6.5, feetBelow(1, 250), 'float'), go(12)] },
      { t: [go(16), jump(1, 25)] },
      { t: [go(26)], e: [until((w) => w.objs[0] !== undefined && w.players[1].x > 800, 'tide across'), go(16), jump(1, 24)] },
      { e: [steer(30.5, feetBelow(0, 80), 'float'), go(36)], t: [wait(40), steer(30.5, feetBelow(1, 80), 'float'), go(37)] },
    ];
  },

  w4_l11_broken_circuit: (l) => {
    const fieldOff = (id: string) => (w: World) => w.objs[idx(l, id)].s === 0;
    return [
      { t: [go(5)], e: [until(fieldOff('E'), 'field off'), go(12)] },
      {
        t: [until(fieldOff('E'), 'field off'), go(17)],
        e: [until((w) => w.players[1].x > 12 * 32, 'tide past field'), go(15), jump(1, 16), jump(-1, 15)],
      },
      { e: [until((w) => w.objs[idx(l, 'B')].p < 0.5, 'bridge'), jump(1, 20), go(28), jump(1, 29)], t: [until((w) => w.objs[idx(l, 'B')].p < 0.5, 'bridge'), go(31), jump(1, 34)] },
      { e: [until(fieldOff('Z'), 'field Z off'), jump(1, 33), go(40)], t: [until(fieldOff('Z'), 'field Z off'), go(41)] },
    ];
  },

  w4_l12_convergence: (l) => {
    const feetBelow = (i: number, y: number) => (w: World) => w.players[i].y + 28 < y;
    const solid = (id: string) => (w: World) => w.objs[idx(l, id)].p < 0.5;
    return [
      { e: [go(9), jump(1, 10), go(12.5)], t: [until(solid('A'), 'bridge A'), go(11)] },
      { e: [jump(1, 16), go(19)], t: [jump(1, 16), go(21), use()] },
      { e: [until(solid('B'), 'bridge B'), go(31)], t: [until(solid('B'), 'bridge B'), go(33)] },
      { t: [steer(34.5, feetBelow(1, 110), 'float'), go(38)] },
      { e: [steer(34.5, feetBelow(0, 110), 'float'), go(42)] },
      { e: [go(46), jump(1, 47)], t: [go(49), jump(1, 52)] },
      { e: [until(doorOpen(l, 'E')), jump(1, 51), go(56)], t: [until(doorOpen(l, 'E')), go(57)] },
    ];
  },
};

// Keep helpers referenced for future levels.
export const _helpers = { sig, use, wait };
