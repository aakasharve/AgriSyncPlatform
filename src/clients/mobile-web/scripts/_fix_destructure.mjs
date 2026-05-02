// Fix destructure issues caused by _prefix_unused.mjs.
// When a property destructure renames its KEY (instead of binding alias),
// the result `{ _foo }` doesn't match the source object's property `foo`.
// This script reads typecheck errors of form "Property '_foo' does not exist"
// and rewrites the source from `{ ..., _foo, ... }` to `{ ..., foo: _foo, ... }`.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

let tscOut = '';
try {
  tscOut = execSync('npx tsc --noEmit -p .', { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
} catch (e) {
  tscOut = (e.stdout || '') + (e.stderr || '');
}

const lineRegex = /^(.+?)\((\d+),(\d+)\): error TS2339: Property '(_[A-Za-z][A-Za-z0-9]*)' does not exist on type/gm;

const fixes = []; // { file, line, col, name }
let m;
while ((m = lineRegex.exec(tscOut)) !== null) {
  fixes.push({ file: m[1], line: +m[2], col: +m[3], name: m[4] });
}

const byFile = new Map();
for (const f of fixes) {
  const arr = byFile.get(f.file) || [];
  arr.push(f);
  byFile.set(f.file, arr);
}

let touched = 0;
for (const [fp, sites] of byFile) {
  const src = readFileSync(fp, 'utf8');
  const lines = src.split('\n');
  // sort reverse to preserve column offsets
  sites.sort((a,b) => b.line - a.line || b.col - a.col);
  let changed = false;
  for (const s of sites) {
    const idx = s.line - 1;
    if (idx >= lines.length) continue;
    const line = lines[idx];
    const colIdx = s.col - 1;
    // Expect `_name` at colIdx; rewrite to `name: _name`.
    const namePart = line.slice(colIdx, colIdx + s.name.length);
    if (namePart !== s.name) continue;
    const original = s.name.slice(1); // strip leading `_`
    lines[idx] = line.slice(0, colIdx) + `${original}: ${s.name}` + line.slice(colIdx + s.name.length);
    changed = true;
    touched++;
  }
  if (changed) writeFileSync(fp, lines.join('\n'));
}

console.log(`destructure-key fixups: ${touched} sites across ${byFile.size} files`);
