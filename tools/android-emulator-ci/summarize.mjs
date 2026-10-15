// Merge every leg's results.json into one matrix (markdown + json). Usage:
//   node summarize.mjs <dir containing */results.json> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { matrixMarkdown, totalFailures, counts, BANNER } from './lib/results.mjs';

const [, , inDir, outDir] = process.argv;
if (!inDir || !outDir) { console.error('usage: summarize.mjs <inDir> <outDir>'); process.exit(64); }
fs.mkdirSync(outDir, { recursive: true });

const legs = [];
const walk = (d, depth) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory() && depth < 3) walk(f, depth + 1);
    else if (e.name === 'results.json' && !f.includes('attempt1-died')) legs.push(JSON.parse(fs.readFileSync(f, 'utf8')));
  }
};
walk(inDir, 0);
legs.sort((a, b) => a.leg.name.localeCompare(b.leg.name));
if (!legs.length) { console.error('no leg results found'); process.exit(3); }

const md = matrixMarkdown(legs) + '\n';
fs.writeFileSync(path.join(outDir, 'MATRIX.md'), md);
fs.writeFileSync(path.join(outDir, 'all-results.json'), JSON.stringify({ banner: BANNER, legs }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

const failed = totalFailures(legs);
const fatal = legs.filter((l) => l.fatal && !l.leg.informational);
console.log(`legs=${legs.length} failures=${failed} fatalLegs=${fatal.length}`);
for (const l of legs) console.log(l.leg.name, JSON.stringify(counts(l.checks)));
// Red run = at least one check FAILED (an app finding) or a leg's driver crashed. UNVERIFIED does not turn it red.
process.exit(failed > 0 || fatal.length > 0 ? 1 : 0);
