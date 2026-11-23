#!/usr/bin/env node
// scripts/check-preview-absent.mjs
// spec: voice-flow-v2-2026-11-23 (Task 13, review L1) — the dev-only `?preview=oversight` harness and its fixtures must
// not ship. They are reachable only through `IS_OVERSIGHT_PREVIEW_ENABLED` (`import.meta.env.DEV`) + `React.lazy` in
// `App.tsx`, so a non-dev `vite build` drops them; this proves it on a real build output.
//
// Usage (after a build):  node scripts/check-preview-absent.mjs [distDir=dist]
//   e.g. VITE_AGRISYNC_API_URL=http://localhost:5048 VITE_VOICE_FLOW_V2=1 npm run build:fieldtest && node scripts/check-preview-absent.mjs
//
// Each fixture string is searched for as written AND as the minifier may escape it (\uXXXX), and a string that DOES
// ship (the v2 mic card's title) must be found the same way — otherwise a miss would prove nothing.
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');

/** Strings that exist only in the preview harness and its fixtures. */
const MUST_BE_ABSENT = [
    'मागच्या बाजूचं उद्या बघू', // voiceFlowV2Fixtures: the unclear phrase
    'log-v2-pawar-earlier', // voiceFlowV2Fixtures: the earlier recording's id
    'PREVIEW — seeded data, not a real farm', // OversightAppPreview's banner
    'Bhosale Vasti', // previewAppFixtures: the second farm
];
/** A string that ships in the same bundles (voiceFlowWords `cardTitle`): the search must be able to find it. */
const MUST_BE_PRESENT = 'आता बोला';

const escaped = (s) => [...s].map(ch => (ch.charCodeAt(0) > 0x7e ? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}` : ch)).join('');
const forms = (s) => [...new Set([s, escaped(s), escaped(s).toUpperCase().replace(/\\U/g, '\\u')])];

async function files(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...await files(path));
        else if (['.js', '.mjs', '.html', '.css'].includes(extname(entry.name))) out.push(path);
    }
    return out;
}

const all = await files(dist).catch(() => []);
if (all.length === 0) {
    console.error(`check-preview-absent: no built files under ${dist} (build first).`);
    process.exit(2);
}
const texts = await Promise.all(all.map(async f => [f, await readFile(f, 'utf8')]));
const where = (s) => texts.filter(([, t]) => forms(s).some(form => t.includes(form))).map(([f]) => f);

let failed = false;
if (where(MUST_BE_PRESENT).length === 0) {
    console.error(`check-preview-absent: the control string "${MUST_BE_PRESENT}" was not found — the search cannot be trusted.`);
    failed = true;
}
for (const s of MUST_BE_ABSENT) {
    const hits = where(s);
    if (hits.length > 0) {
        console.error(`check-preview-absent: "${s}" ships in ${hits.join(', ')}`);
        failed = true;
    }
}
if (failed) process.exit(1);
console.log(`check-preview-absent: OK — ${MUST_BE_ABSENT.length} preview-only strings absent from ${all.length} built files; control string present.`);
