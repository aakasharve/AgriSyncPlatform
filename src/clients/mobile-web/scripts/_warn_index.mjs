import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(0,'utf8'));
const norm = p => p.replace(/\\/g,'/');
const RULE = process.argv[2];
const out = [];
for (const f of data) {
  for (const m of f.messages) {
    if (m.ruleId === RULE) {
      const rel = norm(f.filePath).replace(/.*\/src\//,'src/');
      out.push({ file: rel, line: m.line, col: m.column, msg: m.message });
    }
  }
}
out.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line);
for (const w of out) console.log(`${w.file}:${w.line}:${w.col} ${w.msg}`);
console.log('---total:',out.length);
