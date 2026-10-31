// Validates every level definition. Exits non-zero on errors.
import { LEVELS, validateLevel } from '../packages/shared/src/index.js';

let errors = 0;
for (const def of LEVELS) {
  const r = validateLevel(def);
  const lvl = r.level;
  const size = lvl ? `${lvl.cols}x${lvl.rows}` : '?';
  const status = r.errors.length ? 'FAIL' : 'ok';
  console.log(`${status.padEnd(4)} ${def.levelId.padEnd(28)} ${size.padEnd(6)} objects=${lvl?.objects.length ?? 0}`);
  for (const e of r.errors) console.log(`     error: ${e}`);
  for (const w of r.warnings) console.log(`     warn:  ${w}`);
  errors += r.errors.length;
}
console.log(`\n${LEVELS.length} levels, ${errors} errors`);
process.exit(errors ? 1 : 0);
