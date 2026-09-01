/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * BUILD AND TOOLING CONFIG — Preservation Register A49, plus the SPA history
 * fallback A44 records.
 *
 * Task 28's Steps 2, 3 and 4 are "verify, change nothing that is already
 * right". This file is what that verification is worth after the person who
 * did it has gone. Every property below was correct when it was checked; none
 * of them was protected by anything, and each fails in a way that does not
 * look like its cause:
 *
 *   the `@` alias in only two of three places  -> a build that type-checks and
 *                                                 will not bundle, or a suite
 *                                                 that resolves imports
 *                                                 differently from the app it
 *                                                 is evidence for
 *   port 4001 not pinned                       -> Vite quietly moves to 4002,
 *                                                 the API's CORS allow-list
 *                                                 does not, and every request
 *                                                 fails as a permissions error
 *   ESLint inheriting stricter defaults        -> admin-web fails the gate on
 *                                                 day one, and the repair
 *                                                 someone reaches for is a
 *                                                 shell `|| true`
 *
 * These are read as TEXT on purpose. Importing vite.config.ts would run it,
 * and a config that throws at import time is exactly the state this file
 * should be able to report on.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

const viteConfig = read('vite.config.ts');
const vitestConfig = read('vitest.config.ts');
const tsconfigApp = read('tsconfig.app.json');
const eslintConfig = read('eslint.config.js');
const pkg = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('the @ alias is declared in all THREE places, and they agree (A49)', () => {
  /*
   * Two of the three is the dangerous state, and which two decides which lie
   * you get told. vite + tsconfig without vitest gives a green suite that
   * resolved different files from the bundle. tsconfig + vitest without vite
   * gives a build that type-checks and then cannot bundle.
   */
  it.each([
    ['vite.config.ts', viteConfig],
    ['vitest.config.ts', vitestConfig],
  ])('%s maps @ to ./src', (_name, source) => {
    expect(source).toContain("'@': path.resolve(__dirname, './src')");
  });

  it('tsconfig.app.json maps @/* to ./src/*', () => {
    expect(tsconfigApp).toContain('"@/*": ["./src/*"]');
  });
});

describe('the dev server port is pinned (A49)', () => {
  /*
   * `strictPort` is the whole point, not the number. Without it Vite silently
   * takes the next free port, and the failure surfaces on the API side as
   * blocked requests — which on this console reads as a permissions problem,
   * the single most misleading thing it can look like.
   */
  it('is 4001 with strictPort true', () => {
    expect(viteConfig).toMatch(/port:\s*4001/);
    expect(viteConfig).toMatch(/strictPort:\s*true/);
  });
});

describe('lint participates in the gate without a shell OR-true (A49)', () => {
  /*
   * `eslint.config.js` deliberately demotes rules to `warn` and the script
   * allows 9999 warnings, so admin-web can be a REQUIRED check today while its
   * warning count is driven down separately. Errors still fail the build. The
   * alternative — inheriting stricter defaults — fails CI on day one, and the
   * repair everyone reaches for is `|| true`, which turns a required check into
   * a decoration that can never fail again.
   */
  it('runs eslint with an explicit warning ceiling rather than suppressing failure', () => {
    expect(pkg.scripts.lint).toBe('eslint --max-warnings 9999 .');
    expect(pkg.scripts.lint).not.toContain('|| true');
  });

  it('demotes to warn rather than disabling', () => {
    for (const rule of [
      '@typescript-eslint/no-unused-expressions',
      '@typescript-eslint/no-unused-vars',
      '@typescript-eslint/no-explicit-any',
      'prefer-const',
      'react-refresh/only-export-components',
    ]) {
      expect(eslintConfig).toContain(`'${rule}': 'warn'`);
    }
    // 'off' hides a rule; 'warn' leaves it visible and countable, which is what
    // makes driving the count to zero possible at all.
    expect(eslintConfig).not.toContain("'off'");
  });
});

describe('the build type-checks before it bundles (A49)', () => {
  it('runs tsc -b then vite build', () => {
    expect(pkg.scripts.build).toBe('tsc -b && vite build');
  });
});

describe('the two libraries dropped in Task 27 stay dropped', () => {
  /*
   * `@tanstack/react-table` went to zero importers in Task 18 and `recharts`
   * in Task 22; Task 27 removed both from package.json. A dependency with no
   * importer is not merely dead weight here — recharts was the largest chunk
   * in the bundle, and this console is opened over whatever connection an
   * operator has. Re-adding either should be a decision, not a reflex reach
   * for a chart library.
   */
  it.each(['@tanstack/react-table', 'recharts'])('%s is not a dependency', (name) => {
    expect(pkg.dependencies[name]).toBeUndefined();
    expect(pkg.devDependencies[name]).toBeUndefined();
  });
});

describe('the SPA history fallback is committed, not only in the AWS console (A44)', () => {
  /*
   * THE ONE FAILURE MODE THAT IS INVISIBLE UNTIL DEPLOYMENT.
   *
   * This console is a client-side router: there is no S3 object at the key
   * `farms` or `farmer-health/<id>`. Every deep link works in `vite dev` and
   * 404s in production unless CloudFront rewrites unknown paths to
   * /index.html. That rewrite lived ONLY in the AWS console — recreate the
   * distribution and every shareable URL this migration built dies silently.
   *
   * The file is asserted from the test suite rather than trusted to a README
   * because a config that exists only as prose is the state this is fixing.
   */
  const fallback = JSON.parse(read('../../../aws/admin/cloudfront-spa-fallback.json')) as {
    Quantity: number;
    Items: Array<{
      ErrorCode: number;
      ResponsePagePath: string;
      ResponseCode: string;
      ErrorCachingMinTTL: number;
    }>;
  };

  it('maps BOTH 403 and 404 to /index.html at 200', () => {
    // 404 alone is not enough: an S3 REST origin behind OAC answers 403
    // AccessDenied — not 404 — for a missing key whenever the bucket policy
    // withholds s3:ListBucket. Mapping only 404 leaves every deep link 403ing,
    // which on an admin console reads as a permissions bug.
    expect(fallback.Quantity).toBe(2);
    expect(fallback.Items.map((i) => i.ErrorCode).sort()).toEqual([403, 404]);
    for (const item of fallback.Items) {
      expect(item.ResponsePagePath).toBe('/index.html');
      expect(item.ResponseCode).toBe('200');
      // Any non-zero TTL caches the FALLBACK for a path, so an asset that is
      // missing mid-deploy keeps serving index.html after the file lands.
      expect(item.ErrorCachingMinTTL).toBe(0);
    }
  });
});

describe('the deploy script asserts Content-Type, not only status', () => {
  /*
   * THE COROLLARY OF THE FALLBACK, AND THE REASON THIS TEST EXISTS.
   *
   * On a distribution that maps 404 to index.html at 200, ANY MISSING OBJECT
   * RETURNS 200 WITH text/html. A missing bundle returns 200. A deploy that
   * uploaded nothing returns 200 on every URL you try. A status-only smoke
   * check is therefore incapable of failing here, which is the most expensive
   * kind of green there is.
   *
   * Asserting on the script's TEXT is unusual and is the point: the check runs
   * against production, which no test can reach, so the only thing that can be
   * pinned from here is that the check was written to be capable of failing.
   */
  const deploy = read('scripts/deploy-s3.sh');

  it('checks content-type on every object it verifies', () => {
    expect(deploy).toContain('expected_ctype');
    expect(deploy).toMatch(/content-type/i);
  });

  it('names the missing-object-returns-200 trap where a reader will hit it', () => {
    expect(deploy).toContain('ANY MISSING OBJECT RETURNS HTTP 200');
    expect(deploy).toContain('DOES NOT EXIST (200 text/html is the SPA fallback');
  });

  it('pins index.html to no-cache and hashed assets to one year', () => {
    expect(deploy).toContain('IMMUTABLE="public,max-age=31536000,immutable"');
    expect(deploy).toContain('REVALIDATE="no-cache"');
    // The classifier reads the FILENAME. Classifying on the `assets/` prefix
    // instead pinned hand-named files for a year on mobile-web — and re-pinned
    // them on every run, because the bug was baked into the classifier.
    expect(deploy).toContain('*-????????.*');
  });
});
