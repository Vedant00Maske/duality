// Character sprite-sheet manifest. Sheets are Aseprite "json-array" exports
// (PNG + JSON) described by ./characters/spec.json. Importing them through Vite
// gives content-hashed URLs, so updated art is never served from a stale cache.

import spec from './characters/spec.json';
import emberPng from './characters/ember.png';
import emberJson from './characters/ember.json';
import tidePng from './characters/tide.png';
import tideJson from './characters/tide.json';

export type CharAnim =
  | 'idle' | 'run' | 'jump_rise' | 'fall' | 'land' | 'push' | 'interact' | 'death' | 'respawn';

export const CHARACTER_SPEC = spec;

export const CHARACTER_SHEETS = [
  { key: 'ember', png: emberPng, json: emberJson },
  { key: 'tide', png: tidePng, json: tideJson },
] as const;

/** Texture key for player index 0 (Ember) / 1 (Tide). */
export const SHEET_KEY = ['ember', 'tide'] as const;

/** Whether each animation loops (others play once and hold their last frame). */
export const ANIM_LOOPS: Record<CharAnim, boolean> = Object.fromEntries(
  spec.animations.map((a) => [a.tag, a.loop]),
) as Record<CharAnim, boolean>;
