/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1c as the founder changed it on 27 Nov ("Don't
 * show billing card yet for Pilot users this will not be applicable"; "Do not mention anything about pricing in the app anywhere
 * right now"). Everything about billing, the plan and the trial is hidden unless the phone switch VITE_BILLING_VISIBLE is on.
 * It is OFF by default, and no env file or release workflow sets it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBillingVisible } from '../featureFlags';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

describe('the billing switch (VITE_BILLING_VISIBLE)', () => {
    // The same rule every runtime switch here uses ('1' / 'true' / 'yes' / 'on'; anything else, or absent, is off).
    it('reads VITE_BILLING_VISIBLE through the one isEnabled rule', () => {
        expect(read('src/app/featureFlags.ts')).toMatch(/isBillingVisible = \(\): boolean =>\s*isEnabled\('VITE_BILLING_VISIBLE'\)/);
    });

    it('is OFF by default (nothing sets it in the test run)', () => {
        expect(isBillingVisible()).toBe(false);
    });

    it('no env example and no release workflow sets it', () => {
        for (const file of ['.env.fieldtest.example', '.env.production.example', '../../../.github/workflows/release.yml']) {
            expect(read(file), file).not.toMatch(/VITE_BILLING_VISIBLE/);
        }
    });
});
