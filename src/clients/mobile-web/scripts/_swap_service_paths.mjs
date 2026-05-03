// Swap legacy services/{harvestService,procurementRepository} import paths
// to their new feature locations. Pure string substitution — same number
// of `../` because services/ and features/{finance,procurement}/ both sit
// one directory below src/.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PAIRS = [
  ['services/harvestService', 'features/finance/harvestService'],
  ['services/procurementRepository', 'features/procurement/procurementRepository'],
];

const files = execSync(
  'git grep -l "services/harvestService\\|services/procurementRepository" -- "src/clients/mobile-web/src/**/*.ts" "src/clients/mobile-web/src/**/*.tsx"',
  { encoding: 'utf8', cwd: process.cwd() }
).trim().split('\n').filter(Boolean);

let total = 0;
for (const f of files) {
  let src = readFileSync(f, 'utf8');
  let count = 0;
  for (const [oldP, newP] of PAIRS) {
    const re = new RegExp(oldP.replace(/\//g, '\\/'), 'g');
    const hits = (src.match(re) || []).length;
    src = src.replace(re, newP);
    count += hits;
  }
  if (count > 0) {
    writeFileSync(f, src);
    console.log(`  ${count} swap${count > 1 ? 's' : ''} in ${f}`);
    total += count;
  }
}
console.log(`total: ${total} import-path swaps across ${files.length} files`);
