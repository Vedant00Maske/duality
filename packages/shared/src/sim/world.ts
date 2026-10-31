import type { CompiledLevel } from '../levels/compile.js';
import { evalTarget } from './step.js';

/** Authoritative per-player simulation state. Every field here is replicated. */
export interface PlayerSim {
  /** Body top-left in world px. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  /** Rising from a jump (enables variable jump height). */
  jumping: boolean;
  coyote: number;
  jbuf: number;
  facing: number;
  /** Death animation ticks remaining; 0 when alive. */
  dead: number;
  /** Respawn point (body top-left). */
  rx: number;
  ry: number;
  /** Object index the player stands on (-1 = terrain / airborne). */
  ground: number;
  /** Held input bits from the latest applied input (used for extrapolation). */
  held: number;
  deaths: number;
}

/** Generic dynamic object state. Field meaning depends on object type. */
export interface ObjSim {
  /** Discrete state (pressed, on, orientation, direction, ...). */
  s: number;
  /** Continuous progress / timer. */
  p: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface World {
  tick: number;
  players: [PlayerSim, PlayerSim];
  objs: ObjSim[];
  exitTimer: number;
  complete: boolean;
  // ---- derived each step, never replicated ----
  sig: Uint8Array;
  /** Beam segments flattened: x1, y1, x2, y2, ... */
  beams: number[];
  linked: boolean;
  /** Players are within link range but line of sight is blocked. */
  linkBlocked: boolean;
}

export function createPlayer(x: number, y: number): PlayerSim {
  return {
    x, y, vx: 0, vy: 0, grounded: false, jumping: false, coyote: 0, jbuf: 0, facing: 1, dead: 0,
    rx: x, ry: y, ground: -1, held: 0, deaths: 0,
  };
}

export function createWorld(level: CompiledLevel): World {
  const objs: ObjSim[] = level.objects.map((o) => {
    const st: ObjSim = { s: 0, p: 0, x: o.x, y: o.y, vx: 0, vy: 0 };
    if (o.type === 'mirror') st.s = o.orient;
    if (o.type === 'saw') { st.x = o.x + o.w / 2; st.y = o.y + o.h / 2; }
    return st;
  });
  // Doors start in the state their (all-off) inputs dictate, so nothing animates on load.
  const zero = new Uint8Array(level.objects.length);
  for (const idx of level.ofType.door) {
    const open = evalTarget(level.objects[idx], zero) ? 1 : 0;
    objs[idx].p = open;
    objs[idx].s = open;
  }
  const w: World = {
    tick: 0,
    players: [createPlayer(level.spawns[0].x, level.spawns[0].y), createPlayer(level.spawns[1].x, level.spawns[1].y)],
    objs,
    exitTimer: 0,
    complete: false,
    sig: new Uint8Array(level.objects.length),
    beams: [],
    linked: false,
    linkBlocked: false,
  };
  return w;
}

export function clonePlayer(p: PlayerSim): PlayerSim {
  return { ...p };
}

export function cloneWorld(w: World): World {
  return {
    tick: w.tick,
    players: [clonePlayer(w.players[0]), clonePlayer(w.players[1])],
    objs: w.objs.map((o) => ({ ...o })),
    exitTimer: w.exitTimer,
    complete: w.complete,
    sig: w.sig.slice(),
    beams: w.beams.slice(),
    linked: w.linked,
    linkBlocked: w.linkBlocked,
  };
}
