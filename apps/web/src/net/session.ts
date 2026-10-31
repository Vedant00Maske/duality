// One Colyseus client per tab. Owns room lifecycle: create, join, automatic
// reconnection (SDK) and refresh recovery (reconnection token in sessionStorage).

import { Client, type Room } from '@colyseus/sdk';
import { Msg, PROTOCOL_VERSION, ROOM_NAME, type NoticePayload, type Phase } from '@duality/shared';

export interface SlotView {
  sid: string;
  name: string;
  ready: boolean;
  connected: boolean;
  vote: string;
  x: number; y: number; vx: number; vy: number;
  fl: number; face: number; cy: number; jb: number; dead: number; held: number; gnd: number;
  rx: number; ry: number; deaths: number; ack: number;
}

export interface ObjView { s: number; p: number; x: number; y: number; vx: number; vy: number }

export interface RoomStateView {
  phase: Phase;
  level: string;
  seq: number;
  host: string;
  tick: number;
  cd: number;
  paused: boolean;
  exitT: number;
  slots: SlotView[];
  objs: ObjView[];
  results: Map<string, { ticks: number; deaths: number; stars: number }>;
  lastTicks: number;
  lastDeaths: number;
  lastStars: number;
}

type Events = {
  state: (s: RoomStateView) => void;
  notice: (n: NoticePayload) => void;
  drop: () => void;
  reconnect: () => void;
  left: (reason: string) => void;
};

const TOKEN_KEY = 'duality.reconnect';

function endpoint(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  // In dev the Vite server (5173) and game server (2567) differ.
  if (location.port === '5173' || location.port === '4173') return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

export function friendlyError(e: unknown): string {
  const err = e as { code?: number; message?: string };
  const msg = (err?.message ?? '').toString();
  if (/full|locked/i.test(msg) || err?.code === 4401) return 'That room is full - DUALITY rooms hold exactly 2 players.';
  if (err?.code === 4400 || /refresh/i.test(msg)) return msg || 'This game was updated. Please refresh the page.';
  if (err?.code === 522 || /not found|invalid room/i.test(msg)) return "No room with that code. Check the code with your partner - rooms close when everyone leaves.";
  if (/expired|consumed/i.test(msg)) return 'That session expired. Please join again.';
  if (/fetch|network|Failed|ECONN|websocket/i.test(msg)) return "Can't reach the game server. Check your connection and try again.";
  return msg || 'Something went wrong. Please try again.';
}

class Session {
  readonly client = new Client(endpoint());
  room: Room | null = null;
  private handlers: { [K in keyof Events]: Set<Events[K]> } = {
    state: new Set(), notice: new Set(), drop: new Set(), reconnect: new Set(), left: new Set(),
  };
  ping = 0;
  private pingTimer = 0;
  private intentionalLeave = false;

  on<K extends keyof Events>(ev: K, fn: Events[K]): void {
    this.handlers[ev].add(fn);
  }

  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>): void {
    for (const fn of this.handlers[ev]) (fn as (...a: Parameters<Events[K]>) => void)(...args);
  }

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  get roomCode(): string {
    return this.room?.roomId ?? '';
  }

  get state(): RoomStateView | null {
    return (this.room?.state as RoomStateView | undefined) ?? null;
  }

  async create(name: string): Promise<void> {
    const room = await this.client.create(ROOM_NAME, { name, v: PROTOCOL_VERSION });
    this.attach(room);
  }

  async join(code: string, name: string): Promise<void> {
    const room = await this.client.joinById(code, { name, v: PROTOCOL_VERSION });
    this.attach(room);
  }

  hasStoredSession(): boolean {
    try { return !!sessionStorage.getItem(TOKEN_KEY); } catch { return false; }
  }

  /** Rejoin after a page refresh, if this tab was in a room. */
  async resume(): Promise<boolean> {
    let token: string | null = null;
    try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
    if (!token) return false;
    try {
      const room = await this.client.reconnect(token);
      this.attach(room);
      return true;
    } catch {
      this.clearToken();
      return false;
    }
  }

  private saveToken(): void {
    try { if (this.room) sessionStorage.setItem(TOKEN_KEY, this.room.reconnectionToken); } catch { /* ignore */ }
  }

  private clearToken(): void {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }

  private attach(room: Room): void {
    this.room = room;
    this.intentionalLeave = false;
    // Allow reconnection even right after joining; keep trying for the whole grace period.
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = 30;
    room.reconnection.maxDelay = 2500;
    room.reconnection.maxEnqueuedMessages = 0;
    this.saveToken();

    room.onStateChange((s) => this.emit('state', s as unknown as RoomStateView));
    room.onMessage(Msg.Notice, (n: NoticePayload) => this.emit('notice', n));
    room.onDrop(() => this.emit('drop'));
    room.onReconnect(() => {
      this.saveToken();
      this.emit('reconnect');
    });
    room.onLeave((code: number) => {
      window.clearInterval(this.pingTimer);
      const intentional = this.intentionalLeave;
      this.room = null;
      this.clearToken();
      this.emit('left', intentional ? '' : code === 4000 ? 'The room was closed.' : 'Disconnected from the room.');
    });
    room.onError((code: number, message?: string) => {
      console.warn('room error', code, message);
    });

    window.clearInterval(this.pingTimer);
    const measure = () => this.room?.ping((ms: number) => { this.ping = ms; });
    measure();
    this.pingTimer = window.setInterval(measure, 2000);
  }

  async leave(): Promise<void> {
    this.intentionalLeave = true;
    this.clearToken();
    const room = this.room;
    if (room) await room.leave(true).catch(() => undefined);
  }

  send(type: string, payload?: unknown): void {
    if (!this.room) return;
    try {
      this.room.send(type, payload);
    } catch {
      /* socket closing; the reconnection flow will recover */
    }
  }

  sendInputs(firstSeq: number, bits: number[]): void {
    if (!bits.length) return;
    this.send(Msg.Input, [firstSeq, ...bits]);
  }
}

export const session = new Session();
