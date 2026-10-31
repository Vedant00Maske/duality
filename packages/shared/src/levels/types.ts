// Level authoring format.
//
// Levels are authored as an ASCII grid plus a legend that maps letters to puzzle
// objects. Terrain characters:
//   '#' solid rock      '-' one-way platform   '.' or ' ' empty
//   'L' lava pool       'W' water pool          'T' toxic pool
//   '^' spikes          '1' Ember spawn         '2' Tide spawn
// Any other character must appear in the legend; all of its cells must form one
// filled rectangle, which becomes that object's bounds.

export type ElementName = 'ember' | 'tide';
export const ELEMENTS: readonly ElementName[] = ['ember', 'tide'];

export type Dir = 'up' | 'down' | 'left' | 'right';

export type ObjType =
  | 'door'
  | 'plate'
  | 'lever'
  | 'node'
  | 'ice'
  | 'crate'
  | 'platform'
  | 'fan'
  | 'emitter'
  | 'mirror'
  | 'prism'
  | 'receiver'
  | 'crystal'
  | 'field'
  | 'saw'
  | 'checkpoint'
  | 'exit'
  | 'gate'
  | 'sign';

export const OBJ_TYPES: readonly ObjType[] = [
  'door', 'plate', 'lever', 'node', 'ice', 'crate', 'platform', 'fan', 'emitter', 'mirror',
  'prism', 'receiver', 'crystal', 'field', 'saw', 'checkpoint', 'exit', 'gate', 'sign',
];

/** Objects that produce a boolean signal other objects can listen to. */
export const ACTIVATOR_TYPES: readonly ObjType[] = ['plate', 'lever', 'node', 'receiver', 'crystal'];
/** Objects whose behaviour is driven by a `when` signal expression. */
export const TARGET_TYPES: readonly ObjType[] = ['door', 'platform', 'fan', 'emitter', 'field', 'saw'];

export interface ObjectProps {
  type: ObjType;
  /** Stable id; defaults to the legend character. */
  id?: string;
  /** Signal sources (ids) this target listens to. */
  when?: string[];
  /** 'all' (default) requires every source; 'any' needs one. */
  mode?: 'all' | 'any';
  /** Invert the evaluated signal. */
  invert?: boolean;
  /** Element restriction (node, lever, checkpoint, gate). */
  element?: ElementName;
  /** Direction (fan, emitter). */
  dir?: Dir;
  /** Path offset in tiles for platform/saw. */
  to?: [number, number];
  /** Path speed in tiles per second. */
  speed?: number;
  /** Platform/saw ping-pong continuously while active instead of toggling. */
  loop?: boolean;
  /** Lever/node auto-reset after N seconds. */
  timer?: number;
  /** Node stays active only while touched. */
  hold?: boolean;
  /** Door stays open permanently once its signal is true. */
  latch?: boolean;
  /** Door visual style. A 'bridge' is solid-or-not rather than sliding. */
  style?: 'door' | 'bridge';
  /** Mirror orientation: 0 = '/', 1 = '\'. */
  orient?: 0 | 1;
  /** Mirror cannot be rotated. */
  fixed?: boolean;
  /** Sign text. */
  text?: string;
}

export interface LevelDef {
  schemaVersion: 1;
  levelId: string;
  world: number;
  index: number;
  name: string;
  /** One-sentence objective shown in the HUD. */
  objective: string;
  /** Short teaching tip for this level. */
  tip: string;
  /** Par time in seconds (for the time star). */
  par: number;
  grid: string[];
  legend: Record<string, ObjectProps>;
}

export interface WorldInfo {
  id: number;
  name: string;
  tagline: string;
}

export const WORLDS: readonly WorldInfo[] = [
  { id: 1, name: 'Elemental Caverns', tagline: 'Learn what you can touch.' },
  { id: 2, name: 'Machineworks', tagline: 'Gears, crates and counterweights.' },
  { id: 3, name: 'Light Temple', tagline: 'Bend the beam, share the light.' },
  { id: 4, name: 'Sky Vault', tagline: 'Ride the wind, close the circuit.' },
];
