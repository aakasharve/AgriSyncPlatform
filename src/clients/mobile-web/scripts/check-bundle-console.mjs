#!/usr/bin/env node
/**
 * F24 - does a BUILT web folder still carry console calls?
 *
 *   node scripts/check-bundle-console.mjs <dist-folder> none   # production build: expects ZERO console calls, exit 1 if any
 *   node scripts/check-bundle-console.mjs <dist-folder> some   # fieldtest build: expects the console to be kept, exit 1 if none
 *
 * It scans every .js file under the folder for `console.<method>(` and `debugger` (the two things `esbuild.drop` removes) and
 * prints a count per method. Build into a scratch folder, e.g.
 *   VITE_AGRISYNC_API_URL=https://api.example.test npx vite build --outDir <scratch>/prod --emptyOutDir
 *   VITE_AGRISYNC_API_URL=https://api.example.test npx vite build --mode fieldtest --outDir <scratch>/ft --emptyOutDir
 * No dependencies. The pattern matches a call, not the word "console" inside a string or comment.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [dir, expectation] = process.argv.slice(2);
if (!dir || !['none', 'some'].includes(expectation)) {
    console.error('usage: node scripts/check-bundle-console.mjs <dist-folder> <none|some>');
    process.exit(2);
}

const METHODS = '(log|debug|info|warn|error|trace|dir|table|group|groupEnd|time|timeEnd|assert)';
// A bare `console.x(`: what `esbuild.drop` removes. Not `window.console.x(` / `t.console.x(` (a property of something else).
const CALL = new RegExp(`(?<![\\w$.])console\\s*\\.\\s*${METHODS}\\s*\\(`, 'g');
// `<something>.console.x(` - a library reaching the console through the window. `drop` cannot see these; reported, never failed on.
const INDIRECT = new RegExp(`[\\w$)\\]]\\s*\\.\\s*console\\s*\\.\\s*${METHODS}\\s*\\(`, 'g');
const DEBUGGER = /(^|[;{}\s])debugger\s*[;}]/g;

function* jsFiles(folder) {
    for (const name of readdirSync(folder)) {
        const full = join(folder, name);
        const st = statSync(full);
        if (st.isDirectory()) yield* jsFiles(full);
        else if (/\.(m?js)$/.test(name)) yield full;
    }
}

const byMethod = {};
const indirect = {};
let debuggers = 0;
let files = 0;
for (const file of jsFiles(dir)) {
    files += 1;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(CALL)) byMethod[m[1]] = (byMethod[m[1]] ?? 0) + 1;
    const viaWindow = [...text.matchAll(INDIRECT)].length;
    if (viaWindow) indirect[file.replace(dir, '').replace(/^[\\/]/, '')] = viaWindow;
    debuggers += [...text.matchAll(DEBUGGER)].length;
}

const total = Object.values(byMethod).reduce((a, b) => a + b, 0);
console.log(`scanned ${files} .js files in ${dir}`);
console.log(`console calls: ${total}${total ? '  ' + JSON.stringify(byMethod) : ''}; debugger statements: ${debuggers}`);
if (Object.keys(indirect).length) {
    console.log(`via window.console (a library's own, which drop cannot remove; not counted): ${JSON.stringify(indirect)}`);
}

if (files === 0) { console.error('FAIL: no .js files found - wrong folder?'); process.exit(2); }
if (expectation === 'none' && (total > 0 || debuggers > 0)) { console.error('FAIL: expected a bundle with NO console calls or debugger statements.'); process.exit(1); }
if (expectation === 'some' && total === 0) { console.error('FAIL: expected the console to be kept in this bundle, but it has none.'); process.exit(1); }
console.log(`OK: ${expectation === 'none' ? 'no console calls, no debugger' : 'console kept, as expected'}.`);
