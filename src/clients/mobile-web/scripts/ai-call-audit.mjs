#!/usr/bin/env node
// scripts/ai-call-audit.mjs
//
// Sub-plan 05 Task 9 — scan mobile-web/src for direct browser-side calls to
// generative-AI providers. Browser-side AI calls leak API keys to the user's
// device and bypass server-side budget enforcement, so the goal is for every
// hit to either (a) be proxied through the AgriSync backend, or (b) be
// removed entirely.
//
// Exit code is informational by default (always 0). Pass `--strict` to make
// any hit a non-zero exit so this can become a CI gate later.
//
// Usage:
//   node scripts/ai-call-audit.mjs            # informational
//   node scripts/ai-call-audit.mjs --strict   # CI-gate mode

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..', 'src');

const SUSPICIOUS = [
  { name: 'gemini-rest-host', pattern: /generativelanguage\.googleapis\.com/ },
  { name: 'gemini-sdk-host', pattern: /ai\.google\.dev/ },
  { name: 'vite-env-key', pattern: /VITE_GEMINI_API_KEY/ },
  { name: 'process-env-gemini', pattern: /process\.env\.GEMINI/ },
  { name: 'sarvam-host', pattern: /api\.sarvam\.ai/ },
  { name: 'openai-host', pattern: /api\.openai\.com/ },
  { name: 'anthropic-host', pattern: /api\.anthropic\.com/ },
];

const ALLOWLIST = [
  // Schema/prompt files that mention provider names without making calls
  // are not allowed; if you need to silence a hit, refactor the call.
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'android', '.vite']);

const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');

const hits = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full);
    } else if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(e.name))) {
      const src = await readFile(full, 'utf8');
      const lines = src.split(/\r?\n/);
      for (const probe of SUSPICIOUS) {
        for (let i = 0; i < lines.length; i += 1) {
          if (probe.pattern.test(lines[i])) {
            const rel = relative(ROOT, full);
            if (ALLOWLIST.includes(rel)) continue;
            hits.push({ file: rel, line: i + 1, probe: probe.name, match: lines[i].trim() });
          }
        }
      }
    }
  }
}

await walk(ROOT);

if (hits.length === 0) {
  console.log('OK — no direct AI provider calls found in mobile-web/src.');
  process.exit(0);
}

console.log(`Found ${hits.length} suspicious AI-call site(s):\n`);
for (const h of hits) {
  console.log(`  ${h.file}:${h.line}  [${h.probe}]`);
  console.log(`    ${h.match}`);
}
console.log('');
console.log('Each hit must be either:');
console.log('  (a) proxied through the AgriSync backend (preferred), or');
console.log('  (b) removed entirely.');
console.log('See _COFOUNDER/.../Pending_Tasks/T-IGH-05-AI-PROXY_2026-04-27.md');

process.exit(STRICT ? 1 : 0);
