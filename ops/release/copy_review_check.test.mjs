// spec: 2026-08-25-prod-cutover-waves
// Run: node --test copy_review_check.test.mjs
// Each case builds a throwaway tree; "FIRES" cases prove the gate fails, "PASSES" cases prove it passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, hashFile, evaluate } from './copy_review_check.mjs';

const COVERAGE = [{ dir: 'copy', pattern: '\\.md$' }];

function fixture(files = { 'a.md': 'alpha\n', 'b.md': 'beta\n' }) {
  const root = mkdtempSync(join(tmpdir(), 'copyreview-'));
  mkdirSync(join(root, 'copy'));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(root, 'copy', n), c);
  const regFile = join(root, 'registry.json');
  const write = (reg) => writeFileSync(regFile, JSON.stringify(reg, null, 2));
  const read = () => JSON.parse(readFileSync(regFile, 'utf8'));
  const unrev = (n) => ({ path: `copy/${n}`, reviewStatus: 'unreviewed', sha256: hashFile(join(root, 'copy', n)) });
  const signed = (n, ref = 'REC-1') => ({
    path: `copy/${n}`, reviewStatus: 'signed_off', signOffRef: ref, reviewedSha256: hashFile(join(root, 'copy', n)),
  });
  return { root, regFile, write, read, unrev, signed, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(f, args) {
  const lines = [];
  const out = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
  const rc = main(['--root', f.root, '--registry', f.regFile, ...args], out);
  return { rc, text: lines.join('\n') };
}

const reg = (audience, files) => ({ audience, coverage: COVERAGE, files });

test('PASSES founder_testing, all unreviewed, reports plainly in both modes', () => {
  const f = fixture();
  f.write(reg('founder_testing', [f.unrev('a.md'), f.unrev('b.md')]));
  for (const mode of ['report', 'enforce']) {
    const r = run(f, ['--mode', mode]);
    assert.equal(r.rc, 0);
    assert.match(r.text, /2 of 2 files awaiting counsel review; not cleared for real-farmer onboarding/);
  }
  f.cleanup();
});

test('FIRES: listed file missing', () => {
  const f = fixture();
  f.write(reg('founder_testing', [f.unrev('a.md'), f.unrev('b.md'), { path: 'copy/gone.md', reviewStatus: 'unreviewed' }]));
  for (const mode of ['report', 'enforce']) {
    const r = run(f, ['--mode', mode]);
    assert.equal(r.rc, 1);
    assert.match(r.text, /gone\.md: listed in the registry but the file is missing/);
  }
  f.cleanup();
});

test('FIRES: new covered copy file not in the registry', () => {
  const f = fixture();
  f.write(reg('founder_testing', [f.unrev('a.md')]));
  const r = run(f, ['--mode', 'report']);
  assert.equal(r.rc, 1);
  assert.match(r.text, /b\.md: copy-bearing file in a covered directory is not in the registry/);
  f.cleanup();
});

test('PASSES: files outside the covered pattern are ignored', () => {
  const f = fixture({ 'a.md': 'alpha\n', 'notes.txt': 'x' });
  f.write(reg('founder_testing', [f.unrev('a.md')]));
  assert.equal(run(f, ['--mode', 'enforce']).rc, 0);
  f.cleanup();
});

test('FIRES: signed_off file edited after sign-off (both modes, even founder_testing)', () => {
  const f = fixture();
  f.write(reg('founder_testing', [f.signed('a.md'), f.unrev('b.md')]));
  assert.equal(run(f, ['--mode', 'report']).rc, 0);
  writeFileSync(join(f.root, 'copy', 'a.md'), 'alpha edited\n');
  for (const mode of ['report', 'enforce']) {
    const r = run(f, ['--mode', mode]);
    assert.equal(r.rc, 1);
    assert.match(r.text, /a\.md: edited after sign-off/);
  }
  f.cleanup();
});

test('PASSES: CRLF checkout hashes the same as LF', () => {
  const f = fixture();
  f.write(reg('founder_testing', [f.signed('a.md'), f.unrev('b.md')]));
  writeFileSync(join(f.root, 'copy', 'a.md'), 'alpha\r\n');
  assert.equal(run(f, ['--mode', 'enforce']).rc, 0);
  f.cleanup();
});

test('FIRES: signed_off with empty signOffRef or malformed hash', () => {
  const f = fixture();
  f.write(reg('founder_testing', [{ ...f.signed('a.md'), signOffRef: '  ' }, f.unrev('b.md')]));
  assert.match(run(f, ['--mode', 'report']).text, /signOffRef is empty/);
  assert.equal(run(f, ['--mode', 'report']).rc, 1);
  f.write(reg('founder_testing', [{ ...f.signed('a.md'), reviewedSha256: 'abc' }, f.unrev('b.md')]));
  assert.match(run(f, ['--mode', 'report']).text, /reviewedSha256 is missing or malformed/);
  f.cleanup();
});

test('FIRES: real_farmers with an unreviewed file fails in enforce, only warns in report', () => {
  const f = fixture();
  f.write(reg('real_farmers', [f.signed('a.md'), f.unrev('b.md')]));
  const e = run(f, ['--mode', 'enforce']);
  assert.equal(e.rc, 1);
  assert.match(e.text, /b\.md: not signed_off/);
  const r = run(f, ['--mode', 'report']);
  assert.equal(r.rc, 0);
  assert.match(r.text, /report mode: not failing/);
  f.cleanup();
});

test('PASSES: real_farmers with every file signed_off, matching hash, signOffRef', () => {
  const f = fixture();
  f.write(reg('real_farmers', [f.signed('a.md'), f.signed('b.md', 'REC-2')]));
  const r = run(f, ['--mode', 'enforce']);
  assert.equal(r.rc, 0);
  assert.match(r.text, /does not assess legal validity/);
  f.cleanup();
});

test('FIRES: invalid audience, bad status, bad JSON, empty real_farmers registry', () => {
  const f = fixture();
  f.write(reg('everyone', [f.unrev('a.md'), f.unrev('b.md')]));
  assert.equal(run(f, ['--mode', 'report']).rc, 1);
  f.write(reg('founder_testing', [{ ...f.unrev('a.md'), reviewStatus: 'approved' }, f.unrev('b.md')]));
  assert.equal(run(f, ['--mode', 'report']).rc, 1);
  writeFileSync(f.regFile, '{ not json');
  assert.equal(run(f, ['--mode', 'report']).rc, 1);
  f.write(reg('real_farmers', []));
  assert.equal(run(f, ['--mode', 'enforce']).rc, 1);
  f.cleanup();
});

test('update-hashes: keeps statuses, adds new files as unreviewed, never auto-resets sign-offs', () => {
  const f = fixture();
  f.write(reg('founder_testing', [f.signed('a.md'), f.unrev('b.md')]));
  writeFileSync(join(f.root, 'copy', 'b.md'), 'beta v2\n');
  writeFileSync(join(f.root, 'copy', 'c.md'), 'gamma\n');
  writeFileSync(join(f.root, 'copy', 'a.md'), 'alpha v2\n');
  assert.equal(run(f, ['--update-hashes']).rc, 0);
  const after = f.read();
  const by = Object.fromEntries(after.files.map((e) => [e.path, e]));
  assert.equal(by['copy/a.md'].reviewStatus, 'signed_off'); // kept, still tamper-failing
  assert.equal(by['copy/b.md'].sha256, hashFile(join(f.root, 'copy', 'b.md')));
  assert.equal(by['copy/c.md'].reviewStatus, 'unreviewed');
  assert.equal(after.audience, 'founder_testing');
  assert.equal(run(f, ['--mode', 'report']).rc, 1); // a.md still edited-after-sign-off
  f.cleanup();
});

test('update-hashes --reset-changed-signoffs: only changed sign-offs revert; unchanged stay', () => {
  const f = fixture();
  f.write(reg('founder_testing', [f.signed('a.md', 'REC-9'), f.signed('b.md', 'REC-10')]));
  writeFileSync(join(f.root, 'copy', 'a.md'), 'alpha v2\n');
  assert.equal(run(f, ['--update-hashes', '--reset-changed-signoffs']).rc, 0);
  const by = Object.fromEntries(f.read().files.map((e) => [e.path, e]));
  assert.equal(by['copy/a.md'].reviewStatus, 'unreviewed');
  assert.equal(by['copy/a.md'].reviewedSha256, undefined);
  assert.equal(by['copy/a.md'].priorSignOffRef, 'REC-9');
  assert.equal(by['copy/b.md'].reviewStatus, 'signed_off');
  assert.equal(run(f, ['--mode', 'enforce']).rc, 0);
  f.cleanup();
});

test('--reset-changed-signoffs without --update-hashes is rejected', () => {
  const f = fixture();
  f.write(reg('founder_testing', [f.unrev('a.md'), f.unrev('b.md')]));
  assert.equal(run(f, ['--reset-changed-signoffs']).rc, 2);
  f.cleanup();
});

test('the committed registry is well formed and matches the tree (report mode)', async () => {
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const committed = JSON.parse(readFileSync(join(here, 'copy-review-registry.json'), 'utf8'));
  const r = evaluate(committed, resolve(here, '..', '..'));
  assert.deepEqual(r.problems, []);
});
