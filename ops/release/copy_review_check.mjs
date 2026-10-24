#!/usr/bin/env node
// spec: 2026-08-25-prod-cutover-waves
//
// Copy-review registry check.
//
// The registry (copy-review-registry.json) lists the user-facing legal / consent / privacy
// copy files that still need counsel review, and records for each whether a review sign-off
// exists. THIS SCRIPT ONLY COMPARES FILE HASHES AGAINST THE REGISTRY. A pass is not evidence
// that any copy is legally valid or compliant; sign-off records live in the private review
// records and the registry only holds an identifier pointing at them.
//
// Usage:
//   node copy_review_check.mjs [--root DIR] [--registry FILE] [--mode report|enforce]
//   node copy_review_check.mjs --update-hashes [--reset-changed-signoffs] [--root DIR] [--registry FILE]
//
// Modes:
//   report   (default) exits 1 only for registry integrity problems ("tamper"): missing listed
//            file, covered file not listed, signed_off file whose current hash differs from
//            reviewedSha256, malformed registry. Audience/awaiting-review state is only reported.
//   enforce  everything in report, plus: when audience is real_farmers, exits 1 unless every
//            listed file is signed_off with a matching hash and a non-empty signOffRef.
//
// Hashing: sha256 of the file bytes with CRLF normalised to LF, so the value is identical on
// Windows checkouts (autocrlf) and Linux CI.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIENCES = ['founder_testing', 'real_farmers'];
const STATUSES = ['unreviewed', 'signed_off'];
const SHA_RE = /^[0-9a-f]{64}$/;

export function hashFile(absPath) {
  const text = readFileSync(absPath).toString('latin1').replace(/\r\n/g, '\n');
  return createHash('sha256').update(Buffer.from(text, 'latin1')).digest('hex');
}

function toPosix(p) {
  return p.split(sep).join('/');
}

// Files found in the registry's covered directories that match the pattern.
export function discoverCovered(root, coverage) {
  const found = new Set();
  for (const rule of coverage) {
    const dir = join(root, rule.dir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const re = new RegExp(rule.pattern);
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isFile() && re.test(name)) found.add(toPosix(relative(root, abs)));
    }
  }
  return found;
}

export function loadRegistry(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function evaluate(registry, root) {
  const problems = []; // tamper / integrity: fail in every mode
  const notes = [];
  const gateFailures = []; // fail only in enforce mode
  const fail = (m) => problems.push(m);

  if (!registry || typeof registry !== 'object') {
    return { problems: ['registry is not an object'], notes, gateFailures, counts: {} };
  }
  if (!AUDIENCES.includes(registry.audience)) {
    fail(`audience must be one of ${AUDIENCES.join(' | ')} (got ${JSON.stringify(registry.audience)})`);
  }
  if (!Array.isArray(registry.files)) fail('files must be an array');
  if (!Array.isArray(registry.coverage)) fail('coverage must be an array of {dir, pattern}');
  if (problems.length) return { problems, notes, gateFailures, counts: {} };

  const listed = new Map();
  const badPaths = new Set();
  let unreviewed = 0;
  for (const entry of registry.files) {
    const p = entry && entry.path;
    if (typeof p !== 'string' || !p) {
      fail('a files[] entry has no path');
      continue;
    }
    if (listed.has(p)) {
      fail(`${p}: listed more than once`);
      badPaths.add(p);
      continue;
    }
    listed.set(p, entry);
    if (!STATUSES.includes(entry.reviewStatus)) {
      fail(`${p}: reviewStatus must be one of ${STATUSES.join(' | ')}`);
      badPaths.add(p);
      continue;
    }
    const abs = join(root, p);
    if (!existsSync(abs)) {
      fail(`${p}: listed in the registry but the file is missing`);
      badPaths.add(p);
      continue;
    }
    const actual = hashFile(abs);
    if (entry.reviewStatus === 'unreviewed') {
      unreviewed++;
      if (entry.sha256 && entry.sha256 !== actual) {
        notes.push(`${p}: content changed since the registry hash was recorded (run --update-hashes)`);
      }
      continue;
    }
    const ref = typeof entry.signOffRef === 'string' ? entry.signOffRef.trim() : '';
    if (!SHA_RE.test(entry.reviewedSha256 || '')) {
      fail(`${p}: signed_off but reviewedSha256 is missing or malformed`);
      badPaths.add(p);
      continue;
    }
    if (!ref) {
      fail(`${p}: signed_off but signOffRef is empty`);
      badPaths.add(p);
      continue;
    }
    if (entry.reviewedSha256 !== actual) {
      fail(
        `${p}: edited after sign-off (current sha256 ${actual.slice(0, 12)}... != reviewedSha256 ` +
          `${entry.reviewedSha256.slice(0, 12)}...). It is no longer reviewed: record it as unreviewed ` +
          `(--update-hashes --reset-changed-signoffs) or obtain a new sign-off.`
      );
      badPaths.add(p);
    }
  }

  for (const p of [...discoverCovered(root, registry.coverage)].sort()) {
    if (!listed.has(p)) {
      fail(`${p}: copy-bearing file in a covered directory is not in the registry (new copy must be registered for review)`);
    }
  }

  const total = registry.files.length;
  const cleared = registry.files.filter(
    (e) => e && e.reviewStatus === 'signed_off' && !badPaths.has(e.path)
  ).length;
  if (registry.audience === 'founder_testing') {
    notes.unshift(
      `audience=founder_testing: ${unreviewed} of ${total} files awaiting counsel review; not cleared for real-farmer onboarding.`
    );
  } else if (cleared !== total || total === 0) {
    gateFailures.push(
      `audience=real_farmers but only ${cleared} of ${total} files are signed_off with a matching hash and a signOffRef.`
    );
    for (const e of registry.files) {
      if (e && e.reviewStatus !== 'signed_off') gateFailures.push(`${e.path}: not signed_off`);
    }
  } else {
    notes.unshift(
      `audience=real_farmers: all ${total} listed files have a sign-off record whose hash matches. This check does not assess legal validity.`
    );
  }
  return { problems, notes, gateFailures, counts: { total, unreviewed, cleared } };
}

export function updateHashes(registry, root, { resetChangedSignoffs = false } = {}) {
  const log = [];
  const byPath = new Map(registry.files.map((e) => [e.path, e]));
  for (const p of [...discoverCovered(root, registry.coverage)].sort()) {
    if (!byPath.has(p)) {
      const e = { path: p, reviewStatus: 'unreviewed', sha256: '' };
      registry.files.push(e);
      byPath.set(p, e);
      log.push(`${p}: added as unreviewed`);
    }
  }
  for (const e of registry.files) {
    const abs = join(root, e.path);
    if (!existsSync(abs)) {
      log.push(`${e.path}: MISSING, left untouched`);
      continue;
    }
    const actual = hashFile(abs);
    if (e.reviewStatus === 'signed_off' && e.reviewedSha256 !== actual) {
      if (!resetChangedSignoffs) {
        log.push(
          `${e.path}: signed_off but content changed; left as signed_off (check will FAIL). ` +
            `Re-run with --reset-changed-signoffs to record it as unreviewed.`
        );
        continue;
      }
      log.push(`${e.path}: sign-off reset to unreviewed (was ${e.signOffRef})`);
      e.priorSignOffRef = e.signOffRef;
      e.reviewStatus = 'unreviewed';
      delete e.signOffRef;
      delete e.reviewedSha256;
    }
    if (e.sha256 !== actual) {
      e.sha256 = actual;
      log.push(`${e.path}: sha256 updated`);
    }
  }
  registry.files.sort((a, b) => a.path.localeCompare(b.path));
  return log;
}

function parseArgs(argv) {
  const a = {
    root: resolve(HERE, '..', '..'),
    registry: join(HERE, 'copy-review-registry.json'),
    mode: 'report',
    update: false,
    reset: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--root') a.root = resolve(argv[++i]);
    else if (k === '--registry') a.registry = resolve(argv[++i]);
    else if (k === '--mode') a.mode = argv[++i];
    else if (k === '--update-hashes') a.update = true;
    else if (k === '--reset-changed-signoffs') a.reset = true;
    else throw new Error(`unknown argument ${k}`);
  }
  if (!['report', 'enforce'].includes(a.mode)) throw new Error('--mode must be report or enforce');
  if (a.reset && !a.update) throw new Error('--reset-changed-signoffs only applies with --update-hashes');
  return a;
}

export function main(argv, out = console) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    out.error(`::error::${e.message}`);
    return 2;
  }
  let registry;
  try {
    registry = loadRegistry(args.registry);
  } catch (e) {
    out.error(`::error::cannot read registry: ${e.message}`);
    return 1;
  }

  if (args.update) {
    const log = updateHashes(registry, args.root, { resetChangedSignoffs: args.reset });
    writeFileSync(args.registry, JSON.stringify(registry, null, 2) + '\n');
    log.forEach((l) => out.log(l));
    out.log(`registry written: ${args.registry} (${log.length} change/notice lines)`);
    return 0;
  }

  const r = evaluate(registry, args.root);
  r.notes.forEach((n) => out.log(`::notice::${n}`));
  r.problems.forEach((p) => out.error(`::error::${p}`));
  if (args.mode === 'report') {
    r.gateFailures.forEach((g) => out.log(`::warning::${g} (report mode: not failing)`));
    return r.problems.length ? 1 : 0;
  }
  r.gateFailures.forEach((g) => out.error(`::error::${g}`));
  return r.problems.length || r.gateFailures.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
