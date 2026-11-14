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

import { spawnSync } from 'node:child_process';
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

  // An explicit list of files: Node 20 expands no patterns here. The runner is started inside
  // the output folder and given names from there, because newer Node leaves out any name that
  // begins with `node_modules`, even one it was handed. Source maps make a failure point at the
  // line in src/, not at the line in the bundle.
  const run = spawnSync(process.execPath, ['--enable-source-maps', '--test', ...bundles], {
    cwd: outDir,
    stdio: 'inherit',
  });
  if (run.error) {
    console.error('The test runner could not be started:');
    console.error(run.error);
    return 1;
  }
  // No exit code means the runner was stopped from outside: that is not a pass either.
  return run.status ?? 1;
}

// Set before anything is awaited: if the run dies half-way, the exit code is already not zero.
process.exitCode = 1;
process.exitCode = await main();
