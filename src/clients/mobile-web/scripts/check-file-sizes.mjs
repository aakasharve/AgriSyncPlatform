#!/usr/bin/env node
// scripts/check-file-sizes.mjs
// Fails the build when any source file exceeds MAX_LINES.
// Sub-plan 04 lowers the threshold to 800.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_LINES = 2600;
const ROOT = fileURLToPath(new URL('../src', import.meta.url));
const EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '__mocks__']);

let violations = 0;

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
        console.error(
          `::error file=${relative(process.cwd(), full)}::file is ${lineCount} lines, max allowed is ${MAX_LINES}`
        );
        violations += 1;
      }
    }
  }
}

await walk(ROOT);

if (violations > 0) {
  console.error(`\n${violations} file(s) exceed ${MAX_LINES} lines.`);
  process.exit(1);
}

console.log(`OK — all source files under ${MAX_LINES} lines.`);
