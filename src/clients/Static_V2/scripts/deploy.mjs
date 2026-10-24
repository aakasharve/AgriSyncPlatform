// One-command publish of the site to shramsafal.in (S3 + CloudFront).
//
//   npm run deploy                      build, test, then show what WOULD change. Touches nothing.
//   npm run deploy -- --confirm PUBLISH build, test, upload, clear the CloudFront cache.
//
// Same five steps as the README "Deploy" section, in the same order, so a rollback
// is still "check out the old commit, run this again". Nothing is ever deleted from
// the bucket (no --delete): a file removed from the site stays online until removed
// by hand, which is deliberately the safer failure.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BUCKET = 's3://shramsafal-marketing-prod';
const DISTRIBUTION = 'E2M06A2B71ZW1O';
const IMMUTABLE = 'public, max-age=31536000, immutable';

const args = process.argv.slice(2);
const confirmIdx = args.indexOf('--confirm');
const publish = confirmIdx !== -1 && args[confirmIdx + 1] === 'PUBLISH';
if (confirmIdx !== -1 && !publish) {
  console.error('To publish, pass exactly:  --confirm PUBLISH');
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// MSYS_NO_PATHCONV stops Git Bash rewriting "/*" into a Windows path.
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' && cmd === npm, ...opts });
}

function fail(message) {
  console.error(`\nSTOPPED: ${message}`);
  process.exit(1);
}

// 1. Build and test. A failing copy contract or hydration check stops here.
run(npm, ['test']);
run(npm, ['run', 'build']);

// 2. Sanity-check what was built, before anything is uploaded.
const mustExist = ['index.html', '404.html', 'robots.txt', 'sitemap.xml', 'privacy/index.html', 'delete-account/index.html'];
for (const f of mustExist) {
  if (!existsSync(join(DIST, f))) fail(`dist/${f} is missing - refusing to upload an incomplete site.`);
}
if (readFileSync(join(DIST, 'index.html'), 'utf8').length < 400) fail('dist/index.html looks empty.');

// 3. Who is uploading? Prints the AWS identity (no secrets) so a wrong profile is obvious.
try {
  const who = execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Arn', '--output', 'text'], { env, encoding: 'utf8' }).trim();
  console.log(`\nAWS identity: ${who}`);
} catch {
  fail('AWS CLI is not signed in. Sign in (aws configure / aws sso login) and run again.');
}

console.log(publish ? '\n=== PUBLISHING to shramsafal.in ===' : '\n=== DRY RUN - nothing will be uploaded. Add  --confirm PUBLISH  to go live. ===');
const dry = publish ? [] : ['--dryrun'];
const sync = (extra) => run('aws', ['s3', 'sync', ...extra, ...dry], { cwd: DIST });

// 4. Upload. Hashed assets/fonts are immutable; HTML is never cached so edits show at once.
sync(['assets', `${BUCKET}/assets`, '--cache-control', IMMUTABLE]);
sync(['fonts', `${BUCKET}/fonts`, '--cache-control', IMMUTABLE, '--content-type', 'font/woff2']);
sync(['.', `${BUCKET}/`, '--exclude', '*', '--include', '*.html', '--exclude', 'nav-*.html', '--cache-control', 'no-cache', '--content-type', 'text/html; charset=utf-8']);
sync(['.', `${BUCKET}/`, '--exclude', '*.html', '--exclude', 'assets/*', '--exclude', 'fonts/*', '--cache-control', 'public, max-age=3600']);

// 5. Clear the CloudFront cache so visitors get the new pages.
if (publish) {
  run('aws', ['cloudfront', 'create-invalidation', '--distribution-id', DISTRIBUTION, '--paths', '/*']);
  console.log('\nDone. Live in about a minute at https://shramsafal.in - hard-refresh to see it.');
} else {
  console.log('\nDry run finished. Nothing was uploaded or invalidated.');
}
