/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-companion-2026-07-11 (wave-0.3)
 *
 * Nine call sites (otpClient.ts, complianceClient.ts, dfesQuestionApi.ts,
 * inviteApi.ts, serviceProofClient.ts, testsClient.ts, jobCardsClient.ts,
 * BackendFarmGeographyClient.ts, BackendWeatherClient.ts) all fall back to
 * http://localhost:5048 when VITE_AGRISYNC_API_URL is unset. A production
 * build shipped without the variable looks completely dead in the field.
 *
 * `vite.config.ts` exports its config as a factory function (the
 * `({ command, mode }) => UserConfig` form `defineConfig` supports) so this
 * test can call it directly with a synthetic ConfigEnv instead of shelling
 * out to a real `vite build` — fast, and it exercises the exact function
 * Vite itself invokes to resolve the config.
 *
 * This guard must fire for PRODUCTION BUILDS ONLY (command === 'build').
 * Dev (`vite`) and test (`vitest`, which uses vitest.config.ts, not this
 * file, and never reaches this guard) must keep working without the var.
 *
 * The config factory is imported once, statically. It is safe to reuse
 * across assertions below because it reads `process.env` fresh on every
 * *call*, not at import time -- only the module-level assertNoForbiddenEnv()
 * (unrelated deny-guard, unaffected by this variable) runs at import time.
 */
import { describe, it, expect, afterEach } from 'vitest';
import configFactory from '../../vite.config';

const ORIGINAL_VALUE = process.env.VITE_AGRISYNC_API_URL;

afterEach(() => {
    if (ORIGINAL_VALUE === undefined) {
        delete process.env.VITE_AGRISYNC_API_URL;
    } else {
        process.env.VITE_AGRISYNC_API_URL = ORIGINAL_VALUE;
    }
});

type ConfigFactory = (env: { command: 'build' | 'serve'; mode: string }) => unknown;

describe('vite.config.ts — VITE_AGRISYNC_API_URL require-guard', () => {
    it('throws naming the variable on a production build when the var is absent', () => {
        delete process.env.VITE_AGRISYNC_API_URL;

        expect(() =>
            (configFactory as ConfigFactory)({ command: 'build', mode: 'production' }),
        ).toThrow(/VITE_AGRISYNC_API_URL/);
    });

    it('throws naming the variable on a production build when the var is empty', () => {
        process.env.VITE_AGRISYNC_API_URL = '';

        expect(() =>
            (configFactory as ConfigFactory)({ command: 'build', mode: 'production' }),
        ).toThrow(/VITE_AGRISYNC_API_URL/);
    });

    it('does not throw on a production build when the var is set', () => {
        process.env.VITE_AGRISYNC_API_URL = 'https://api.shramsafal.in';

        expect(() =>
            (configFactory as ConfigFactory)({ command: 'build', mode: 'production' }),
        ).not.toThrow();
    });

    it('does not throw on dev (command=serve) when the var is absent', () => {
        delete process.env.VITE_AGRISYNC_API_URL;

        expect(() =>
            (configFactory as ConfigFactory)({ command: 'serve', mode: 'development' }),
        ).not.toThrow();
    });
});
