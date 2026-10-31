// Single source of truth for simulation timing and movement tuning.
// Both the authoritative server and the predicting client import these values,
// so never duplicate a magic number elsewhere.

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const TICK_MS = 1000 / TICK_HZ;

export const TILE = 32;

/** Logical viewport the camera is framed around (16:9). */
export const VIEW_W = 1024;
export const VIEW_H = 576;

export const PlayerTuning = {
  bodyW: 20,
  bodyH: 28,
  maxSpeed: 220,
  groundAccel: 1600,
  groundDecel: 1900,
  airAccel: 900,
  airDecel: 500,
  jumpVelocity: 470,
  gravity: 1200,
  /** Extra gravity multiplier while rising with jump released (variable jump height). */
  jumpCutGravity: 2.6,
  maxFallSpeed: 640,
  coyoteTicks: 6, // 100 ms
  jumpBufferTicks: 7, // ~120 ms
  pushSpeed: 120,
  deathTicks: 50,
  interactReach: 14,
} as const;

export const CrateTuning = {
  size: 30,
  gravity: 1200,
  maxFallSpeed: 640,
  friction: 2400,
} as const;

export const WorldTuning = {
  /** Resonance Link maximum length in world px. */
  linkRange: 288,
  fanAccel: 2700,
  fanMaxSpeed: 330,
  /** Horizontal turbines can carry you faster than you can run. */
  fanMaxSpeedH: 400,
  doorSpeed: 2.6, // progress units per second
  bridgeSpeed: 6,
  iceMeltTicks: 24,
  exitHoldTicks: 30,
  /** Looping platforms pause this long at each end so riders can step on/off. */
  loopDwellTicks: 50,
  /** Ticks before an out-of-bounds crate is returned to its spawn. */
  crateRespawnTicks: 1,
} as const;

export const NetTuning = {
  /** Server state patch interval (ms) — 20 Hz. */
  patchMs: 50,
  /** Client sends batched inputs every N simulation ticks. */
  inputBatchTicks: 2,
  maxInputsPerMessage: 16,
  maxQueuedInputs: 30,
  /** If more than this many inputs are buffered server-side, skip ahead. */
  queueSoftLimit: 4,
  reconnectGraceSeconds: 45,
  countdownTicksStart: 180,
  countdownTicksRestart: 60,
} as const;

export const ROOM_NAME = 'duality';
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const MAX_NAME_LENGTH = 16;
