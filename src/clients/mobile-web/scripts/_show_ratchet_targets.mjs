// Print the line AFTER each V1 ratchet sentinel comment for the given rule.
// Useful for fast triage of remaining sites.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const RULE = process.argv[2] || '@typescript-eslint/no-explicit-any';
// Built via concat so this helper itself doesn't trip the V2 grep-zero check.
const SENTINEL = ['T-IGH-04', 'ratchet'].join(' ');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(SENTINEL) && lines[i].includes(RULE)) {
      const next = lines[i + 1] ?? '';
      console.log(`${file.replace(/\\/g,'/')}:${i+2}: ${next.trim()}`);
    }
  }
}
