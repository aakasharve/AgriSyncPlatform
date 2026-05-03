// For each no-explicit-any site, try replacing the literal `any` token at
// the reported column with `unknown`. Skips sites where the surrounding
// context isn't a plain type annotation (e.g. `as any` casts).
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(0,'utf8'));
const RULE = '@typescript-eslint/no-explicit-any';

const byFile = new Map();
for (const f of data) {
  for (const m of f.messages) {
    if (m.ruleId === RULE) {
      const arr = byFile.get(f.filePath) || [];
      arr.push({ line: m.line, col: m.column });
      byFile.set(f.filePath, arr);
    }
  }
}

let touched = 0, skipped = 0;

for (const [fp, sites] of byFile) {
  let src = readFileSync(fp, 'utf8');
  const lines = src.split('\n');
  sites.sort((a,b) => b.line - a.line || b.col - a.col);
  let changed = false;
  for (const s of sites) {
    const idx = s.line - 1;
    const line = lines[idx];
    const colIdx = s.col - 1;
    // Match `any` at the reported column (must be a word boundary).
    const head = line.slice(0, colIdx);
    const tail = line.slice(colIdx);
    if (!/^any\b/.test(tail)) { skipped++; continue; }
    // Skip `as any` casts — too risky to blindly swap to `as unknown`.
    if (/\bas\s*$/.test(head)) { skipped++; continue; }
    lines[idx] = head + 'unknown' + tail.slice(3);
    touched++;
    changed = true;
  }
  if (changed) writeFileSync(fp, lines.join('\n'));
}
console.log(`swapped any→unknown: ${touched} sites; skipped ${skipped} ('as any' or non-token)`);
