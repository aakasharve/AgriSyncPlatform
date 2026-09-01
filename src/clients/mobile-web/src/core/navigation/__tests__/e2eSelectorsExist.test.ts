/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GUARD — every data-testid the e2e login helper depends on must still exist in
 * the app source.
 *
 * WHY THIS EXISTS. e2e was red on `main` for at least six days (15 consecutive
 * runs, 2026-08-26 → 2026-09-01) because a home-view reorder deleted the
 * `home-greeting` element while `e2e/fixtures/loginHelper.ts` still waited 30s
 * for it on every single login. Worse, a unit test was added asserting
 * home-greeting is ABSENT (log-view-home-reorder.test.tsx) — so the repo
 * simultaneously guaranteed the element was gone and required it to be present.
 * Both suites passed on their own terms. Nothing compared them.
 *
 * A red e2e is not a small thing here: it is the only end-to-end coverage, and
 * while it was red every other check stayed green, so the breakage was invisible
 * unless someone opened the log.
 *
 * This test is cheap and runs in the fast suite, so the mismatch surfaces in
 * seconds rather than in a 60-minute Playwright run nobody reads.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Every getByTestId(...) the login helper relies on to decide it succeeded. */
const E2E_CRITICAL_TESTIDS = [
    'consent-accept-cta',
    'consent-age-checkbox',
    'welcome-continue',
    'onboarding-skip',
    'running-cost-card',
] as const;

function collectSource(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '__tests__' || entry === '__snapshots__') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            collectSource(full, acc);
        } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
            acc.push(full);
        }
    }
    return acc;
}

describe('e2e login helper selectors', () => {
    const haystack = collectSource(resolve(__dirname, '../../..'))
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');

    it.each(E2E_CRITICAL_TESTIDS)(
        'data-testid "%s" still exists in the app — e2e login breaks silently without it',
        (testId) => {
            expect(haystack).toContain(`data-testid="${testId}"`);
        },
    );
});
