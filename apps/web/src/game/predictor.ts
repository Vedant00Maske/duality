// Client-side prediction with server reconciliation.
//
// The client runs the exact same deterministic simulation as the server. Local
// input is applied immediately (zero perceived latency). Every authoritative
// snapshot rewinds to the server state and replays inputs the server has not
// acknowledged yet. The partner is extrapolated from their last held keys.
// Any difference between the old and new prediction is folded into a visual
// offset that decays over ~100 ms, so corrections never pop.

import {
  type CompiledLevel, type World, CrateTuning, HELD_MASK, cloneWorld, computeDerived, stepWorld,
} from '@duality/shared';

interface Pending { seq: number; bits: number }

export interface Vec2 { x: number; y: number }

const SNAP_DISTANCE = 96;

export class Predictor {
  world: World;
  /** Positions at the previous tick for render interpolation. */
  prev = { players: [{ x: 0, y: 0 }, { x: 0, y: 0 }] as Vec2[], objs: [] as Vec2[] };
  /** Smoothed correction offsets. */
  offset = { players: [{ x: 0, y: 0 }, { x: 0, y: 0 }] as Vec2[], objs: [] as Vec2[] };
  private pending: Pending[] = [];
  private nextSeq = 1;
  remoteHeld = 0;
  /** Diagnostics */
  lastCorrection = 0;
  replayDepth = 0;

  constructor(readonly level: CompiledLevel, initial: World, public local: number) {
    this.world = cloneWorld(initial);
    computeDerived(level, this.world);
    this.prev.objs = level.objects.map(() => ({ x: 0, y: 0 }));
    this.offset.objs = level.objects.map(() => ({ x: 0, y: 0 }));
    this.savePrev();
  }

  get remote(): number {
    return 1 - this.local;
  }

  /** Continue sequence numbers across levels so the server never sees duplicates. */
  setSeqBase(next: number): void {
    this.nextSeq = Math.max(this.nextSeq, next);
  }

  get seq(): number {
    return this.nextSeq;
  }

  savePrev(): void {
    const w = this.world;
    for (let i = 0; i < 2; i++) {
      this.prev.players[i].x = w.players[i].x;
      this.prev.players[i].y = w.players[i].y;
    }
    for (let i = 0; i < w.objs.length; i++) {
      this.prev.objs[i].x = w.objs[i].x;
      this.prev.objs[i].y = w.objs[i].y;
    }
  }

  /** Advance one fixed tick with local input. Returns the input's sequence number. */
  tick(bits: number): number {
    const seq = this.nextSeq++;
    this.pending.push({ seq, bits });
    if (this.pending.length > 240) this.pending.shift(); // ~4s safety bound
    this.savePrev();
    const inputs = [0, 0];
    inputs[this.local] = bits;
    inputs[this.remote] = this.remoteHeld & HELD_MASK;
    stepWorld(this.level, this.world, inputs);
    return seq;
  }

  /** Rewind to an authoritative snapshot and replay unacknowledged inputs. */
  reconcile(auth: World, ack: number, remoteHeld: number): void {
    this.remoteHeld = remoteHeld;
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();

    const old = this.world;
    const w = cloneWorld(auth);
    const inputs = [0, 0];
    for (const p of this.pending) {
      inputs[this.local] = p.bits;
      inputs[this.remote] = remoteHeld & HELD_MASK;
      stepWorld(this.level, w, inputs);
    }
    computeDerived(this.level, w);
    this.replayDepth = this.pending.length;

    // Fold the prediction error into decaying visual offsets.
    let maxErr = 0;
    for (let i = 0; i < 2; i++) {
      const dx = old.players[i].x - w.players[i].x;
      const dy = old.players[i].y - w.players[i].y;
      maxErr = Math.max(maxErr, Math.hypot(dx, dy));
      this.applyCorrection(this.offset.players[i], this.prev.players[i], dx, dy, w.players[i].dead !== old.players[i].dead);
    }
    for (let i = 0; i < w.objs.length; i++) {
      const dx = old.objs[i].x - w.objs[i].x;
      const dy = old.objs[i].y - w.objs[i].y;
      if (dx || dy) this.applyCorrection(this.offset.objs[i], this.prev.objs[i], dx, dy, false);
    }
    this.lastCorrection = maxErr;
    this.world = w;
  }

  private applyCorrection(off: Vec2, prev: Vec2, dx: number, dy: number, teleport: boolean): void {
    if (teleport || Math.hypot(dx, dy) > SNAP_DISTANCE) {
      off.x = 0; off.y = 0;
      prev.x -= dx; prev.y -= dy;
      return;
    }
    // Keep the rendered position continuous: shift interpolation origin and add offset.
    prev.x -= dx; prev.y -= dy;
    off.x += dx; off.y += dy;
  }

  /** Decay correction offsets; call once per rendered frame. */
  decay(dtMs: number): void {
    const k = Math.exp(-dtMs / 70);
    for (const o of this.offset.players) { o.x *= k; o.y *= k; if (Math.abs(o.x) < 0.01) o.x = 0; if (Math.abs(o.y) < 0.01) o.y = 0; }
    for (const o of this.offset.objs) { o.x *= k; o.y *= k; }
  }

  /** Interpolated, smoothed render position of a player body (top-left). */
  playerPos(i: number, alpha: number, out: Vec2): Vec2 {
    const p = this.world.players[i];
    const pr = this.prev.players[i];
    const o = this.offset.players[i];
    out.x = pr.x + (p.x - pr.x) * alpha + o.x;
    out.y = pr.y + (p.y - pr.y) * alpha + o.y;
    return out;
  }

  objPos(i: number, alpha: number, out: Vec2): Vec2 {
    const s = this.world.objs[i];
    const pr = this.prev.objs[i];
    const o = this.offset.objs[i];
    out.x = pr.x + (s.x - pr.x) * alpha + o.x;
    out.y = pr.y + (s.y - pr.y) * alpha + o.y;
    return out;
  }

  /** Replace state outright (countdown, level start). */
  hardSet(auth: World): void {
    this.world = cloneWorld(auth);
    computeDerived(this.level, this.world);
    this.pending.length = 0;
    for (const o of this.offset.players) { o.x = 0; o.y = 0; }
    for (const o of this.offset.objs) { o.x = 0; o.y = 0; }
    this.savePrev();
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

export const CRATE = CrateTuning.size;
