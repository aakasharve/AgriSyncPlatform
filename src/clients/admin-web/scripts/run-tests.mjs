// `npm test` for the control room, with no package that is not already installed.
//
//   1. Finds every test file: src/test/**/*.test.ts and *.test.tsx.
//   2. Bundles each one into its own plain JavaScript file, with rolldown (the bundler that
//      Vite 8 brings, so it is in node_modules after `npm install`).
//   3. Hands those files to Node's own test runner (`node --test`), which starts one process
//      per test file, and ends with the runner's exit code.
//
// Bundling first, rather than letting Node read TypeScript itself, is what makes this work the
// same on Node 20 (CI) and on newer Node: Node 20 cannot read TypeScript, knows nothing of the
// `@/` alias, and has no `import.meta.env`.
//
// It fails closed. No test file, a file that will not bundle, or a failing test: each one ends
// with a non-zero exit code. A run that tested nothing is never reported as a pass.
//
// It also ends. A change that makes the code under test go round for ever must fail the run, not
// hold it up: a test that is stuck waiting fails after TEST_LIMIT_MS, and a run that is still
// going after RUN_LIMIT_MS is stopped, with every process it started, and ends with exit code 1.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(appDir, 'src');
const testDir = path.join(srcDir, 'test');

// Inside node_modules, so git and the linter already ignore it; next to the type-checker's own
// scratch files. Nothing else is ever written.
const outDir = path.join(appDir, 'node_modules', '.tmp', 'tests');

/**
 * What the code under test reads as `import.meta.env`. It is written out here and nowhere else:
 * no .env file and no variable of this computer is read, so no real server address can reach a
 * test. With no VITE_ value at all, the code's own defaults apply.
 */
const IMPORT_META_ENV = { BASE_URL: '/', MODE: 'test', DEV: true, PROD: false, SSR: false };

/**
 * Node's test runner fails a test that is still waiting after this long: for an answer, for a
 * timer, for anything that gives other work a turn. The other tests go on.
 *
 * It cannot reach code that never gives anything else a turn: a loop with no wait in it, or one
 * that waits only for answers that are already there (a re-send loop against a fake server is
 * one). The limit below is for those.
 */
const TEST_LIMIT_MS = 60_000;

/**
 * The whole run, bundling included, is stopped after this long, whatever it is doing. A normal
 * run takes a few seconds.
 */
const RUN_LIMIT_MS = 5 * 60_000;

/**
 * Node's test runner, from the moment it is started. It starts one more process per test file.
 *
 * @type {import('node:child_process').ChildProcess | null}
 */
let runner = null;

/**
 * Stops the test runner and every process it started, at once and without asking them. Does
 * nothing when the runner was never started or has already ended.
 */
function stopTestProcesses() {
  if (!runner || runner.pid === undefined) return;
  if (runner.exitCode !== null || runner.signalCode !== null) return;
  if (process.platform === 'win32') {
    // /T: with the processes it started. /F: without asking them first.
    spawnSync('taskkill', ['/PID', String(runner.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      // The runner heads its own process group (see `runBundles`): minus means the whole group.
      process.kill(-runner.pid, 'SIGKILL');
    } catch {
      // The group had already gone.
    }
  }
  // Whatever became of the lines above, the runner itself is not left running.
  runner.kill('SIGKILL');
}

/**
 * Hands the bundles to Node's own test runner and waits for it to end.
 *
 * @param {string[]} bundles paths from the output folder
 * @returns {Promise<number>} the runner's exit code; 1 when it gave none
 */
function runBundles(bundles) {
  return new Promise((resolve) => {
    // An explicit list of files: Node 20 expands no patterns here. The runner is started inside
    // the output folder and given names from there, because newer Node leaves out any name that
    // begins with `node_modules`, even one it was handed. Source maps make a failure point at
    // the line in src/, not at the line in the bundle.
    runner = spawn(
      process.execPath,
      ['--enable-source-maps', '--test', `--test-timeout=${TEST_LIMIT_MS}`, ...bundles],
      {
        cwd: outDir,
        // The tests are given nothing to read, so none of them can sit waiting for it.
        stdio: ['ignore', 'inherit', 'inherit'],
        // Away from Windows the runner heads a process group of its own, so that it and the
        // processes it starts can be stopped together. Windows stops them by their parent.
        detached: process.platform !== 'win32',
      },
    );
    runner.on('error', (err) => {
      console.error('The test runner could not be started:');
      console.error(err);
      resolve(1);
    });
    // No exit code means the runner was stopped from outside: that is not a pass either.
    runner.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * Every test file under src/test, as a path from that folder with forward slashes, in a fixed
 * order. Empty when the folder is missing.
 *
 * @returns {string[]}
 */
function findTestFiles() {
  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(testDir, { recursive: true, encoding: 'utf8' });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((name) => /\.test\.tsx?$/.test(name) && statSync(path.join(testDir, name)).isFile())
    .map((name) => name.split(path.sep).join('/'))
    .sort();
}

/**
 * Bundles one test file, with everything it imports, into one file that Node can run as it is.
 * Only Node's own modules are left as imports. Rejects when the file cannot be bundled.
 *
 * @param {string} testFile path from src/test, e.g. `lib/auth.test.ts`
 * @returns {Promise<string>} the bundle, as a path from the output folder with forward slashes
 */
async function bundle(testFile) {
  // The whole name is kept, so `a.test.ts` and `a.test.tsx` cannot land on the same file.
  const bundleName = `${testFile}.mjs`;
  const build = await rolldown({
    input: path.join(testDir, testFile),
    cwd: appDir,
    platform: 'node',
    external: [/^node:/, ...builtinModules],
    // The same compiler settings the tests are type-checked with, and the same `@/` as the app.
    tsconfig: path.join(appDir, 'tsconfig.test.json'),
    resolve: { alias: { '@': srcDir } },
    transform: { define: { 'import.meta.env': JSON.stringify(IMPORT_META_ENV) } },
  });
  try {
    await build.write({
      file: path.join(outDir, bundleName),
      format: 'esm',
      sourcemap: true,
      codeSplitting: false,
    });
  } finally {
    await build.close();
  }
  return bundleName;
}

/**
 * The whole run.
 *
 * @returns {Promise<number>} the exit code: zero only when every test file ran and passed
 */
async function main() {
  // Emptied at the start of every run, so nothing from an earlier run can be run again.
  rmSync(outDir, { recursive: true, force: true });

  const testFiles = findTestFiles();
  if (testFiles.length === 0) {
    console.error('No test file found under src/test (*.test.ts, *.test.tsx): nothing was tested.');
    return 1;
  }

  // Newer Node reads each name it is given as a pattern, and a name with pattern characters in
  // it (brackets, braces, a star) would match nothing and be left out without a word. Such a
  // file is refused here, by name, rather than skipped there in silence.
  const oddlyNamed = testFiles.filter((testFile) => !/^[A-Za-z0-9._/-]+$/.test(testFile));
  if (oddlyNamed.length > 0) {
    const names = oddlyNamed.map((testFile) => `src/test/${testFile}`).join(', ');
    console.error(
      `A test file's path may hold only letters, digits, dot, dash and underscore. Rename: ${names}`,
    );
    return 1;
  }

  mkdirSync(outDir, { recursive: true });

  /** @type {string[]} */
  const bundles = [];
  let notBundled = 0;
  for (const testFile of testFiles) {
    try {
      bundles.push(await bundle(testFile));
    } catch (err) {
      notBundled += 1;
      console.error(`src/test/${testFile} could not be bundled:`);
      console.error(err instanceof Error ? err.message : err);
    }
  }
  if (notBundled > 0) {
    console.error(
      `${notBundled} of ${testFiles.length} test files could not be bundled: no test was run.`,
    );
    return 1;
  }

  return runBundles(bundles);
}

// The limit on the whole run. The test processes are stopped first, so that none is left
// running behind a run that has been given up.
const runLimit = setTimeout(() => {
  stopTestProcesses();
  console.error(`The tests did not finish within ${RUN_LIMIT_MS / 60_000} minutes.`);
  process.exit(1);
}, RUN_LIMIT_MS);

// Stopped from outside (Ctrl+C, or CI giving up on the job): the test processes go as well.
// Away from Windows they are in a group of their own, which such a signal does not reach.
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => {
    stopTestProcesses();
    process.exit(1);
  });
}

// Set before anything is awaited: if the run dies half-way, the exit code is already not zero.
process.exitCode = 1;
try {
  process.exitCode = await main();
} finally {
  clearTimeout(runLimit);
}
