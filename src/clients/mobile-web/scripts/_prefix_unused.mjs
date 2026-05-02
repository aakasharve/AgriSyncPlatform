// Prefix unused-vars warnings' identifiers with `_` to satisfy the
// argsIgnorePattern/varsIgnorePattern config. Reads eslint JSON from stdin.
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(0,'utf8'));
const norm = p => p.replace(/\\/g,'/');
const RULE = '@typescript-eslint/no-unused-vars';

// Group by file so we apply edits per-file in reverse line order (preserves col offsets).
const byFile = new Map();
for (const f of data) {
  for (const m of f.messages) {
    if (m.ruleId === RULE) {
      const arr = byFile.get(f.filePath) || [];
      arr.push({ line: m.line, col: m.column, msg: m.message });
      byFile.set(f.filePath, arr);
    }
  }
}

let changedFiles = 0;
let touchedSites = 0;
let skipped = 0;

for (const [fp, sites] of byFile) {
  let src = readFileSync(fp, 'utf8');
  const lines = src.split('\n');
  // Sort sites in reverse line+col order so edits don't shift earlier offsets.
  sites.sort((a,b) => b.line - a.line || b.col - a.col);

  let changedThisFile = 0;
  for (const s of sites) {
    const idx = s.line - 1;
    if (idx < 0 || idx >= lines.length) { skipped++; continue; }
    const line = lines[idx];
    const colIdx = s.col - 1;
    // Find the identifier starting at colIdx (run of \w characters).
    const match = line.slice(colIdx).match(/^([A-Za-z][A-Za-z0-9]*)/);
    if (!match) { skipped++; continue; }
    const name = match[1];
    // Skip if already prefixed (race-safe).
    if (name.startsWith('_')) { skipped++; continue; }
    // Replace in-place at the column. Only the FIRST occurrence at this col.
    lines[idx] = line.slice(0, colIdx) + '_' + name + line.slice(colIdx + name.length);
    changedThisFile++;
    touchedSites++;
  }
  if (changedThisFile > 0) {
    writeFileSync(fp, lines.join('\n'));
    changedFiles++;
  }
}

console.log(`prefixed: ${touchedSites} sites across ${changedFiles} files (skipped ${skipped})`);
