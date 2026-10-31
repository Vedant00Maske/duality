// Per-device preferences and progress, persisted in localStorage.

export interface Settings {
  name: string;
  music: number;
  sfx: number;
  touch: 'auto' | 'on' | 'off';
  reducedMotion: boolean;
  debug: boolean;
  /** 'sprites' = pixel-art sprite sheets (default); 'classic' = procedural fallback. */
  charArt: 'classic' | 'sprites';
  /** Mutes all audio without losing the volume levels. */
  mute: boolean;
  /** Bumped when a default changes in a way that should override stale saved values. */
  settingsVersion: number;
}

const SETTINGS_VERSION = 2;

const KEY = 'duality.settings.v1';
const PROGRESS_KEY = 'duality.progress.v1';

const defaults: Settings = {
  name: '',
  music: 45,
  sfx: 75,
  touch: 'auto',
  reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  debug: false,
  charArt: 'sprites',
  mute: false,
  settingsVersion: SETTINGS_VERSION,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}

export const settings: Settings = read(KEY, defaults);
// v1 saved charArt:'classic' implicitly (it was the default); move everyone to the final pixel art once.
if (settings.settingsVersion !== SETTINGS_VERSION) {
  settings.charArt = 'sprites';
  settings.settingsVersion = SETTINGS_VERSION;
  write(KEY, settings);
}

// `?art=sprites` / `?art=classic` switches character rendering (handy for testing).
try {
  const art = new URLSearchParams(location.search).get('art');
  if (art === 'sprites' || art === 'classic') settings.charArt = art;
} catch { /* non-browser */ }
const listeners = new Set<() => void>();

export function saveSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  write(KEY, settings);
  listeners.forEach((l) => l());
}

export function onSettings(fn: () => void): void {
  listeners.add(fn);
}

export interface Best {
  stars: number;
  ticks: number;
}

export const progress: Record<string, Best> = read(PROGRESS_KEY, {} as Record<string, Best>);

export function recordBest(levelId: string, stars: number, ticks: number): void {
  const prev = progress[levelId];
  if (!prev || stars > prev.stars || (stars === prev.stars && ticks < prev.ticks)) {
    progress[levelId] = { stars, ticks };
    write(PROGRESS_KEY, progress);
  }
}

export function isTouchDevice(): boolean {
  return typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
}

export function touchEnabled(): boolean {
  if (settings.touch === 'on') return true;
  if (settings.touch === 'off') return false;
  return isTouchDevice();
}
