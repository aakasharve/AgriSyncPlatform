/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE MALFORMED ROW MUST NOT TAKE DOWN THE APP.
 *
 * The founder hit "Cannot read properties of undefined (reading 'includes')"
 * three times, the last on merely opening the app. The stack — added to the
 * crash report for exactly this reason — landed on `normalizeDateKey`, called
 * from `computeDayState`, called from `buildOversightHeaderInputs`, which every
 * screen reaches. `DailyLog.date` is REQUIRED by the type, so it was read
 * unguarded; a single stored row violating that contract crashed everything.
 *
 * Revert-proof: remove `withUsableDates` and every test here throws instead of
 * asserting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeDayState, computeCostRunning, computeVerificationMetrics } from '../dayState';
import type { DailyLog } from '../../../types';

const dated = (id: string, date: string): DailyLog => ({
    id,
    date,
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
} as unknown as DailyLog);

// The row that caused it: everything a log should have, except a date.
// (`as unknown as Record<...>` — TS2352 forbids the direct cast because
// `DailyLog` has no index signature; the double cast is the sanctioned way
// to build the deliberately-malformed row this suite exists to exercise.)
const dateless = (id: string): DailyLog => {
    const log = dated(id, '2026-09-01') as unknown as Record<string, unknown>;
    delete log.date;
    return log as unknown as DailyLog;
};

afterEach(() => vi.restoreAllMocks());

describe('a stored log with no date', () => {
    it('does not crash computeDayState', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        expect(() => computeDayState({
            logs: [dateless('bad-1'), dated('good-1', '2026-09-01')],
            crops: [],
            date: '2026-09-01',
        })).not.toThrow();
    });

    it('does not crash computeCostRunning', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        expect(() => computeCostRunning({
            logs: [dateless('bad-1')],
            crops: [],
            date: '2026-09-01',
        })).not.toThrow();
    });

    it('does not crash computeVerificationMetrics', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        expect(() => computeVerificationMetrics([dateless('bad-1')], '2026-09-01'))
            .not.toThrow();
    });

    /**
     * Excluded, never defaulted onto today. A log with no date cannot be
     * claimed to be today's — that would be the app asserting a fact nobody
     * stated, which is the defect this whole branch exists to remove.
     */
    it('is excluded from the day rather than assumed to be todays', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        const withBad = computeDayState({
            logs: [dateless('bad-1'), dated('good-1', '2026-09-01')],
            crops: [],
            date: '2026-09-01',
        });
        const withoutBad = computeDayState({
            logs: [dated('good-1', '2026-09-01')],
            crops: [],
            date: '2026-09-01',
        });

        expect(withBad.completedCount).toBe(withoutBad.completedCount);
        expect(withBad.closurePercent).toBe(withoutBad.closurePercent);
    });

    /**
     * NAMED, not swallowed. A record the farmer created and cannot see is its
     * own defect; this is the only place that knows the row exists.
     */
    it('is named in the console so the bad row is findable', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });

        computeDayState({ logs: [dateless('bad-1')], crops: [], date: '2026-09-01' });

        expect(warn).toHaveBeenCalled();
        const said = warn.mock.calls.flat().map((a) => JSON.stringify(a)).join(' ');
        expect(said).toContain('bad-1');
        expect(said).toContain('no date');
    });

    it('leaves well-formed logs completely untouched', () => {
        const clean = computeDayState({
            logs: [dated('good-1', '2026-09-01'), dated('good-2', '2026-08-31')],
            crops: [],
            date: '2026-09-01',
        });
        expect(clean.date).toBe('2026-09-01');
    });
});
