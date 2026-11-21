// every R('...') string in flows.js must exist word for word in the repo source (proves "the app's own words")
const fs = require('fs'), path = require('path');
const REPO = 'E:/APPS/Running App Versions/AgriSyncPlatform/.claude/worktrees/plr-d10-ui-9a-4636d5/src/clients/mobile-web/src';
let corpus = '';
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name === 'node_modules' || f.name === '__tests__') continue; walk(p); } else if (/\.(ts|tsx|json|md)$/.test(f.name)) corpus += fs.readFileSync(p, 'utf8') + '\n'; } })(REPO);
try { (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(md|json)$/.test(f.name)) corpus += fs.readFileSync(p, 'utf8') + '\n'; } })(path.join(REPO, '..', 'public')); } catch (e) { /* no public folder */ }
const src = fs.readFileSync('src/flows.js', 'utf8');
const re = /\bR\('((?:[^'\\]|\\.)*)'\)/g;
let m, bad = [], n = 0;
while ((m = re.exec(src))) { if (m[1] === '') continue; n++; const s = m[1].replace(/\\'/g, "'"); if (!corpus.includes(s)) bad.push(s); }
console.log('R strings checked:', n, ' missing:', bad.length);
bad.forEach(b => console.log('  MISSING:', b));
