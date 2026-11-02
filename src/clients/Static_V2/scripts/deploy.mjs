// Static_V2 no longer publishes shramsafal.in. Since 2026-11-02 the site is src/clients/Website
// (python deploy.py there). The old full upload would put these old pages back over it, so it is gone.
//
// Static_V2 still owns three pages on the bucket: the privacy notice (/privacy/, /privacy-mr/) and the
// account-deletion page (/delete-account/), which the app and the Google Play listing link to. This
// script republishes only those:
//
//   npm run deploy -- --privacy-only                     shows what WOULD change. Touches nothing.
//   npm run deploy -- --privacy-only --confirm PUBLISH   uploads the three pages, clears their cache.
//
// It uploads the COMMITTED bytes (git show HEAD:...), not the working copy: a Windows checkout turns
// the LF line endings into CRLF, and the live pages are the committed LF bytes. Nothing is ever
// deleted from the bucket.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'shramsafal-marketing-prod';
const DISTRIBUTION = 'E2M06A2B71ZW1O';
const PAGES = ['privacy/index.html', 'privacy-mr/index.html', 'delete-account/index.html'];

const args = process.argv.slice(2);
const confirmIdx = args.indexOf('--confirm');
const publish = confirmIdx !== -1 && args[confirmIdx + 1] === 'PUBLISH';

function fail(message) {
  console.error(`\nSTOPPED: ${message}`);
  process.exit(1);
}

if (!args.includes('--privacy-only')) {
  fail(`Static_V2 no longer publishes shramsafal.in, and this script will not upload its pages.
The live site is src/clients/Website. To publish it:

  cd src/clients/Website
  python deploy.py                      (dry run; add  --confirm PUBLISH  to go live)

To republish only the privacy and delete-account pages, which Static_V2 still owns:

  npm run deploy -- --privacy-only      (dry run; add  --confirm PUBLISH  to go live)`);
}
if (confirmIdx !== -1 && !publish) fail('To publish, pass exactly:  --confirm PUBLISH');

// MSYS_NO_PATHCONV stops Git Bash rewriting "/privacy*" into a Windows path.
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const run = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { cwd: ROOT, env, encoding: 'utf8', ...opts });

// 1. The committed pages only. Edits that are not committed would silently not go up, so stop instead.
const dirty = run('git', ['status', '--porcelain', '--', ...PAGES.map((page) => `public/${page}`)]).trim();
if (dirty) fail(`these pages have uncommitted changes; commit them first:\n${dirty}`);
const dir = mkdtempSync(join(tmpdir(), 'static-v2-privacy-'));
const pages = PAGES.map((page) => {
  const bytes = run('git', ['show', `HEAD:./public/${page}`], { encoding: 'buffer' });
  const file = join(dir, page);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return { page, file, md5: createHash('md5').update(bytes).digest('hex') };
});

// 2. Who is uploading? Prints the AWS identity (no secrets) so a wrong profile is obvious.
try {
  console.log(`AWS identity: ${run('aws', ['sts', 'get-caller-identity', '--query', 'Arn', '--output', 'text']).trim()}`);
} catch {
  fail('AWS CLI is not signed in. Sign in (aws configure / aws sso login) and run again.');
}

// 3. Compare with what is live (the ETag is the MD5 of a single-part upload).
console.log(publish ? '\n=== PUBLISHING the privacy and delete-account pages ===' : '\n=== DRY RUN - nothing will be uploaded. Add  --confirm PUBLISH  to go live. ===');
for (const p of pages) {
  let live = 'not on S3';
  try {
    live = run('aws', ['s3api', 'head-object', '--bucket', BUCKET, '--key', p.page, '--query', 'ETag', '--output', 'text'], { stdio: 'pipe' }).trim().replace(/"/g, '');
  } catch {}
  console.log(`  ${p.page.padEnd(28)} ${live === p.md5 ? 'unchanged' : 'CHANGED  '}  committed ${p.md5}, live ${live}`);
}

// 4. Upload exactly these three files; pages are never cached so an edit shows at once.
for (const p of pages) {
  run('aws', ['s3', 'cp', p.file, `s3://${BUCKET}/${p.page}`, '--cache-control', 'no-cache', '--content-type', 'text/html; charset=utf-8',
    '--no-progress', ...(publish ? [] : ['--dryrun'])], { stdio: 'inherit' });
}
rmSync(dir, { recursive: true, force: true });

// 5. Clear only these pages from the CloudFront cache, and wait until that is done.
if (publish) {
  const id = run('aws', ['cloudfront', 'create-invalidation', '--distribution-id', DISTRIBUTION, '--paths', '/privacy*', '/delete-account*',
    '--query', 'Invalidation.Id', '--output', 'text']).trim();
  console.log(`\nInvalidation ${id} created; waiting for it to complete...`);
  run('aws', ['cloudfront', 'wait', 'invalidation-completed', '--distribution-id', DISTRIBUTION, '--id', id], { stdio: 'inherit' });
  console.log('Done. Hard-refresh https://shramsafal.in/privacy/ to see it.');
} else {
  console.log('\nDry run finished. Nothing was uploaded or invalidated.');
}
