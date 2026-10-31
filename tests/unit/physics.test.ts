import { describe, expect, it } from 'vitest';
import {
  Btn, type LevelDef, PlayerTuning, TILE, cloneWorld, compileLevel, createWorld, stepWorld,
} from '../../packages/shared/src/index.js';

// A small physics lab: flat floor, a 2-tile step, a 3-tile wall and a pit.
const LAB: LevelDef = {
  schemaVersion: 1, levelId: 'lab', world: 1, index: 0, name: 'Lab', objective: 'test', tip: '', par: 99,
  grid: [
    '##############################',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#.....................#......#',
    '#.....................#......#',
    '#..............##.....#......#',
    '#.12...........##.....#......#',
    '##############################',
  ],
  legend: {},
};
const lab = compileLevel(LAB);

function simulate(inputs: (tick: number) => [number, number], ticks: number) {
  const w = createWorld(lab);
  for (let t = 0; t < ticks; t++) stepWorld(lab, w, inputs(t));
  return w;
}

describe('movement physics', () => {
  it('settles onto the floor and stays grounded', () => {
    const w = simulate(() => [0, 0], 30);
    expect(w.players[0].grounded).toBe(true);
    expect(w.players[0].y + PlayerTuning.bodyH).toBe(10 * TILE);
  });

  it('reaches but never exceeds max run speed', () => {
    let maxV = 0;
    const w = createWorld(lab);
    for (let t = 0; t < 40; t++) {
      stepWorld(lab, w, [Btn.Right, 0]);
      maxV = Math.max(maxV, w.players[0].vx);
    }
    expect(maxV).toBeCloseTo(PlayerTuning.maxSpeed, 5);
  });

  it('full jump clears a 2-tile step but not 3 tiles', () => {
    const w = createWorld(lab);
    for (let t = 0; t < 5; t++) stepWorld(lab, w, [0, 0]);
    const floorY = w.players[0].y;
    let minY = floorY;
    stepWorld(lab, w, [Btn.JumpPressed | Btn.JumpHeld, 0]);
    for (let t = 0; t < 60; t++) {
      stepWorld(lab, w, [Btn.JumpHeld, 0]);
      minY = Math.min(minY, w.players[0].y);
    }
    const height = floorY - minY;
    expect(height).toBeGreaterThan(2 * TILE + 8);
    expect(height).toBeLessThan(3 * TILE);
  });

  it('releasing jump early gives a shorter hop (variable jump height)', () => {
    const peak = (holdTicks: number) => {
      const w = createWorld(lab);
      for (let t = 0; t < 5; t++) stepWorld(lab, w, [0, 0]);
      const y0 = w.players[0].y;
      let min = y0;
      stepWorld(lab, w, [Btn.JumpPressed | Btn.JumpHeld, 0]);
      for (let t = 0; t < 60; t++) {
        stepWorld(lab, w, [t < holdTicks ? Btn.JumpHeld : 0, 0]);
        min = Math.min(min, w.players[0].y);
      }
      return y0 - min;
    };
    expect(peak(4)).toBeLessThan(peak(60) * 0.7);
  });

  it('coyote time allows a jump shortly after walking off a ledge', () => {
    // Stand on the 2-tile step, walk right off its edge, then press jump a few ticks late.
    const w = createWorld(lab);
    w.players[0].x = 16 * TILE + 2;
    w.players[0].y = 8 * TILE - PlayerTuning.bodyH;
    for (let t = 0; t < 5; t++) stepWorld(lab, w, [0, 0]);
    expect(w.players[0].grounded).toBe(true);
    let left = -1;
    for (let t = 0; t < 40; t++) {
      stepWorld(lab, w, [Btn.Right, 0]);
      if (!w.players[0].grounded) { left = t; break; }
    }
    expect(left).toBeGreaterThanOrEqual(0);
    stepWorld(lab, w, [Btn.Right, 0]);
    stepWorld(lab, w, [Btn.Right, 0]);
    stepWorld(lab, w, [Btn.Right | Btn.JumpPressed | Btn.JumpHeld, 0]);
    expect(w.players[0].vy).toBeLessThan(-PlayerTuning.jumpVelocity + 50);
  });

  it('jump buffering: pressing just before landing still jumps', () => {
    const w = createWorld(lab);
    for (let t = 0; t < 5; t++) stepWorld(lab, w, [0, 0]);
    stepWorld(lab, w, [Btn.JumpPressed | Btn.JumpHeld, 0]);
    // Fall until just above the floor, press again, and expect an immediate re-jump.
    let pressed = false;
    let rejumped = false;
    for (let t = 0; t < 120; t++) {
      const p = w.players[0];
      const nearFloor = p.vy > 0 && 10 * TILE - (p.y + PlayerTuning.bodyH) < 8;
      const bits = !pressed && nearFloor ? (pressed = true, Btn.JumpPressed | Btn.JumpHeld) : Btn.JumpHeld;
      stepWorld(lab, w, [bits, 0]);
      if (pressed && w.players[0].vy < -300) { rejumped = true; break; }
    }
    expect(rejumped).toBe(true);
  });

  it('walls stop horizontal motion without tunnelling', () => {
    const w = simulate(() => [Btn.Right, 0], 400);
    const p = w.players[0];
    expect(p.x + PlayerTuning.bodyW).toBeLessThanOrEqual(15 * TILE + 1e-6);
    expect(p.vx).toBe(0);
  });

  it('the simulation is deterministic (bit-identical replays)', () => {
    const script = (t: number): [number, number] => [
      (t % 90 < 50 ? Btn.Right : Btn.Left) | (t % 37 === 0 ? Btn.JumpPressed | Btn.JumpHeld : 0),
      (t % 70 < 30 ? Btn.Left : Btn.Right) | (t % 23 === 0 ? Btn.JumpPressed | Btn.JumpHeld : 0),
    ];
    const a = simulate(script, 1000);
    const b = simulate(script, 1000);
    expect(JSON.stringify(a.players)).toBe(JSON.stringify(b.players));
  });

  it('rollback + replay reproduces the exact same state (prediction correctness)', () => {
    const script = (t: number): [number, number] => [t % 50 < 30 ? Btn.Right : Btn.Left | (t % 31 === 0 ? Btn.JumpPressed | Btn.JumpHeld : 0), Btn.Right];
    const w = createWorld(lab);
    const snapshots: ReturnType<typeof cloneWorld>[] = [];
    for (let t = 0; t < 300; t++) {
      if (t === 120) snapshots.push(cloneWorld(w));
      stepWorld(lab, w, script(t));
    }
    // Rewind to tick 120 and replay the same inputs.
    const replay = snapshots[0];
    for (let t = 120; t < 300; t++) stepWorld(lab, replay, script(t));
    expect(JSON.stringify(replay.players)).toBe(JSON.stringify(w.players));
    expect(replay.tick).toBe(w.tick);
  });

  it('falling out of the world kills and respawns the player', () => {
    const w = createWorld(lab);
    w.players[1].y = 20 * TILE;
    stepWorld(lab, w, [0, 0]);
    expect(w.players[1].dead).toBeGreaterThan(0);
    expect(w.players[1].deaths).toBe(1);
    for (let t = 0; t < PlayerTuning.deathTicks + 2; t++) stepWorld(lab, w, [0, 0]);
    expect(w.players[1].dead).toBe(0);
    expect(w.players[1].x).toBe(lab.spawns[1].x);
  });
});

describe('elemental hazards', () => {
  const POOLS: LevelDef = {
    ...LAB, levelId: 'pools',
    grid: [
      '############',
      '#..........#',
      '#..........#',
      '#.1......2.#',
      '##LLLL#WWWW#',
      '############',
    ],
  };
  const pools = compileLevel(POOLS);
  it('Ember walks on lava but dies in water; Tide the opposite', () => {
    const w = createWorld(pools);
    for (let t = 0; t < 120; t++) stepWorld(pools, w, [Btn.Right, Btn.Left]);
    // Ember crossed lava into water and died at least once; Tide crossed water into lava.
    expect(w.players[0].deaths).toBeGreaterThan(0);
    expect(w.players[1].deaths).toBeGreaterThan(0);
    const w2 = createWorld(pools);
    for (let t = 0; t < 25; t++) stepWorld(pools, w2, [Btn.Right, Btn.Left]);
    expect(w2.players[0].deaths).toBe(0); // still on lava
    expect(w2.players[1].deaths).toBe(0); // still on water
  });
});
