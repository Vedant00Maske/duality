import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
// @ts-expect-error — plain ESM tooling module without type declarations
import { auditCharacterSheet } from '../../tools/asset-audit.mjs';
// @ts-expect-error — plain ESM tooling module without type declarations
import { decodePNG } from '../../tools/art/png.mjs';
const decodePNGFile = (p: string): { width: number; height: number; rgba: Uint8Array } => decodePNG(fs.readFileSync(p));
const dims = (i: { width: number; height: number }) => [i.width, i.height];

const spec = JSON.parse(fs.readFileSync('apps/web/src/art/characters/spec.json', 'utf8'));

describe('production character sprite sheets match the spec', () => {
  for (const name of ['ember', 'tide']) {
    it(`${name}: passes the asset audit (dimensions, hard alpha, baseline, trimming, palette, death timing)`, () => {
      const r = auditCharacterSheet(name) as { errors: string[]; warnings: string[]; frames: number; tags: string[]; paletteChecked: boolean };
      expect(r.errors).toEqual([]);
      expect(r.paletteChecked).toBe(true);
      expect(r.frames).toBe(43);
      expect(r.tags).toEqual(spec.animations.map((a: { tag: string }) => a.tag));
    });
  }

  it('ships final art, not placeholders', () => {
    for (const name of ['ember', 'tide']) {
      const json = JSON.parse(fs.readFileSync(`apps/web/src/art/characters/${name}.json`, 'utf8'));
      expect(json.meta.version).toBe(`duality-${name}-1`);
    }
  });

  it('Ember and Tide are distinct artwork (not a recolour)', () => {
    const a = fs.readFileSync('apps/web/src/art/characters/ember.png');
    const b = fs.readFileSync('apps/web/src/art/characters/tide.png');
    expect(a.equals(b)).toBe(false);
    const pa = Object.values(JSON.parse(fs.readFileSync('apps/web/src/art/characters/ember.palette.json', 'utf8'))).map((p) => (p as { hex: string }).hex);
    const pb = Object.values(JSON.parse(fs.readFileSync('apps/web/src/art/characters/tide.palette.json', 'utf8'))).map((p) => (p as { hex: string }).hex);
    expect(pb).toContain('#3cc8ff');
    expect(pb).toContain('#a6f0ff');
    expect(pa.filter((h) => pb.includes(h) && h !== '#ffffff')).toEqual([]);
  });
});

describe('environment and object art', () => {
  const read = (p: string) => decodePNGFile(p);
  it('tilesets, liquids, backgrounds and objects have the documented sizes and hard alpha', () => {
    for (const w of [1, 2, 3, 4]) {
      expect(dims(read(`apps/web/src/art/tilesets/w${w}.png`))).toEqual([256, 128]);
      for (const l of ['sky', 'far', 'mid']) expect(dims(read(`apps/web/src/art/backgrounds/w${w}_${l}.png`))).toEqual([1024, 576]);
    }
    for (const n of ['lava', 'water', 'toxic']) expect(dims(read(`apps/web/src/art/liquids/${n}.png`))).toEqual([64, 80]);
    for (const p of ['apps/web/src/art/tilesets/w1.png', 'apps/web/src/art/objects/objects.png', 'apps/web/src/art/backgrounds/w3_mid.png']) {
      const { rgba } = read(p);
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0 && rgba[i] !== 255) throw new Error(`soft alpha in ${p}`);
    }
  });
  it('generators report no validation errors', () => {
    expect(JSON.parse(fs.readFileSync('art-src/worlds/validation.json', 'utf8')).errors).toEqual([]);
    expect(JSON.parse(fs.readFileSync('art-src/objects/validation.json', 'utf8')).errors).toEqual([]);
  });
});
