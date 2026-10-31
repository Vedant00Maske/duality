// Identity check: in every frame that shows Ember's body, find the face
// (master rows 15–25) at its best whole-pixel offset and report how many face
// pixels match the master exactly. Also verifies the APNG previews' structure.
// Usage: node tools/art/check-identity.mjs
import fs from 'node:fs';
import { decodePNG } from './png.mjs';

const dir = 'art-src/ember/final';
const atlas = decodePNG(fs.readFileSync(`${dir}/ember.png`));
const json = JSON.parse(fs.readFileSync(`${dir}/ember.json`, 'utf8'));
const master = decodePNG(fs.readFileSync('art-src/ember/ember_master.png'));
const W = 32, H = 40;
const mpx = (x, y) => { const o = (y * W + x) * 4; return master.rgba[o + 3] ? `${master.rgba[o]},${master.rgba[o + 1]},${master.rgba[o + 2]}` : null; };
const face = [];
for (let y = 15; y <= 25; y++) for (let x = 14; x <= 25; x++) { const c = mpx(x, y); if (c) face.push([x, y, c]); }

const rows = [];
for (const tag of json.meta.frameTags) {
  for (let i = tag.from; i <= tag.to; i++) {
    const f = json.frames[i].frame;
    const apx = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return null; const o = ((f.y + y) * atlas.width + f.x + x) * 4; return atlas.rgba[o + 3] ? `${atlas.rgba[o]},${atlas.rgba[o + 1]},${atlas.rgba[o + 2]}` : null; };
    let best = { m: 0, dx: 0, dy: 0 };
    for (let dy = -3; dy <= 8; dy++) for (let dx = -3; dx <= 3; dx++) {
      let m = 0;
      for (const [x, y, c] of face) if (apx(x + dx, y + dy) === c) m++;
      if (m > best.m) best = { m, dx, dy };
    }
    rows.push({ tag: tag.name, frame: i - tag.from + 1, faceMatch: +(best.m / face.length * 100).toFixed(1), offset: [best.dx, best.dy] });
  }
}
console.log('frame                face match vs master   head offset');
for (const r of rows) console.log(`${(r.tag + '[' + r.frame + ']').padEnd(20)} ${String(r.faceMatch).padStart(6)}%               ${JSON.stringify(r.offset)}`);

for (const tag of json.meta.frameTags) {
  const buf = fs.readFileSync(`${dir}/previews/${tag.name}.apng.png`);
  let o = 8, fctl = 0, fdat = 0, actl = 0;
  while (o < buf.length) { const len = buf.readUInt32BE(o); const t = buf.toString('ascii', o + 4, o + 8); if (t === 'fcTL') fctl++; if (t === 'fdAT') fdat++; if (t === 'acTL') actl = buf.readUInt32BE(o + 8); o += 12 + len; }
  const n = tag.to - tag.from + 1;
  if (actl !== n || fctl !== n || fdat !== n - 1) throw new Error(`${tag.name} APNG malformed: acTL ${actl} fcTL ${fctl} fdAT ${fdat}`);
}
console.log('APNG previews: structure OK for all 9 animations');
