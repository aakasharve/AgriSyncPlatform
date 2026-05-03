// Temporary script: strip all "T-IGH-04 ratchet:" disable-comment lines
// from src/, so eslint can re-emit the underlying warnings, which we use
// to drive per-site fixes / reasons. Pair with `git restore src/` when done.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const PATTERN = /^.*T-IGH-04 ratchet:.*\r?\n/gm;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
      const txt = readFileSync(p, 'utf8');
      if (txt.includes('T-IGH-04 ratchet:')) {
        const next = txt.replace(PATTERN, '');
        writeFileSync(p, next);
      }
    }
  }
}
walk(ROOT);
console.log('stripped');
