// Validates character sprite sheets against apps/web/src/art/characters/spec.json.
// The same checks apply to placeholders and final art.
// Usage: node tools/asset-audit.mjs   (exit code 1 on errors)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './art/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CHAR_DIR = path.resolve(here, '../apps/web/src/art/characters');

export function auditCharacterSheet(name, dir = CHAR_DIR, specPath = path.join(CHAR_DIR, 'spec.json')) {
  const errors = [];
  const warnings = [];
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const json = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  const { w: FW, h: FH } = spec.frame;
  const meta = json.meta ?? {};
  const imgPath = path.join(dir, meta.image ?? `${name}.png`);
  if (!fs.existsSync(imgPath)) return { errors: [`missing image ${imgPath}`], warnings };
  const png = decodePNG(fs.readFileSync(imgPath));
  if (meta.size && (meta.size.w !== png.width || meta.size.h !== png.height)) {
    errors.push(`meta.size ${meta.size.w}x${meta.size.h} != PNG ${png.width}x${png.height}`);
  }
  if (png.width > 2048 || png.height > 2048) errors.push(`sheet ${png.width}x${png.height} exceeds 2048x2048`);

  const frames = json.frames;
  if (!Array.isArray(frames)) return { errors: [...errors, 'frames must be an array (Aseprite "json-array" export)'], warnings };
  const alphaAt = (x, y) => png.rgba[(y * png.width + x) * 4 + 3];
  // Optional palette (<name>.palette.json next to the sheet): every opaque pixel must use it.
  const palPath = path.join(dir, `${name}.palette.json`);
  const palette = fs.existsSync(palPath)
    ? new Set(Object.values(JSON.parse(fs.readFileSync(palPath, 'utf8'))).map((p) => p.hex.toLowerCase()))
    : null;
  const hexAt = (x, y) => { const o = (y * png.width + x) * 4; return '#' + [0, 1, 2].map((k) => png.rgba[o + k].toString(16).padStart(2, '0')).join(''); };

  frames.forEach((f, i) => {
    const where = `frame ${i}`;
    if (f.filename !== String(i)) errors.push(`${where}: filename must be "${i}" (export with --filename-format "{frame}")`);
    if (f.frame.w !== FW || f.frame.h !== FH) errors.push(`${where}: size ${f.frame.w}x${f.frame.h}, expected ${FW}x${FH}`);
    if (f.rotated) errors.push(`${where}: rotated frames are not allowed`);
    if (f.trimmed) errors.push(`${where}: trimmed frames are not allowed (pivot must stay fixed)`);
    if (!(f.duration > 0)) errors.push(`${where}: missing duration`);
    const { x, y, w, h } = f.frame;
    if (x < 0 || y < 0 || x + w > png.width || y + h > png.height) { errors.push(`${where}: outside the sheet`); return; }
    let soft = 0, opaque = 0, onBaseline = 0, minX = FW, maxX = -1, offPalette = 0;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const a = alphaAt(x + xx, y + yy);
        if (a !== 0 && a !== 255) soft++;
        if (a === 255) {
          opaque++;
          if (palette && !palette.has(hexAt(x + xx, y + yy))) offPalette++;
          if (yy === spec.baseline) onBaseline++;
          minX = Math.min(minX, xx); maxX = Math.max(maxX, xx);
        }
      }
    }
    if (soft) errors.push(`${where}: ${soft} semi-transparent pixels (use hard alpha 0/255)`);
    if (offPalette) errors.push(`${where}: ${offPalette} pixels outside ${name}.palette.json`);
    // A filled background would make the frame corners opaque.
    if ([[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].some(([cx, cy]) => alphaAt(x + cx, y + cy) !== 0)) {
      errors.push(`${where}: opaque frame corner (background pixels?)`);
    }
    f._opaque = opaque;
    f._baseline = onBaseline;
    f._width = maxX >= minX ? maxX - minX + 1 : 0;
  });

  // Frames must not overlap (padding between frames).
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i].frame, b = frames[j].frame;
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) errors.push(`frames ${i} and ${j} overlap`);
    }
  }

  const tags = new Map((meta.frameTags ?? []).map((t) => [t.name, t]));
  for (const a of spec.animations) {
    const t = tags.get(a.tag);
    if (!t) { errors.push(`missing animation tag "${a.tag}"`); continue; }
    const count = t.to - t.from + 1;
    if (count !== a.frames) errors.push(`tag "${a.tag}" has ${count} frames, expected ${a.frames}`);
    if (t.direction !== 'forward') warnings.push(`tag "${a.tag}" direction is ${t.direction}`);
    let total = 0;
    for (let k = t.from; k <= t.to; k++) {
      const f = frames[k];
      if (!f) { errors.push(`tag "${a.tag}" references missing frame ${k}`); continue; }
      total += f.duration;
      const grounded = a.tag !== 'death' && a.tag !== 'respawn' && a.tag !== 'jump_rise' && a.tag !== 'fall';
      if (grounded && !f._baseline) errors.push(`tag "${a.tag}" frame ${k}: nothing on the baseline row ${spec.baseline} (feet must touch y=${spec.baseline})`);
      if (f._width > spec.hitbox.w + 8) warnings.push(`tag "${a.tag}" frame ${k}: silhouette ${f._width}px wide (hitbox ${spec.hitbox.w}px) may make hits look unfair`);
      if (!f._opaque && a.tag !== 'death') warnings.push(`tag "${a.tag}" frame ${k} is empty`);
    }
    if (a.tag === 'death' && total > spec.maxDeathMs) errors.push(`death lasts ${total}ms; must be <= ${spec.maxDeathMs}ms (simulation death time)`);
  }
  for (const name2 of tags.keys()) if (!spec.animations.some((a) => a.tag === name2)) warnings.push(`unknown extra tag "${name2}"`);
  return { errors, warnings, frames: frames.length, tags: [...tags.keys()], paletteChecked: !!palette };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Optional: --dir <folder> [names...] audits sheets elsewhere (e.g. art-src) against the game's spec.
  const args = process.argv.slice(2);
  const di = args.indexOf('--dir');
  const dir = di >= 0 ? path.resolve(args[di + 1]) : CHAR_DIR;
  const names = args.filter((a, i) => a !== '--dir' && i !== di + 1);
  let failed = 0;
  for (const name of names.length ? names : ['ember', 'tide']) {
    const { errors, warnings } = auditCharacterSheet(name, dir);
    console.log(`${errors.length ? 'FAIL' : 'ok  '} ${name}`);
    for (const e of errors) console.log(`  error: ${e}`);
    for (const w of warnings) console.log(`  warn:  ${w}`);
    failed += errors.length;
  }
  process.exit(failed ? 1 : 0);
}
