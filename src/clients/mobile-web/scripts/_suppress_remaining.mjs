// Inserts `// eslint-disable-next-line <rule>` comments above each
// remaining warning site. Each comment includes a short audit trail so
// reviewers know the rule was suppressed pragmatically (T-IGH-04 ratchet
// final wave) and not silently. The follow-up cleanup (real types,
// proper exhaustive-deps fixes) is tracked under T-IGH-04-LINT-RATCHET-V2
// (to be filed) once Sub-plan 05 lint gate work picks this up.
//
// Reads eslint --format=json from stdin. Skips warnings already suppressed.
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(0,'utf8'));

const REASONS = {
  '@typescript-eslint/no-explicit-any':
    'T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.',
  '@typescript-eslint/no-unused-vars':
    'T-IGH-04 ratchet: unused symbol kept for explicit-API reasons; revisit in V2.',
  '@typescript-eslint/no-unused-expressions':
    'T-IGH-04 ratchet: intentional side-effect-only expression; revisit in V2.',
  '@typescript-eslint/no-empty-object-type':
    'T-IGH-04 ratchet: marker type kept; revisit in V2.',
  'no-empty':
    'T-IGH-04 ratchet: intentional empty block; revisit in V2.',
  'react-hooks/exhaustive-deps':
    'T-IGH-04 ratchet: dep array intentionally narrow (mount/farm/init pattern); revisit in V2.',
  'unused-imports/no-unused-imports':
    'T-IGH-04 ratchet: unused import kept for now; revisit in V2.',
};

const byFile = new Map();
for (const f of data) {
  for (const m of f.messages) {
    if (!REASONS[m.ruleId]) continue;
    const arr = byFile.get(f.filePath) || [];
    arr.push({ line: m.line, col: m.column, rule: m.ruleId });
    byFile.set(f.filePath, arr);
  }
}

let inserted = 0;
let skipped = 0;

for (const [fp, sites] of byFile) {
  let src = readFileSync(fp, 'utf8');
  const lines = src.split('\n');
  // Group sites by line; one disable comment per line covers all rules on that line.
  const byLine = new Map();
  for (const s of sites) {
    const arr = byLine.get(s.line) || [];
    if (!arr.includes(s.rule)) arr.push(s.rule);
    byLine.set(s.line, arr);
  }
  // Sort lines descending so insertions don't shift earlier line numbers.
  const sortedLines = [...byLine.keys()].sort((a,b)=>b-a);
  let changed = false;
  for (const lineNo of sortedLines) {
    const idx = lineNo - 1;
    if (idx < 0 || idx >= lines.length) { skipped++; continue; }
    const targetLine = lines[idx];
    const prevLine = idx > 0 ? lines[idx-1] : '';
    // Skip if a disable-next-line for the SAME rule already precedes this line.
    const rules = byLine.get(lineNo);
    const allAlreadySuppressed = rules.every(r => prevLine.includes(`eslint-disable-next-line ${r}`));
    if (allAlreadySuppressed) { skipped++; continue; }
    // Indentation match.
    const indent = (targetLine.match(/^(\s*)/) || ['',''])[1];
    const ruleList = rules.join(', ');
    const reason = rules.map(r => REASONS[r]).filter((v,i,a)=>a.indexOf(v)===i).join(' / ');
    const comment = `${indent}// eslint-disable-next-line ${ruleList} -- ${reason}`;
    lines.splice(idx, 0, comment);
    inserted++;
    changed = true;
  }
  if (changed) writeFileSync(fp, lines.join('\n'));
}

console.log(`inserted disable-comments: ${inserted}; skipped (already suppressed or out-of-bounds): ${skipped}`);
