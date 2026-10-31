// Deterministic fixed-step simulation shared by the authoritative server and the
// predicting client. Pure TypeScript: no Phaser, no Colyseus, no randomness.

import { CrateTuning, DT, PlayerTuning, TILE, WorldTuning } from '../config.js';
import { type CompiledLevel, type ObjDef, Tile, isBlockingTile, tileAt } from '../levels/compile.js';
import { Btn } from '../protocol.js';
import {
  type DynSolid, type Rect, EPS, overlaps, overlapsXYWH, rectHitsTerrain, segmentHitsRect, sweepX, sweepY,
} from './collision.js';
import type { ObjSim, PlayerSim, World } from './world.js';

const BW = PlayerTuning.bodyW;
const BH = PlayerTuning.bodyH;

// Scratch rect reused to avoid allocations in the hot path.
const tmp: Rect = { x: 0, y: 0, w: 0, h: 0 };

function bodyRect(p: PlayerSim, out: Rect = tmp): Rect {
  out.x = p.x; out.y = p.y; out.w = BW; out.h = BH;
  return out;
}

// ---------------------------------------------------------------------------
// Signals

export function evalTarget(o: ObjDef, sig: Uint8Array): boolean {
  let v: boolean;
  if (!o.sources.length) v = true;
  else if (o.mode === 'any') v = o.sources.some((i) => sig[i] === 1);
  else v = o.sources.every((i) => sig[i] === 1);
  return o.invert ? !v : v;
}

export function computeSignals(level: CompiledLevel, w: World): void {
  for (const o of level.objects) {
    const st = w.objs[o.index];
    switch (o.type) {
      case 'plate': case 'lever': case 'node': case 'receiver': case 'crystal':
        w.sig[o.index] = st.s ? 1 : 0;
        break;
      default:
        w.sig[o.index] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers for dynamic objects

/** Solid rect of a door at progress p (null when fully passable). */
export function doorSolid(o: ObjDef, p: number, out: Rect): Rect | null {
  if (o.style === 'bridge') {
    if (p >= 0.5) return null;
    out.x = o.x; out.y = o.y; out.w = o.w; out.h = o.h;
    return out;
  }
  const open = Math.min(1, Math.max(0, p));
  if (open >= 1 - EPS) return null;
  if (o.h >= o.w) {
    out.x = o.x; out.y = o.y; out.w = o.w; out.h = o.h * (1 - open);
  } else {
    out.x = o.x + o.w * open; out.y = o.y; out.w = o.w * (1 - open); out.h = o.h;
  }
  return out;
}

export function platformPos(o: ObjDef, p: number): { x: number; y: number } {
  return { x: o.x + o.toX * p, y: o.y + o.toY * p };
}

export function sawCenter(o: ObjDef, st: ObjSim): { x: number; y: number } {
  return { x: o.x + o.w / 2 + o.toX * st.p, y: o.y + o.h / 2 + o.toY * st.p };
}

export const SAW_RADIUS = 13;

// ---------------------------------------------------------------------------
// Step

export function stepWorld(level: CompiledLevel, w: World, inputs: readonly number[]): void {
  if (w.complete) return;
  w.tick++;
  computeSignals(level, w);

  updateMovers(level, w);

  const solids = collectSolids(level, w);

  for (let i = 0; i < 2; i++) updatePlayer(level, w, i, inputs[i] ?? 0, solids);

  updateCrates(level, w, solids);

  for (let i = 0; i < 2; i++) handleInteract(level, w, i, inputs[i] ?? 0);

  updateActivators(level, w);

  for (let i = 0; i < 2; i++) checkHazards(level, w, i);

  const lit = traceBeams(level, w);
  for (const idx of level.ofType.receiver) w.objs[idx].s = lit.has(idx) ? 1 : 0;

  computeLink(level, w, true);

  checkExit(level, w);
}

// ---------------------------------------------------------------------------
// Movers: doors, platforms, saws, fans, fields, emitters

function updateMovers(level: CompiledLevel, w: World): void {
  const r: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (const o of level.objects) {
    const st = w.objs[o.index];
    switch (o.type) {
      case 'door': {
        const target = (o.latch && st.s === 1) || evalTarget(o, w.sig) ? 1 : 0;
        const speed = (o.style === 'bridge' ? WorldTuning.bridgeSpeed : WorldTuning.doorSpeed) * DT;
        st.s = target;
        if (st.p < target) {
          st.p = Math.min(1, st.p + speed);
        } else if (st.p > target) {
          const np = Math.max(0, st.p - speed);
          const solid = doorSolid(o, np, r);
          if (!solid || !occupied(level, w, solid, -1)) st.p = np;
        }
        break;
      }
      case 'platform': {
        const active = evalTarget(o, w.sig);
        const before = platformPos(o, st.p);
        advancePath(o, st, active);
        const after = platformPos(o, st.p);
        st.x = after.x;
        st.y = after.y;
        const dx = after.x - before.x, dy = after.y - before.y;
        if (dx !== 0 || dy !== 0) carryRiders(level, w, o.index, dx, dy);
        break;
      }
      case 'saw': {
        advancePath(o, st, evalTarget(o, w.sig));
        // Mirror the centre into x/y so renderers can interpolate it like any mover.
        st.x = o.x + o.w / 2 + o.toX * st.p;
        st.y = o.y + o.h / 2 + o.toY * st.p;
        break;
      }
      case 'fan': case 'field': case 'emitter':
        st.s = evalTarget(o, w.sig) ? 1 : 0;
        break;
      default:
        break;
    }
  }
}

function advancePath(o: ObjDef, st: ObjSim, active: boolean): void {
  if (o.pathStep <= 0) return;
  if (o.loop) {
    if (!active) return;
    // vx doubles as the dwell timer for looping movers.
    if (st.vx > 0) { st.vx--; return; }
    const dwell = o.type === 'platform' ? WorldTuning.loopDwellTicks : 0;
    if (st.s === 0) {
      st.p += o.pathStep;
      if (st.p >= 1) { st.p = 1; st.s = 1; st.vx = dwell; }
    } else {
      st.p -= o.pathStep;
      if (st.p <= 0) { st.p = 0; st.s = 0; st.vx = dwell; }
    }
  } else {
    const target = active ? 1 : 0;
    if (st.p < target) st.p = Math.min(1, st.p + o.pathStep);
    else if (st.p > target) st.p = Math.max(0, st.p - o.pathStep);
    st.s = target;
  }
}

/** True when any alive player body or crate overlaps the rect (ignoring object `ignore`). */
function occupied(level: CompiledLevel, w: World, r: Rect, ignore: number): boolean {
  const b: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (const p of w.players) {
    if (p.dead) continue;
    if (overlaps(bodyRect(p, b), r)) return true;
  }
  for (const idx of level.ofType.crate) {
    if (idx === ignore) continue;
    const c = w.objs[idx];
    if (overlapsXYWH(r, c.x, c.y, CrateTuning.size, CrateTuning.size)) return true;
  }
  return false;
}

function carryRiders(level: CompiledLevel, w: World, objIdx: number, dx: number, dy: number): void {
  const solids = collectSolids(level, w);
  for (let i = 0; i < 2; i++) {
    const p = w.players[i];
    if (p.dead || p.ground !== objIdx) continue;
    const filter = playerFilter(i, objIdx);
    const r = bodyRect(p, { x: 0, y: 0, w: 0, h: 0 });
    const mx = sweepX(level, r, dx, solids, filter).d;
    p.x += mx;
    r.x = p.x;
    const my = sweepY(level, r, dy, solids, filter).d;
    p.y += my;
  }
  for (const idx of level.ofType.crate) {
    const c = w.objs[idx];
    if (c.s !== objIdx + 1) continue; // crate.s stores ground object + 1
    const filter = crateFilter(idx, objIdx);
    const r: Rect = { x: c.x, y: c.y, w: CrateTuning.size, h: CrateTuning.size };
    const mx = sweepX(level, r, dx, solids, filter).d;
    c.x += mx;
    r.x = c.x;
    const my = sweepY(level, r, dy, solids, filter).d;
    c.y += my;
  }
}

// ---------------------------------------------------------------------------
// Solids

function collectSolids(level: CompiledLevel, w: World): DynSolid[] {
  const out: DynSolid[] = [];
  const r: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (const o of level.objects) {
    const st = w.objs[o.index];
    switch (o.type) {
      case 'door': {
        const s = doorSolid(o, st.p, r);
        if (s) out.push({ x: s.x, y: s.y, w: s.w, h: s.h, obj: o.index, oneWay: false, passEl: -1, isCrate: false, isPlayer: false });
        break;
      }
      case 'ice':
        if (st.s === 0) out.push({ x: o.x, y: o.y, w: o.w, h: o.h, obj: o.index, oneWay: false, passEl: -1, isCrate: false, isPlayer: false });
        break;
      case 'gate':
        out.push({ x: o.x, y: o.y, w: o.w, h: o.h, obj: o.index, oneWay: false, passEl: o.element === 'tide' ? 1 : 0, isCrate: false, isPlayer: false });
        break;
      case 'platform':
        out.push({ x: st.x, y: st.y, w: o.w, h: o.h, obj: o.index, oneWay: true, passEl: -1, isCrate: false, isPlayer: false });
        break;
      case 'crate':
        out.push({ x: st.x, y: st.y, w: CrateTuning.size, h: CrateTuning.size, obj: o.index, oneWay: false, passEl: -1, isCrate: true, isPlayer: false });
        break;
      default:
        break;
    }
  }
  return out;
}

function playerFilter(el: number, ignoreObj = -99): (s: DynSolid) => boolean {
  return (s) => !s.isPlayer && s.passEl !== el && s.obj !== ignoreObj;
}

function crateFilter(self: number, ignoreObj = -99): (s: DynSolid) => boolean {
  return (s) => s.obj !== self && s.obj !== ignoreObj;
}

function syncCrateSolid(solids: DynSolid[], idx: number, c: ObjSim): void {
  for (const s of solids) {
    if (s.obj === idx) { s.x = c.x; s.y = c.y; return; }
  }
}

// ---------------------------------------------------------------------------
// Players

function updatePlayer(level: CompiledLevel, w: World, i: number, bits: number, solids: DynSolid[]): void {
  const p = w.players[i];
  const T = PlayerTuning;
  p.held = bits & (Btn.Left | Btn.Right | Btn.JumpHeld);

  if (p.dead) {
    p.dead--;
    if (p.dead === 0) respawn(p);
    return;
  }

  // Horizontal input
  const move = ((bits & Btn.Right) ? 1 : 0) - ((bits & Btn.Left) ? 1 : 0);
  if (move !== 0) {
    const accel = p.grounded ? T.groundAccel : T.airAccel;
    const along = p.vx * move; // speed in the input direction
    if (along < T.maxSpeed) {
      const turning = along < 0;
      p.vx += move * (turning && p.grounded ? accel + T.groundDecel : accel) * DT;
      if (p.vx * move > T.maxSpeed) p.vx = move * T.maxSpeed;
    } else {
      // Faster than we can run (wind): bleed toward max speed, gently while airborne.
      const bleed = (p.grounded ? T.groundDecel : T.airDecel) * DT;
      p.vx = move * Math.max(T.maxSpeed, along - bleed);
    }
    p.facing = move;
  } else {
    const decel = (p.grounded ? T.groundDecel : T.airDecel) * DT;
    if (Math.abs(p.vx) <= decel) p.vx = 0;
    else p.vx -= Math.sign(p.vx) * decel;
  }

  // Jump with coyote time and input buffering
  if (bits & Btn.JumpPressed) p.jbuf = T.jumpBufferTicks;
  if (p.grounded) p.coyote = T.coyoteTicks;
  else if (p.coyote > 0) p.coyote--;
  if (p.jbuf > 0) {
    if (p.grounded || p.coyote > 0) {
      p.vy = -T.jumpVelocity;
      p.jumping = true;
      p.jbuf = 0;
      p.coyote = 0;
      p.grounded = false;
      p.ground = -1;
    } else {
      p.jbuf--;
    }
  }

  // Wind
  const body = bodyRect(p, { x: 0, y: 0, w: 0, h: 0 });
  let inUpdraft = false;
  for (const idx of level.ofType.fan) {
    const st = w.objs[idx];
    if (!st.s) continue;
    const o = level.objects[idx];
    if (!overlaps(body, o)) continue;
    const a = WorldTuning.fanAccel * DT;
    switch (o.dir) {
      case 'up': p.vy = Math.max(-WorldTuning.fanMaxSpeed, p.vy - a); inUpdraft = true; break;
      case 'down': p.vy = Math.min(WorldTuning.fanMaxSpeed, p.vy + a); break;
      case 'left': if (p.vx > -WorldTuning.fanMaxSpeedH) p.vx = Math.max(-WorldTuning.fanMaxSpeedH, p.vx - a); break;
      case 'right': if (p.vx < WorldTuning.fanMaxSpeedH) p.vx = Math.min(WorldTuning.fanMaxSpeedH, p.vx + a); break;
    }
  }

  // Gravity
  let g = T.gravity;
  // Releasing jump early cuts the arc short — but never fights an updraft.
  if (p.vy >= 0 || inUpdraft) p.jumping = false;
  if (p.jumping && !(bits & Btn.JumpHeld)) g *= T.jumpCutGravity;
  p.vy = Math.min(T.maxFallSpeed, p.vy + g * DT);

  // Horizontal move with crate pushing
  const filter = playerFilter(i);
  const dx = p.vx * DT;
  if (dx !== 0) {
    let sx = sweepX(level, body, dx, solids, filter);
    let moved = sx.d;
    const hit = sx.hit;
    if (moved !== dx && hit >= 0 && solids[hit].isCrate) {
      const crateIdx = solids[hit].obj;
      const want = dx - moved;
      pushCrateX(level, w, crateIdx, want, solids);
      body.x = p.x;
      sx = sweepX(level, body, dx, solids, filter);
      moved = sx.d;
      if (Math.abs(p.vx) > T.pushSpeed) p.vx = Math.sign(p.vx) * T.pushSpeed;
    } else if (moved !== dx) {
      p.vx = 0;
    }
    p.x += moved;
    body.x = p.x;
  }

  // Vertical move
  const dy = p.vy * DT;
  const sy = sweepY(level, body, dy, solids, filter);
  p.y += sy.d;
  if (dy > 0 && sy.d < dy - EPS) {
    p.grounded = true;
    p.vy = 0;
    p.ground = sy.hit >= 0 ? solids[sy.hit].obj : -1;
  } else {
    if (dy < 0 && sy.d > dy + EPS) p.vy = 0; // bonked a ceiling
    p.grounded = false;
    p.ground = -1;
  }

  if (p.y > level.heightPx + 64) kill(p);
}

function pushCrateX(level: CompiledLevel, w: World, idx: number, dx: number, solids: DynSolid[]): number {
  const c = w.objs[idx];
  const r: Rect = { x: c.x, y: c.y, w: CrateTuning.size, h: CrateTuning.size };
  // Crates are blocked by players too, so the pusher cannot be shoved through a wall.
  const withPlayers = solids.concat(playerSolids(w));
  const moved = sweepX(level, r, dx, withPlayers, (s) => s.obj !== idx && !(s.isPlayer && isPusherSide(s, r, dx))).d;
  if (moved === 0) return 0;
  c.x += moved;
  syncCrateSolid(solids, idx, c);
  // Carry anything standing on the crate.
  for (let i = 0; i < 2; i++) {
    const p = w.players[i];
    if (p.dead || p.ground !== idx) continue;
    const b = bodyRect(p, { x: 0, y: 0, w: 0, h: 0 });
    p.x += sweepX(level, b, moved, solids, playerFilter(i, idx)).d;
  }
  return moved;
}

/** The pushing player sits behind the crate; ignore bodies on the trailing side. */
function isPusherSide(s: DynSolid, crate: Rect, dx: number): boolean {
  return dx > 0 ? s.x + s.w <= crate.x + EPS : s.x >= crate.x + crate.w - EPS;
}

function playerSolids(w: World): DynSolid[] {
  const out: DynSolid[] = [];
  for (let i = 0; i < 2; i++) {
    const p = w.players[i];
    if (p.dead) continue;
    out.push({ x: p.x, y: p.y, w: BW, h: BH, obj: -(i + 10), oneWay: false, passEl: -1, isCrate: false, isPlayer: true });
  }
  return out;
}

function respawn(p: PlayerSim): void {
  p.jumping = false;
  p.x = p.rx;
  p.y = p.ry;
  p.vx = 0;
  p.vy = 0;
  p.grounded = false;
  p.coyote = 0;
  p.jbuf = 0;
  p.ground = -1;
}

function kill(p: PlayerSim): void {
  if (p.dead) return;
  p.dead = PlayerTuning.deathTicks;
  p.deaths++;
  p.vx = 0;
  p.vy = 0;
  p.grounded = false;
  p.ground = -1;
}

// ---------------------------------------------------------------------------
// Crates

function updateCrates(level: CompiledLevel, w: World, solids: DynSolid[]): void {
  if (!level.ofType.crate.length) return;
  const withPlayers = solids.concat(playerSolids(w));
  for (const idx of level.ofType.crate) {
    const c = w.objs[idx];
    const o = level.objects[idx];
    c.vy = Math.min(CrateTuning.maxFallSpeed, c.vy + CrateTuning.gravity * DT);
    const r: Rect = { x: c.x, y: c.y, w: CrateTuning.size, h: CrateTuning.size };
    const dy = c.vy * DT;
    const sy = sweepY(level, r, dy, withPlayers, (s) => s.obj !== idx);
    c.y += sy.d;
    if (dy > 0 && sy.d < dy - EPS) {
      c.vy = 0;
      const hit = sy.hit >= 0 ? withPlayers[sy.hit] : null;
      c.s = hit && !hit.isPlayer ? hit.obj + 1 : 0;
    } else {
      c.s = 0;
    }
    if (c.y > level.heightPx + 64) {
      // Lost crates return home so the puzzle can never softlock.
      c.x = o.x; c.y = o.y; c.vx = 0; c.vy = 0; c.s = 0;
    }
    syncCrateSolid(solids, idx, c);
    for (const s of withPlayers) if (s.obj === idx) { s.x = c.x; s.y = c.y; }
  }
}

// ---------------------------------------------------------------------------
// Interaction (levers, mirrors)

function handleInteract(level: CompiledLevel, w: World, i: number, bits: number): void {
  if (!(bits & Btn.InteractPressed)) return;
  const p = w.players[i];
  if (p.dead) return;
  const reach = PlayerTuning.interactReach;
  const cx = p.x + BW / 2, cy = p.y + BH / 2;
  let best = -1, bestD = Infinity;
  for (const list of [level.ofType.lever, level.ofType.mirror]) {
    for (const idx of list) {
      const o = level.objects[idx];
      if (o.type === 'mirror' && o.fixed) continue;
      if (o.element && o.element !== (i === 0 ? 'ember' : 'tide')) continue;
      if (!overlapsXYWH({ x: p.x - reach, y: p.y - reach, w: BW + reach * 2, h: BH + reach * 2 }, o.x, o.y, o.w, o.h)) continue;
      const d = Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy);
      if (d < bestD) { bestD = d; best = idx; }
    }
  }
  if (best < 0) return;
  const st = w.objs[best];
  st.s = st.s ? 0 : 1;
  st.p = 0;
}

/** Index of the interactable a player would use right now (for UI prompts), or -1. */
export function interactTarget(level: CompiledLevel, w: World, i: number): number {
  const p = w.players[i];
  if (p.dead) return -1;
  const reach = PlayerTuning.interactReach;
  const cx = p.x + BW / 2, cy = p.y + BH / 2;
  let best = -1, bestD = Infinity;
  for (const list of [level.ofType.lever, level.ofType.mirror]) {
    for (const idx of list) {
      const o = level.objects[idx];
      if (o.type === 'mirror' && o.fixed) continue;
      if (o.element && o.element !== (i === 0 ? 'ember' : 'tide')) continue;
      if (!overlapsXYWH({ x: p.x - reach, y: p.y - reach, w: BW + reach * 2, h: BH + reach * 2 }, o.x, o.y, o.w, o.h)) continue;
      const d = Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy);
      if (d < bestD) { bestD = d; best = idx; }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Activators: plates, nodes, timed levers, ice, checkpoints

function updateActivators(level: CompiledLevel, w: World): void {
  const b: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (const idx of level.ofType.plate) {
    const o = level.objects[idx];
    const zx = o.x + 3, zy = o.y + o.h - 10, zw = o.w - 6, zh = 10;
    let pressed = false;
    for (const p of w.players) {
      if (!p.dead && overlapsXYWH(bodyRect(p, b), zx, zy, zw, zh)) pressed = true;
    }
    if (!pressed) {
      for (const ci of level.ofType.crate) {
        const c = w.objs[ci];
        if (c.x < zx + zw && c.x + CrateTuning.size > zx && c.y < zy + zh && c.y + CrateTuning.size > zy) pressed = true;
      }
    }
    w.objs[idx].s = pressed ? 1 : 0;
  }

  for (const idx of level.ofType.lever) {
    const o = level.objects[idx];
    const st = w.objs[idx];
    if (o.timerTicks > 0 && st.s) {
      st.p++;
      if (st.p >= o.timerTicks) { st.s = 0; st.p = 0; }
    }
  }

  for (const idx of level.ofType.node) {
    const o = level.objects[idx];
    const st = w.objs[idx];
    const pi = o.element === 'tide' ? 1 : 0;
    const p = w.players[pi];
    const touching = !p.dead && overlapsXYWH(bodyRect(p, b), o.x - 2, o.y - 2, o.w + 4, o.h + 4);
    if (o.hold) {
      st.s = touching ? 1 : 0;
    } else if (touching) {
      st.s = 1;
      st.p = 0;
    } else if (st.s && o.timerTicks > 0) {
      st.p++;
      if (st.p >= o.timerTicks) { st.s = 0; st.p = 0; }
    }
  }

  for (const idx of level.ofType.ice) {
    const o = level.objects[idx];
    const st = w.objs[idx];
    if (st.s === 0) {
      const p = w.players[0];
      if (!p.dead && overlapsXYWH(bodyRect(p, b), o.x - 3, o.y - 3, o.w + 6, o.h + 6)) {
        st.s = 1;
        st.p = 0;
      }
    } else if (st.s === 1) {
      st.p++;
      if (st.p >= WorldTuning.iceMeltTicks) st.s = 2;
    }
  }

  for (const idx of level.ofType.checkpoint) {
    const o = level.objects[idx];
    const st = w.objs[idx];
    for (let i = 0; i < 2; i++) {
      if (o.element && o.element !== (i === 0 ? 'ember' : 'tide')) continue;
      const p = w.players[i];
      if (p.dead || !overlapsXYWH(bodyRect(p, b), o.x, o.y, o.w, o.h)) continue;
      const rx = o.x + o.w / 2 - BW / 2 + (o.element ? 0 : i === 0 ? -10 : 10);
      const ry = o.y + o.h - BH;
      if (p.rx !== rx || p.ry !== ry) {
        p.rx = rx;
        p.ry = ry;
      }
      st.s |= 1 << i;
    }
  }
}

// ---------------------------------------------------------------------------
// Hazards

function checkHazards(level: CompiledLevel, w: World, i: number): void {
  const p = w.players[i];
  if (p.dead) return;
  const isEmber = i === 0;
  // Slightly forgiving hitbox.
  const hx = p.x + 2, hy = p.y + 2, hw = BW - 4, hh = BH - 2;
  const c0 = Math.floor(hx / TILE), c1 = Math.floor((hx + hw) / TILE);
  const r0 = Math.floor(hy / TILE), r1 = Math.floor((hy + hh + 6) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = tileAt(level, c, r);
      if (r >= level.rows || c < 0 || c >= level.cols) continue;
      const tx = c * TILE, ty = r * TILE;
      let lethal = false;
      if (t === Tile.Lava || t === Tile.Water || t === Tile.Toxic) {
        const deadly = t === Tile.Toxic || (t === Tile.Lava && !isEmber) || (t === Tile.Water && isEmber);
        // Lethal once the feet touch the surface (hy + hh is the feet line).
        if (deadly && hx < tx + TILE - 5 && hx + hw > tx + 5 && hy < ty + 3 && hy + hh > ty - 1) lethal = true;
      } else if (t === Tile.Spikes) {
        if (hx < tx + TILE - 6 && hx + hw > tx + 6 && hy < ty + TILE && hy + hh > ty + 18) lethal = true;
      }
      if (lethal) { kill(p); return; }
    }
  }
  const hit: Rect = { x: hx, y: hy, w: hw, h: hh };
  for (const idx of level.ofType.field) {
    if (!w.objs[idx].s) continue;
    const o = level.objects[idx];
    if (overlapsXYWH(hit, o.x + 4, o.y + 2, o.w - 8, o.h - 4)) { kill(p); return; }
  }
  for (const idx of level.ofType.saw) {
    const o = level.objects[idx];
    const c = sawCenter(o, w.objs[idx]);
    const nx = Math.max(hx, Math.min(c.x, hx + hw));
    const ny = Math.max(hy, Math.min(c.y, hy + hh));
    if ((nx - c.x) ** 2 + (ny - c.y) ** 2 < SAW_RADIUS * SAW_RADIUS) { kill(p); return; }
  }
  // Crushed inside geometry (should be rare; prevents permanent stuck states).
  if (rectHitsTerrain(level, { x: p.x + 3, y: p.y + 3, w: BW - 6, h: BH - 6 })) kill(p);
}

// ---------------------------------------------------------------------------
// Light beams (grid based)

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const DIR_INDEX: Record<string, number> = { right: 0, down: 1, left: 2, up: 3 };
// '/' : right→up, down→left, left→down, up→right
const MIRROR_SLASH = [3, 2, 1, 0];
// '\' : right→down, down→right, left→up, up→left
const MIRROR_BACK = [1, 0, 3, 2];

function beamBlockers(level: CompiledLevel, w: World): Rect[] {
  const out: Rect[] = [];
  const r: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (const o of level.objects) {
    const st = w.objs[o.index];
    if (o.type === 'door') {
      const s = doorSolid(o, st.p, r);
      if (s) out.push({ ...s });
    } else if (o.type === 'ice' && st.s === 0) out.push({ x: o.x, y: o.y, w: o.w, h: o.h });
    else if (o.type === 'crate') out.push({ x: st.x, y: st.y, w: CrateTuning.size, h: CrateTuning.size });
    else if (o.type === 'platform') out.push({ x: st.x, y: st.y, w: o.w, h: o.h });
  }
  for (const p of w.players) if (!p.dead) out.push({ x: p.x, y: p.y, w: BW, h: BH });
  return out;
}

/** Distance along an axis-aligned ray to the first blocker within maxD, or Infinity. */
function rayBlock(blockers: Rect[], x: number, y: number, d: number, maxD: number): number {
  let best = Infinity;
  for (const b of blockers) {
    let t = Infinity;
    if (d === 0 || d === 2) {
      if (y <= b.y || y >= b.y + b.h) continue;
      if (d === 0) { if (b.x + b.w <= x) continue; t = Math.max(0, b.x - x); }
      else { if (b.x >= x) continue; t = Math.max(0, x - (b.x + b.w)); }
    } else {
      if (x <= b.x || x >= b.x + b.w) continue;
      if (d === 1) { if (b.y + b.h <= y) continue; t = Math.max(0, b.y - y); }
      else { if (b.y >= y) continue; t = Math.max(0, y - (b.y + b.h)); }
    }
    if (t <= maxD && t < best) best = t;
  }
  return best;
}

export function traceBeams(level: CompiledLevel, w: World): Set<number> {
  const lit = new Set<number>();
  const segs: number[] = [];
  w.beams = segs;
  const emitters = level.ofType.emitter;
  if (!emitters.length) return lit;
  const blockers = beamBlockers(level, w);
  const visited = new Set<number>();
  const queue: Array<[number, number, number]> = [];
  for (const idx of emitters) {
    if (!w.objs[idx].s) continue;
    const o = level.objects[idx];
    queue.push([o.col, o.row, DIR_INDEX[o.dir] ?? 0]);
  }
  let guard = 0;
  while (queue.length && guard++ < 64) {
    const [sc, sr, sd] = queue.shift()!;
    let c = sc, r = sr, d = sd;
    let x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
    const sx = x, sy = y;
    let steps = 0;
    let ex = x, ey = y;
    let segStartX = sx, segStartY = sy;
    while (steps++ < 400) {
      const key = (r * level.cols + c) * 4 + d;
      if (visited.has(key)) { ex = x; ey = y; break; }
      visited.add(key);
      const nc = c + DX[d], nr = r + DY[d];
      const t = tileAt(level, nc, nr);
      const blockedTile = isBlockingTile(t) || nr >= level.rows;
      const limit = blockedTile ? TILE / 2 : TILE;
      const bd = rayBlock(blockers, x, y, d, limit);
      if (bd !== Infinity) {
        ex = x + DX[d] * bd; ey = y + DY[d] * bd;
        break;
      }
      if (blockedTile) {
        ex = x + DX[d] * (TILE / 2); ey = y + DY[d] * (TILE / 2);
        break;
      }
      c = nc; r = nr;
      x = c * TILE + TILE / 2; y = r * TILE + TILE / 2;
      const oi = level.beamGrid[r * level.cols + c];
      if (oi >= 0) {
        const o = level.objects[oi];
        if (o.type === 'mirror') {
          segs.push(segStartX, segStartY, x, y);
          segStartX = x; segStartY = y;
          d = w.objs[oi].s ? MIRROR_BACK[d] : MIRROR_SLASH[d];
          continue;
        }
        if (o.type === 'prism') {
          queue.push([c, r, (d + 1) % 4], [c, r, (d + 3) % 4]);
          ex = x; ey = y;
          break;
        }
        if (o.type === 'receiver') {
          lit.add(oi);
          ex = x; ey = y;
          break;
        }
        if (o.type === 'emitter') { ex = x; ey = y; break; }
      }
    }
    segs.push(segStartX, segStartY, ex, ey);
  }
  return lit;
}

// ---------------------------------------------------------------------------
// Resonance Link

function losBlocked(level: CompiledLevel, w: World, ax: number, ay: number, bx: number, by: number): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(dist / 6));
  for (let s = 1; s < steps; s++) {
    const x = ax + ((bx - ax) * s) / steps;
    const y = ay + ((by - ay) * s) / steps;
    if (isBlockingTile(tileAt(level, Math.floor(x / TILE), Math.floor(y / TILE)))) return true;
  }
  const r: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (const idx of level.ofType.door) {
    const s = doorSolid(level.objects[idx], w.objs[idx].p, r);
    if (s && segmentHitsRect(ax, ay, bx, by, s, -1)) return true;
  }
  for (const idx of level.ofType.ice) {
    if (w.objs[idx].s === 0 && segmentHitsRect(ax, ay, bx, by, level.objects[idx], -1)) return true;
  }
  return false;
}

/** Computes link state; when `apply` is true also powers crystals. */
export function computeLink(level: CompiledLevel, w: World, apply: boolean): void {
  const a = w.players[0], b = w.players[1];
  w.linked = false;
  w.linkBlocked = false;
  if (!a.dead && !b.dead) {
    const ax = a.x + BW / 2, ay = a.y + BH / 2, bx = b.x + BW / 2, by = b.y + BH / 2;
    if (Math.hypot(bx - ax, by - ay) <= WorldTuning.linkRange) {
      if (losBlocked(level, w, ax, ay, bx, by)) w.linkBlocked = true;
      else w.linked = true;
    }
    if (apply) {
      for (const idx of level.ofType.crystal) {
        chargeCrystal(level, w, idx, w.linked && segmentHitsRect(ax, ay, bx, by, level.objects[idx], 4));
      }
    }
  } else if (apply) {
    for (const idx of level.ofType.crystal) chargeCrystal(level, w, idx, false);
  }
}

/** A crystal is powered while the link crosses it; with a timer it holds its charge for a while. */
function chargeCrystal(level: CompiledLevel, w: World, idx: number, hit: boolean): void {
  const st = w.objs[idx];
  const o = level.objects[idx];
  if (hit) { st.s = 1; st.p = 0; return; }
  if (st.s && o.timerTicks > 0) {
    st.p++;
    if (st.p >= o.timerTicks) { st.s = 0; st.p = 0; }
  } else {
    st.s = 0;
  }
}

// ---------------------------------------------------------------------------
// Exit

function checkExit(level: CompiledLevel, w: World): void {
  const ex = level.ofType.exit[0];
  if (ex === undefined) return;
  const o = level.objects[ex];
  let inside = 0;
  for (const p of w.players) {
    if (p.dead) continue;
    const cx = p.x + BW / 2, cy = p.y + BH / 2;
    if (cx > o.x && cx < o.x + o.w && cy > o.y && cy < o.y + o.h) inside++;
  }
  w.objs[ex].s = inside;
  if (inside === 2) {
    w.exitTimer++;
    if (w.exitTimer >= WorldTuning.exitHoldTicks) w.complete = true;
  } else {
    w.exitTimer = 0;
  }
}

/** Recompute render-only derived data (signals, beams, link) without advancing time. */
export function computeDerived(level: CompiledLevel, w: World): void {
  computeSignals(level, w);
  traceBeams(level, w);
  computeLink(level, w, false);
}

/** Which player index (if any) is inside the exit, as a bitmask. */
export function exitMask(level: CompiledLevel, w: World): number {
  const ex = level.ofType.exit[0];
  if (ex === undefined) return 0;
  const o = level.objects[ex];
  let m = 0;
  w.players.forEach((p, i) => {
    if (p.dead) return;
    const cx = p.x + BW / 2, cy = p.y + BH / 2;
    if (cx > o.x && cx < o.x + o.w && cy > o.y && cy < o.y + o.h) m |= 1 << i;
  });
  return m;
}
