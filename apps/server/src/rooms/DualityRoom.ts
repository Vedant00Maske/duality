import { type Client, Room, ServerError } from '@colyseus/core';
import {
  type CompiledLevel, type World, EDGE_MASK, HELD_MASK, LEVELS, Msg, NetTuning, PROTOCOL_VERSION, ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH, TICK_MS, computeDerived, createWorld, getLevel, nextLevelId, parseInputBatch, sanitizeName, starsFor,
  stepWorld, type NoticePayload, type Phase,
} from '@duality/shared';
import { ObjState, ResultState, RoomState, SlotState } from './schema.js';
import { log } from '../log.js';

const activeCodes = new Set<string>();

function generateCode(): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!activeCodes.has(code)) return code;
  }
  throw new Error('could not allocate a room code');
}

interface InputQueue {
  seqs: number[];
  bits: number[];
  /** Highest sequence number received. */
  lastSeq: number;
  /** Highest sequence number consumed (acknowledged). */
  ack: number;
  /** Held bits of the last consumed input, repeated when the queue starves. */
  lastHeld: number;
  /** Consecutive ticks without fresh input. */
  starved: number;
}

function newQueue(): InputQueue {
  return { seqs: [], bits: [], lastSeq: 0, ack: 0, lastHeld: 0, starved: 0 };
}

export class DualityRoom extends Room<{ state: RoomState }> {
  override maxClients = 2;
  override maxMessagesPerSecond = 150;
  override state = new RoomState();

  private level: CompiledLevel | null = null;
  private world: World | null = null;
  private queues: [InputQueue, InputQueue] = [newQueue(), newQueue()];
  private acc = 0;
  private tickTimes: number[] = [];

  override onCreate(): void {
    const code = generateCode();
    activeCodes.add(code);
    this.roomId = code;
    this.autoDispose = true;

    this.state.slots.push(new SlotState(), new SlotState());
    this.state.level = LEVELS[0].levelId;
    this.setPatchRate(NetTuning.patchMs);
    this.setSimulationInterval((dt) => this.update(dt), TICK_MS);

    this.onMessage(Msg.Input, (client, msg) => this.onInput(client, msg));
    this.onMessage(Msg.Ready, (client, msg) => this.onReady(client, msg));
    this.onMessage(Msg.SelectLevel, (client, msg) => this.onSelectLevel(client, msg));
    this.onMessage(Msg.SwapElements, (client) => this.onSwap(client));
    this.onMessage(Msg.Restart, (client) => this.onRestart(client));
    this.onMessage(Msg.ToLobby, (client) => this.onToLobby(client));
    this.onMessage(Msg.Vote, (client, msg) => this.onVote(client, msg));
    this.onMessage(Msg.SetName, (client, msg) => this.onSetName(client, msg));
    this.onMessage('*', (client, type) => log('warn', 'unknown_message', { room: this.roomId, type: String(type) }));

    log('info', 'room_created', { room: this.roomId });
  }

  override onJoin(client: Client, options: { name?: unknown; v?: unknown }): void {
    if (options?.v !== PROTOCOL_VERSION) {
      throw new ServerError(4400, 'This game was updated. Please refresh the page.');
    }
    const free = this.state.slots.findIndex((s) => !s.sid);
    if (free < 0) throw new ServerError(4401, 'Room is full.');
    const slot = this.state.slots[free];
    slot.sid = client.sessionId;
    slot.name = sanitizeName(options?.name);
    slot.connected = true;
    slot.ready = false;
    slot.vote = '';
    this.queues[free] = newQueue();
    if (!this.state.host) this.state.host = client.sessionId;

    const midGame = this.state.phase !== 'lobby';
    this.notice(`${slot.name} joined as ${free === 0 ? 'Ember' : 'Tide'}.`, 'good', client);
    if (midGame) this.onBothConnectedMaybeResume();
    log('info', 'player_joined', { room: this.roomId, slot: free, midGame });
  }

  override onDrop(client: Client): void {
    const i = this.slotOf(client);
    if (i < 0) return;
    const slot = this.state.slots[i];
    slot.connected = false;
    this.notice(`${slot.name} lost connection — waiting for them to return…`, 'warn', client);
    log('info', 'player_dropped', { room: this.roomId, slot: i });
    this.allowReconnection(client, NetTuning.reconnectGraceSeconds).catch(() => undefined);
  }

  override onReconnect(client: Client): void {
    const i = this.slotOf(client);
    if (i < 0) return;
    const slot = this.state.slots[i];
    slot.connected = true;
    // A refreshed page restarts its sequence counter; accept fresh numbering.
    this.queues[i] = newQueue();
    this.notice(`${slot.name} reconnected.`, 'good', client);
    log('info', 'player_reconnected', { room: this.roomId, slot: i });
    this.onBothConnectedMaybeResume();
  }

  override onLeave(client: Client): void {
    const i = this.slotOf(client);
    if (i < 0) return;
    const slot = this.state.slots[i];
    const name = slot.name;
    slot.sid = '';
    slot.name = '';
    slot.connected = false;
    slot.ready = false;
    slot.vote = '';
    this.queues[i] = newQueue();
    if (this.state.host === client.sessionId) {
      const other = this.state.slots.find((s) => !!s.sid);
      this.state.host = other ? other.sid : '';
    }
    if (this.state.phase !== 'lobby') {
      this.toLobby();
      this.notice(`${name} left the room. Share the code to invite someone new.`, 'warn');
    } else {
      this.notice(`${name} left the room.`, 'warn');
    }
    log('info', 'player_left', { room: this.roomId, slot: i });
  }

  override onDispose(): void {
    activeCodes.delete(this.roomId);
    log('info', 'room_disposed', { room: this.roomId });
  }

  override onBeforePatch(): void {
    const w = this.world;
    if (!w) return;
    const st = this.state;
    st.tick = w.tick;
    st.exitT = w.exitTimer;
    for (let i = 0; i < 2; i++) {
      const p = w.players[i];
      const s = st.slots[i];
      s.x = p.x; s.y = p.y; s.vx = p.vx; s.vy = p.vy;
      s.fl = (p.grounded ? 1 : 0) | (p.jumping ? 2 : 0);
      s.face = p.facing;
      s.cy = p.coyote; s.jb = p.jbuf; s.dead = p.dead; s.held = p.held;
      s.gnd = p.ground; s.rx = p.rx; s.ry = p.ry; s.deaths = p.deaths;
      s.ack = this.queues[i].ack;
    }
    for (let i = 0; i < w.objs.length; i++) {
      const o = w.objs[i];
      const so = st.objs[i];
      if (!so) continue;
      so.s = o.s; so.p = o.p; so.x = o.x; so.y = o.y; so.vx = o.vx; so.vy = o.vy;
    }
  }

  // -------------------------------------------------------------------------

  private slotOf(client: Client): number {
    return this.state.slots.findIndex((s) => s.sid === client.sessionId);
  }

  private notice(text: string, kind: NoticePayload['kind'], except?: Client): void {
    const payload: NoticePayload = { text, kind };
    this.broadcast(Msg.Notice, payload, except ? { except } : undefined);
  }

  private bothPresent(): boolean {
    return this.state.slots.every((s) => !!s.sid && s.connected);
  }

  private onBothConnectedMaybeResume(): void {
    if ((this.state.phase === 'playing' || this.state.phase === 'countdown') && this.bothPresent()) {
      // Give everyone a beat to get their bearings after a pause.
      this.state.phase = 'countdown';
      this.state.cd = NetTuning.countdownTicksRestart;
      this.flushQueues();
    }
  }

  private flushQueues(): void {
    for (const q of this.queues) {
      q.seqs.length = 0;
      q.bits.length = 0;
      q.ack = q.lastSeq;
      q.lastHeld = 0;
    }
  }

  private setPhase(phase: Phase): void {
    this.state.phase = phase;
  }

  private startLevel(levelId: string, countdown: number): void {
    const level = getLevel(levelId);
    if (!level) return;
    this.level = level;
    this.world = createWorld(level);
    computeDerived(level, this.world);
    const st = this.state;
    st.level = levelId;
    st.seq = (st.seq + 1) % 65536;
    st.cd = countdown;
    st.exitT = 0;
    st.paused = false;
    st.objs.clear();
    for (let i = 0; i < level.objects.length; i++) st.objs.push(new ObjState());
    for (const s of st.slots) { s.vote = ''; s.ready = false; }
    this.flushQueues();
    this.acc = 0;
    this.setPhase('countdown');
    this.onBeforePatch();
    log('info', 'level_start', { room: this.roomId, level: levelId });
  }

  private toLobby(): void {
    this.setPhase('lobby');
    this.world = null;
    this.level = null;
    this.state.objs.clear();
    this.state.paused = false;
    for (const s of this.state.slots) { s.ready = false; s.vote = ''; }
  }

  // -------------------------------------------------------------------------
  // Simulation

  private update(dtMs: number): void {
    const st = this.state;
    if (st.phase !== 'countdown' && st.phase !== 'playing') return;
    const paused = !this.bothPresent();
    st.paused = paused;
    if (paused) {
      this.flushQueues();
      this.acc = 0;
      return;
    }
    this.acc += Math.min(dtMs, 250);
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 5) {
      this.acc -= TICK_MS;
      steps++;
      if (st.phase === 'countdown') {
        this.flushQueues();
        if (st.cd > 0) st.cd--;
        if (st.cd === 0) this.setPhase('playing');
        continue;
      }
      this.simTick();
      if (st.phase !== 'playing') break;
    }
    if (steps === 5) this.acc = 0; // never spiral
  }

  private simTick(): void {
    const level = this.level, w = this.world;
    if (!level || !w) return;
    const t0 = performance.now();
    const inputs = [this.consume(0), this.consume(1)];
    stepWorld(level, w, inputs);
    const dt = performance.now() - t0;
    this.tickTimes.push(dt);
    if (this.tickTimes.length >= 600) {
      const avg = this.tickTimes.reduce((a, b) => a + b, 0) / this.tickTimes.length;
      const max = Math.max(...this.tickTimes);
      log('info', 'tick_stats', { room: this.roomId, level: level.id, avgMs: +avg.toFixed(3), maxMs: +max.toFixed(3) });
      this.tickTimes.length = 0;
    }
    if (w.complete) this.completeLevel();
  }

  /** Take one input for this tick, keeping latency bounded and edges intact. */
  private consume(i: number): number {
    const q = this.queues[i];
    if (!q.bits.length) {
      // Brief network jitter: keep the held keys. A stalled client stops after ~200 ms.
      return ++q.starved > 12 ? 0 : q.lastHeld;
    }
    q.starved = 0;
    let edges = 0;
    while (q.bits.length > NetTuning.queueSoftLimit) {
      edges |= q.bits.shift()! & EDGE_MASK;
      q.ack = q.seqs.shift()!;
    }
    const bits = q.bits.shift()! | edges;
    q.ack = q.seqs.shift()!;
    q.lastHeld = bits & HELD_MASK;
    return bits;
  }

  private completeLevel(): void {
    const level = this.level, w = this.world;
    if (!level || !w) return;
    const deaths = w.players[0].deaths + w.players[1].deaths;
    const stars = starsFor(w.tick, deaths, level.def.par);
    const st = this.state;
    st.lastTicks = w.tick;
    st.lastDeaths = deaths;
    st.lastStars = stars;
    const prev = st.results.get(level.id);
    if (!prev || stars > prev.stars || (stars === prev.stars && w.tick < prev.ticks)) {
      const r = new ResultState();
      r.ticks = w.tick;
      r.deaths = deaths;
      r.stars = stars;
      st.results.set(level.id, r);
    }
    for (const s of st.slots) s.vote = '';
    this.onBeforePatch();
    this.setPhase('complete');
    log('info', 'level_complete', { room: this.roomId, level: level.id, ticks: w.tick, deaths, stars });
  }

  // -------------------------------------------------------------------------
  // Messages

  private onInput(client: Client, msg: unknown): void {
    const i = this.slotOf(client);
    if (i < 0) return;
    const batch = parseInputBatch(msg);
    if (!batch) {
      log('warn', 'bad_input', { room: this.roomId });
      return;
    }
    const q = this.queues[i];
    const accepting = this.state.phase === 'playing' && !this.state.paused;
    for (let k = 0; k < batch.bits.length; k++) {
      const seq = batch.first + k;
      if (seq <= q.lastSeq) continue; // duplicate / replayed
      q.lastSeq = seq;
      if (!accepting) {
        q.ack = seq; // acknowledge but discard
        continue;
      }
      q.seqs.push(seq);
      q.bits.push(batch.bits[k]);
    }
    while (q.bits.length > NetTuning.maxQueuedInputs) {
      q.bits.shift();
      q.ack = q.seqs.shift()!;
    }
  }

  private onReady(client: Client, msg: unknown): void {
    if (this.state.phase !== 'lobby') return;
    const i = this.slotOf(client);
    if (i < 0) return;
    this.state.slots[i].ready = !!(msg as { ready?: boolean })?.ready;
    if (this.state.slots.every((s) => s.sid && s.connected && s.ready)) {
      this.startLevel(this.state.level, NetTuning.countdownTicksStart);
    }
  }

  private onSelectLevel(client: Client, msg: unknown): void {
    if (this.state.phase !== 'lobby') return;
    if (client.sessionId !== this.state.host) return;
    const id = (msg as { id?: unknown })?.id;
    if (typeof id !== 'string' || !getLevel(id)) return;
    this.state.level = id;
    for (const s of this.state.slots) s.ready = false;
  }

  private onSwap(client: Client): void {
    if (this.state.phase !== 'lobby' || this.slotOf(client) < 0) return;
    const [a, b] = this.state.slots;
    const [sid, name, connected] = [a.sid, a.name, a.connected];
    a.sid = b.sid; a.name = b.name; a.connected = b.connected;
    b.sid = sid; b.name = name; b.connected = connected;
    a.ready = false;
    b.ready = false;
    const qa = this.queues[0];
    this.queues[0] = this.queues[1];
    this.queues[1] = qa;
  }

  private onRestart(client: Client): void {
    const phase = this.state.phase;
    if (phase !== 'playing' && phase !== 'countdown' && phase !== 'complete') return;
    const i = this.slotOf(client);
    if (i < 0) return;
    this.startLevel(this.state.level, NetTuning.countdownTicksRestart);
    this.notice(`${this.state.slots[i].name} restarted the level.`, 'info', client);
  }

  private onToLobby(client: Client): void {
    if (this.state.phase === 'lobby') return;
    const i = this.slotOf(client);
    if (i < 0) return;
    this.toLobby();
    this.notice(`${this.state.slots[i].name} returned to level select.`, 'info', client);
  }

  private onVote(client: Client, msg: unknown): void {
    if (this.state.phase !== 'complete') return;
    const i = this.slotOf(client);
    if (i < 0) return;
    const v = (msg as { v?: unknown })?.v;
    if (v !== 'next' && v !== 'replay') return;
    this.state.slots[i].vote = v;
    const [a, b] = this.state.slots;
    if (a.vote && a.vote === b.vote) {
      if (v === 'replay') this.startLevel(this.state.level, NetTuning.countdownTicksRestart);
      else {
        const next = nextLevelId(this.state.level);
        if (next) {
          this.state.level = next;
          this.startLevel(next, NetTuning.countdownTicksStart);
        } else {
          this.toLobby();
        }
      }
    }
  }

  private onSetName(client: Client, msg: unknown): void {
    const i = this.slotOf(client);
    if (i < 0) return;
    this.state.slots[i].name = sanitizeName((msg as { name?: unknown })?.name);
  }
}
