// End-to-end room tests: real Colyseus server + real SDK clients over WebSockets.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { Btn, Msg, PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_NAME } from '../../packages/shared/src/index.js';

process.env.DUALITY_NO_LISTEN = '1';
const PORT = 25670 + Math.floor(Math.random() * 200);
const URL = `http://localhost:${PORT}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRoom = Room<any, any>;
let server: { listen: (p: number) => Promise<unknown>; gracefullyShutdown: (exit?: boolean) => Promise<void> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean, ms = 5000, label = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await sleep(20);
  }
}

beforeAll(async () => {
  const mod = await import('../../apps/server/src/index.js');
  server = mod.createGameServer() as unknown as typeof server;
  await server.listen(PORT);
});

afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => undefined);
});

async function pair(): Promise<[AnyRoom, AnyRoom]> {
  const a = await new Client(URL).create(ROOM_NAME, { name: 'Alice', v: PROTOCOL_VERSION });
  const b = await new Client(URL).joinById(a.roomId, { name: 'Bob', v: PROTOCOL_VERSION });
  await waitFor(() => a.state.slots?.[1]?.sid === b.sessionId, 3000, 'join sync');
  return [a, b];
}

async function startGame(a: AnyRoom, b: AnyRoom): Promise<void> {
  a.send(Msg.Ready, { ready: true });
  b.send(Msg.Ready, { ready: true });
  await waitFor(() => a.state.phase === 'countdown' && b.state.phase === 'countdown', 3000, 'countdown');
  await waitFor(() => a.state.phase === 'playing' && b.state.phase === 'playing', 6000, 'playing');
}

describe('rooms', () => {
  it('creates a room with a readable 5-character code and assigns elements', async () => {
    const [a, b] = await pair();
    expect(a.roomId).toHaveLength(5);
    for (const ch of a.roomId) expect(ROOM_CODE_ALPHABET).toContain(ch);
    expect(a.state.slots[0].sid).toBe(a.sessionId); // Ember
    expect(a.state.slots[1].sid).toBe(b.sessionId); // Tide
    expect(a.state.host).toBe(a.sessionId);
    expect(b.state.slots[0].name).toBe('Alice');
    await a.leave(); await b.leave();
  });

  it('rejects unknown codes and full rooms with clear errors', async () => {
    await expect(new Client(URL).joinById('ZZZZZ', { name: 'X', v: PROTOCOL_VERSION })).rejects.toBeTruthy();
    const [a, b] = await pair();
    const err = await new Client(URL).joinById(a.roomId, { name: 'Third', v: PROTOCOL_VERSION }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    await a.leave(); await b.leave();
  });

  it('rejects clients with an outdated protocol', async () => {
    const a = await new Client(URL).create(ROOM_NAME, { name: 'A', v: PROTOCOL_VERSION });
    const err = await new Client(URL).joinById(a.roomId, { name: 'Old', v: 1 }).catch((e) => e);
    expect(String(err?.message)).toMatch(/refresh/i);
    await a.leave();
  });

  it('only the host can pick the level; both see the choice', async () => {
    const [a, b] = await pair();
    b.send(Msg.SelectLevel, { id: 'w1_l2_twin_valves' });
    await sleep(150);
    expect(a.state.level).toBe('w1_l1_first_contact');
    a.send(Msg.SelectLevel, { id: 'w1_l2_twin_valves' });
    await waitFor(() => b.state.level === 'w1_l2_twin_valves', 2000, 'level sync');
    a.send(Msg.SelectLevel, { id: 'not_a_level' });
    await sleep(100);
    expect(b.state.level).toBe('w1_l2_twin_valves');
    await a.leave(); await b.leave();
  });

  it('runs an authoritative simulation driven by sequenced inputs; both clients agree', async () => {
    const [a, b] = await pair();
    await startGame(a, b);
    const x0 = a.state.slots[0].x;
    // Ember holds right for 30 ticks, sent in batches of 2.
    let seq = 1;
    for (let k = 0; k < 15; k++) {
      a.send(Msg.Input, [seq, Btn.Right, Btn.Right]);
      seq += 2;
      await sleep(33);
    }
    await waitFor(() => a.state.slots[0].ack >= seq - 1, 3000, 'ack');
    await sleep(120);
    const xa = a.state.slots[0].x, xb = b.state.slots[0].x;
    expect(xa).toBeGreaterThan(x0 + 40);
    expect(xb).toBe(xa); // identical authoritative state on both clients
    expect(a.state.tick).toBe(b.state.tick);

    // Replaying old sequence numbers must not move the player (wait for it to stop first).
    await sleep(600);
    const before = a.state.slots[0].x;
    a.send(Msg.Input, [1, Btn.Right, Btn.Right, Btn.Right, Btn.Right]);
    await sleep(200);
    expect(a.state.slots[0].x).toBe(before);

    // Malformed input is ignored, not fatal.
    a.send(Msg.Input, ['bad', 999]);
    a.send(Msg.Input, [seq, 255]);
    await sleep(100);
    expect(a.state.phase).toBe('playing');
    await a.leave(); await b.leave();
  });

  it('pauses on disconnect, resumes on reconnect, and returns to lobby if a player leaves', async () => {
    const [a, b] = await pair();
    await startGame(a, b);
    const token = b.reconnectionToken;
    b.reconnection.enabled = false;
    await b.leave(false); // non-consented: seat is held
    await waitFor(() => a.state.paused === true, 3000, 'paused');
    expect(a.state.slots[1].connected).toBe(false);
    const b2 = await new Client(URL).reconnect(token);
    await waitFor(() => a.state.paused === false && a.state.slots[1].connected, 3000, 'resumed');
    expect(b2.state.level).toBe(a.state.level);
    await b2.leave(true); // consented: seat freed
    await waitFor(() => a.state.phase === 'lobby', 3000, 'lobby after leave');
    expect(a.state.slots[1].sid).toBe('');
    // A new player can take the free seat.
    const c = await new Client(URL).joinById(a.roomId, { name: 'Cara', v: PROTOCOL_VERSION });
    await waitFor(() => a.state.slots[1].sid === c.sessionId, 2000, 'new player');
    await a.leave(); await c.leave();
  });

  it('host migrates when the host leaves', async () => {
    const [a, b] = await pair();
    await a.leave(true);
    await waitFor(() => b.state.host === b.sessionId, 2000, 'host migration');
    await b.leave();
  });
});
