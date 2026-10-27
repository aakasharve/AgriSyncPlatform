/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-26) — the founder's TEST copy must show
 * what the live release shows. Every screen of the voice result (the approved Shram Sathi waiting screen, the
 * understanding meter and ring, the question panel) is behind a DFES companion flag that Vite bakes in at build
 * time. The live web build sets them in `.github/workflows/release.yml`; the test copy reads them from
 * `.env.fieldtest` (copied from `.env.fieldtest.example`). If the two drift, the founder tests a different app
 * from the one farmers get — so this pins every companion flag of the release in the test copy, value for value.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

/** The `VITE_*: "x"` lines of the release workflow's web build, minus the server address (the test copy must differ). */
function releaseFlags(): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of read('../../../.github/workflows/release.yml').matchAll(/^\s+(VITE_[A-Z0-9_]+):\s*"([^"]*)"/gm)) {
        if (m[1] !== 'VITE_AGRISYNC_API_URL') out.set(m[1], m[2]);
    }
    return out;
}

function fieldtestFlags(): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of read('.env.fieldtest.example').matchAll(/^(VITE_[A-Z0-9_]+)=(.*)$/gm)) out.set(m[1], m[2].trim());
    return out;
}

describe('the test copy carries the release\'s DFES companion flags (LP-26)', () => {
    it('reads the release\'s flag set (guard: the parse found the block)', () => {
        const flags = releaseFlags();
        for (const key of ['VITE_DAILY_LOOP', 'VITE_UNDERSTANDING_METER', 'VITE_STAGE_QUESTIONS', 'VITE_VOICE_CONTINUITY', 'VITE_DISCIPLINE_SYSTEM', 'VITE_TASK_CLOSE_CONFIRM']) {
            expect(flags.get(key)).toBe('1');
        }
    });

    it('every companion flag of the release is set to the same value in the test copy', () => {
        const test = fieldtestFlags();
        for (const [key, value] of releaseFlags()) expect([key, test.get(key)]).toEqual([key, value]);
    });

    it('the test copy never points at the live server', () => {
        expect(fieldtestFlags().get('VITE_AGRISYNC_API_URL') ?? '').not.toContain('api.shramsafal.in');
    });
});
