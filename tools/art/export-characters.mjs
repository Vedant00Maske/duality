// Copies validated character atlases from art-src/<name>/final into the game's
// production asset folder (imported through Vite, so filenames get content hashes),
// together with each palette (used by the asset audit; never imported by the game).
// Usage: node tools/art/export-characters.mjs
import fs from 'node:fs';

const DEST = 'apps/web/src/art/characters';
for (const name of ['ember', 'tide']) {
  for (const ext of ['png', 'json']) fs.copyFileSync(`art-src/${name}/final/${name}.${ext}`, `${DEST}/${name}.${ext}`);
  fs.copyFileSync(`art-src/${name}/palette.json`, `${DEST}/${name}.palette.json`);
  fs.mkdirSync('apps/web/src/art/ui', { recursive: true });
  fs.copyFileSync(`art-src/${name}/${name}_master.png`, `apps/web/src/art/ui/${name}_avatar.png`);
  console.log(`exported ${name}`);
}
