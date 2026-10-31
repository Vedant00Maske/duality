// Network message contract shared by client and server.

import { MAX_NAME_LENGTH, NetTuning, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './config.js';

/** Bump whenever the message contract or simulation changes incompatibly. */
export const PROTOCOL_VERSION = 4;

/** Input bit flags — one byte per simulation tick. */
export const Btn = {
  Left: 1,
  Right: 2,
  JumpHeld: 4,
  JumpPressed: 8,
  InteractPressed: 16,
} as const;
export const BTN_MASK = 31;
/** Bits that represent a held state (safe to repeat when extrapolating). */
export const HELD_MASK = Btn.Left | Btn.Right | Btn.JumpHeld;
export const EDGE_MASK = Btn.JumpPressed | Btn.InteractPressed;

export const Msg = {
  /** client → room: [firstSeq, b0, b1, ...] batched per-tick inputs */
  Input: 'in',
  Ready: 'ready',
  SelectLevel: 'level',
  SwapElements: 'swap',
  Restart: 'restart',
  ToLobby: 'lobby',
  /** results screen vote: 'next' | 'replay' */
  Vote: 'vote',
  Ping: 'ping',
  SetName: 'name',
  /** room → client transient toast */
  Notice: 'notice',
} as const;

export type Phase = 'lobby' | 'countdown' | 'playing' | 'complete';

export interface JoinOptions {
  name: string;
  v: number;
}

export interface NoticePayload {
  text: string;
  kind: 'info' | 'warn' | 'good';
}

export interface LevelResult {
  levelId: string;
  ticks: number;
  deaths: number;
  stars: number;
}

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  const cleaned = raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned.length ? cleaned : 'Player';
}

export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Validate an input batch message; returns null when malformed. */
export function parseInputBatch(msg: unknown): { first: number; bits: number[] } | null {
  if (!Array.isArray(msg) || msg.length < 2 || msg.length > NetTuning.maxInputsPerMessage + 1) return null;
  const first = msg[0];
  if (typeof first !== 'number' || !Number.isInteger(first) || first < 0 || first > 0xffffffff) return null;
  const bits: number[] = [];
  for (let i = 1; i < msg.length; i++) {
    const b = msg[i];
    if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > BTN_MASK) return null;
    bits.push(b);
  }
  return { first, bits };
}

export function starsFor(ticks: number, deaths: number, parSeconds: number): number {
  let stars = 1;
  if (ticks <= parSeconds * 60) stars++;
  if (deaths <= 2) stars++;
  return stars;
}
