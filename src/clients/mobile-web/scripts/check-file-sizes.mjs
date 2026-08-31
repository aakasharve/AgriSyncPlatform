#!/usr/bin/env node
// scripts/check-file-sizes.mjs
// Fails the build when any source file exceeds MAX_LINES.
// Sub-plan 04 lowers the threshold to 800.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sub-plan 04 §DoD: every mobile-web .ts/.tsx file must be ≤ 800 lines.
// All originally-flagged god-files were decomposed in waves 1–3 of the
// 2026-05-01 hardening session (commits 2be44a9..c05aeb0 on
// feature/ighardening-04-frontend). Threshold lowered from the legacy
// 2600 to the canonical Plan 04 cap.
const MAX_LINES = 800;
const ROOT = fileURLToPath(new URL('../src', import.meta.url));
const EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '__mocks__']);

// ── QUARANTINE ──────────────────────────────────────────────────────────────
// A file may sit here ONLY with a reason and an owner. This is not a way to
// win a line count: every entry is a debt someone has agreed to pay, and the
// list is short enough to read in one glance and embarrassing enough to want
// gone.
//
// The check still FAILS on any file not listed, which is the whole point — a
// permanently-red check guards nothing, because nobody reads it. Four of the
// five files that were over the cap on 2026-08-30 were split that day; this is
// the one that could not be.
const QUARANTINE = new Map([
  ['features/voice/useVoiceRecorder.ts', {
    at: 849,
    since: '2026-08-30',
    why: 'Down from 893 the same day: its types and pure helpers moved to '
       + 'useVoiceRecorder.types.ts. The remaining 49 lines are all inside '
       + 'closures over hook state (runTranscribeStage, persistDegradedCapture, '
       + 'commitParsedDraft), each needing six to ten dependencies threaded '
       + 'through a new boundary. That is a refactor of the VOICE CAPTURE path '
       + '— the one thing a farmer cannot work around if it breaks — and it '
       + 'must not ride along with an unrelated UI release. Owner: next voice '
       + 'change to land takes it.',
  }],
]);

let violations = 0;
let quarantined = 0;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full);
    } else if (EXTENSIONS.has(extname(entry.name))) {
      const content = await readFile(full, 'utf8');
      const lineCount = content.split('\n').length;
      if (lineCount > MAX_LINES) {
        const key = relative(ROOT, full).split('\\').join('/');
        const allowed = QUARANTINE.get(key);
        if (allowed) {
          // A quarantined file may not GROW. The recorded size is a ceiling,
          // so the debt can only ever get smaller — otherwise an exemption
          // becomes a licence.
          if (lineCount > allowed.at) {
            console.error(
              `::error file=${relative(process.cwd(), full)}::file is ${lineCount} lines; `
              + `quarantined at ${allowed.at} since ${allowed.since} and may not grow. `
              + `Reduce it, or split it and remove the quarantine entry.`
            );
            violations += 1;
          } else {
            console.warn(
              `::warning file=${relative(process.cwd(), full)}::${lineCount} lines, over the `
              + `${MAX_LINES} cap but quarantined since ${allowed.since}. ${allowed.why}`
            );
            quarantined += 1;
          }
        } else {
          console.error(
            `::error file=${relative(process.cwd(), full)}::file is ${lineCount} lines, max allowed is ${MAX_LINES}`
          );
          violations += 1;
        }
      }
    }
  }
}

await walk(ROOT);

if (violations > 0) {
  console.error(`\n${violations} file(s) exceed ${MAX_LINES} lines.`);
  process.exit(1);
}

console.log(
  quarantined > 0
    ? `OK — all source files under ${MAX_LINES} lines, except ${quarantined} quarantined (see QUARANTINE in this file).`
    : `OK — all source files under ${MAX_LINES} lines.`
);
