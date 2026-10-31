import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * One seat per element: slot 0 is Ember, slot 1 is Tide.
 * Player simulation fields are copied from the authoritative World just
 * before each patch (see DualityRoom.onBeforePatch).
 */
export const SlotState = schema({
  sid: t.string().default(''),
  name: t.string().default(''),
  ready: t.boolean().default(false),
  connected: t.boolean().default(false),
  vote: t.string().default(''),
  x: t.float64().default(0),
  y: t.float64().default(0),
  vx: t.float64().default(0),
  vy: t.float64().default(0),
  /** bit0 grounded, bit1 jumping */
  fl: t.uint8().default(0),
  face: t.int8().default(1),
  cy: t.uint8().default(0),
  jb: t.uint8().default(0),
  dead: t.uint8().default(0),
  held: t.uint8().default(0),
  gnd: t.int16().default(-1),
  rx: t.float64().default(0),
  ry: t.float64().default(0),
  deaths: t.uint16().default(0),
  /** Last input sequence number consumed by the simulation. */
  ack: t.uint32().default(0),
}, 'Slot');
export type SlotState = SchemaType<typeof SlotState>;

export const ObjState = schema({
  s: t.uint8().default(0),
  p: t.float64().default(0),
  x: t.float64().default(0),
  y: t.float64().default(0),
  vx: t.float64().default(0),
  vy: t.float64().default(0),
}, 'Obj');
export type ObjState = SchemaType<typeof ObjState>;

export const ResultState = schema({
  ticks: t.uint32().default(0),
  deaths: t.uint16().default(0),
  stars: t.uint8().default(0),
}, 'Result');
export type ResultState = SchemaType<typeof ResultState>;

export const RoomState = schema({
  phase: t.string().default('lobby'),
  level: t.string().default(''),
  /** Increments on every level (re)start so clients can discard stale data. */
  seq: t.uint16().default(0),
  host: t.string().default(''),
  tick: t.uint32().default(0),
  /** Countdown ticks remaining (countdown phase). */
  cd: t.uint16().default(0),
  paused: t.boolean().default(false),
  exitT: t.uint8().default(0),
  slots: t.array(SlotState),
  objs: t.array(ObjState),
  results: t.map(ResultState),
  lastTicks: t.uint32().default(0),
  lastDeaths: t.uint16().default(0),
  lastStars: t.uint8().default(0),
}, 'RoomState');
export type RoomState = SchemaType<typeof RoomState>;
