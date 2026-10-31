// A tiny scripted controller that plays levels through the real shared
// simulation. Used by tests to prove every level is completable with the
// actual movement physics (no impossible jumps, no softlocks).

import {
  Btn, type CompiledLevel, PlayerTuning, TILE, type World, createWorld, stepWorld,
} from '../packages/shared/src/index.js';

export type Cmd =
  | { k: 'go'; col: number }
  | { k: 'run'; col: number }
  | { k: 'steer'; col: number; f: (w: World) => boolean; label?: string }
  | { k: 'jump'; dir: -1 | 0 | 1; col?: number; hold?: number }
  | { k: 'wait'; n: number }
  | { k: 'use' }
  | { k: 'until'; f: (w: World) => boolean; max?: number; label?: string }
  | { k: 'hold'; bits: number; n: number };

export const go = (col: number): Cmd => ({ k: 'go', col });
/** Keep steering toward `col` (e.g. while floating in a fan) until `f` holds. */
export const steer = (col: number, f: (w: World) => boolean, label?: string): Cmd => ({ k: 'steer', col, f, label });
/** Run toward `col` and finish the moment it is passed (keeps momentum for a jump). */
export const run = (col: number): Cmd => ({ k: 'run', col });
/** Jump, steering toward `col` while airborne (or holding `dir` when no col). */
export const jump = (dir: -1 | 0 | 1, col?: number, hold?: number): Cmd => ({ k: 'jump', dir, col, hold });
export const wait = (n: number): Cmd => ({ k: 'wait', n });
export const use = (): Cmd => ({ k: 'use' });
export const until = (f: (w: World) => boolean, label?: string, max = 60 * 30): Cmd => ({ k: 'until', f, label, max });
export const hold = (bits: number, n: number): Cmd => ({ k: 'hold', bits, n });

export interface Phase {
  e?: Cmd[];
  t?: Cmd[];
}

interface CmdState {
  t: number;
  phase: number;
  airborne: boolean;
}

export interface RunResult {
  complete: boolean;
  ticks: number;
  deaths: number;
  failure?: string;
  world: World;
}

function center(w: World, i: number): number {
  return w.players[i].x + PlayerTuning.bodyW / 2;
}

export function runScript(level: CompiledLevel, phases: Phase[], opts: { maxTicks?: number; allowDeaths?: boolean; trace?: boolean } = {}): RunResult {
  const w = createWorld(level);
  const maxTicks = opts.maxTicks ?? 60 * 400;
  let failure: string | undefined;
  for (let pi = 0; pi < phases.length && !failure; pi++) {
    const queues: Cmd[][] = [[...(phases[pi].e ?? [])], [...(phases[pi].t ?? [])]];
    const states: CmdState[] = [{ t: 0, phase: 0, airborne: false }, { t: 0, phase: 0, airborne: false }];
    while ((queues[0].length || queues[1].length) && !failure) {
      if (w.tick > maxTicks) { failure = `timeout in phase ${pi}`; break; }
      const bits = [0, 0];
      for (let i = 0; i < 2; i++) {
        const q = queues[i];
        if (!q.length) continue;
        const cmd = q[0];
        const st = states[i];
        const p = w.players[i];
        let done = false;
        switch (cmd.k) {
          case 'go': {
            const dx = cmd.col * TILE + TILE / 2 - center(w, i);
            if (Math.abs(dx) > 5) bits[i] = dx > 0 ? Btn.Right : Btn.Left;
            else if (Math.abs(p.vx) < 1 && p.grounded) done = true;
            if (st.t > 60 * 20) failure = `player ${i} could not reach col ${cmd.col} (phase ${pi}, x=${center(w, i).toFixed(1)})`;
            break;
          }
          case 'steer': {
            const dx = cmd.col * TILE + TILE / 2 - center(w, i);
            if (Math.abs(dx) > 3) bits[i] = dx > 0 ? Btn.Right : Btn.Left;
            if (cmd.f(w)) done = true;
            else if (st.t > 60 * 20) failure = `steer '${cmd.label ?? '?'}' timed out (phase ${pi}, player ${i})`;
            break;
          }
          case 'run': {
            const dx = cmd.col * TILE + TILE / 2 - center(w, i);
            const dir = st.phase === 0 ? (st.phase = dx > 0 ? 1 : -1) : st.phase;
            if (dx * dir <= 0) done = true;
            else bits[i] = dir > 0 ? Btn.Right : Btn.Left;
            if (st.t > 60 * 20) failure = `player ${i} could not run to col ${cmd.col} (phase ${pi})`;
            break;
          }
          case 'jump': {
            let dir = cmd.dir;
            if (cmd.col !== undefined && st.t > 0) {
              const dx = cmd.col * TILE + TILE / 2 - center(w, i);
              dir = Math.abs(dx) > 4 ? (dx > 0 ? 1 : -1) : 0;
            }
            const dirBits = dir > 0 ? Btn.Right : dir < 0 ? Btn.Left : 0;
            if (st.t === 0) {
              if (!p.grounded) {
                if (st.phase++ > 30) failure = `player ${i} not grounded at jump start (phase ${pi})`;
                break;
              }
              bits[i] = Btn.JumpPressed | Btn.JumpHeld | dirBits;
            } else {
              const held = cmd.hold === undefined || st.t < cmd.hold ? Btn.JumpHeld : 0;
              bits[i] = held | dirBits;
              if (!p.grounded) st.airborne = true;
              if (st.airborne && p.grounded) {
                if (cmd.col === undefined) done = true;
                else {
                  const dx = cmd.col * TILE + TILE / 2 - center(w, i);
                  if (Math.abs(dx) <= 6) done = true;
                  else bits[i] = dx > 0 ? Btn.Right : Btn.Left;
                  if (Math.abs(dx) <= 6 && Math.abs(p.vx) > 1) done = false;
                }
              }
            }
            if (st.t > 60 * 6) failure = `player ${i} jump never landed (phase ${pi})`;
            break;
          }
          case 'wait':
            if (st.t >= cmd.n) done = true;
            break;
          case 'use':
            bits[i] = Btn.InteractPressed;
            done = true;
            break;
          case 'hold':
            bits[i] = cmd.bits;
            if (st.t + 1 >= cmd.n) done = true;
            break;
          case 'until':
            if (cmd.f(w)) done = true;
            else if (st.t > (cmd.max ?? 1800)) failure = `until '${cmd.label ?? '?'}' timed out (phase ${pi}, player ${i})`;
            break;
        }
        if (!(cmd.k === 'jump' && st.t === 0 && !p.grounded)) st.t++;
        if (done) {
          q.shift();
          states[i] = { t: 0, phase: 0, airborne: false };
        }
      }
      const deathsBefore = w.players[0].deaths + w.players[1].deaths;
      stepWorld(level, w, bits);
      if (opts.trace) {
        const p = w.players[0];
        const q = w.players[1];
        if (w.tick % 5 === 0) console.log(w.tick, 'ph', pi, 'E', bits[0], ((p.x + 10) / 32).toFixed(2), ((p.y + 28) / 32).toFixed(2), p.grounded ? 'G' : 'a', 'T', bits[1], ((q.x + 10) / 32).toFixed(2), ((q.y + 28) / 32).toFixed(2), q.grounded ? 'G' : 'a', q.dead);
      }
      const deathsAfter = w.players[0].deaths + w.players[1].deaths;
      if (deathsAfter > deathsBefore && !opts.allowDeaths) {
        const who = w.players[0].dead ? 'Ember' : 'Tide';
        failure = `${who} died in phase ${pi} at tick ${w.tick} (x=${(w.players[who === 'Ember' ? 0 : 1].x / TILE).toFixed(2)} tiles)`;
      }
      if (w.complete) break;
    }
    if (w.complete) break;
  }
  // Let the exit hold timer finish if both are standing in it.
  for (let i = 0; i < 120 && !w.complete && !failure; i++) stepWorld(level, w, [0, 0]);
  return { complete: w.complete, ticks: w.tick, deaths: w.players[0].deaths + w.players[1].deaths, failure, world: w };
}
