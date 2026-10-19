/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * keepDatedLogs — the gate between the phone's stored diary and the `history`
 * state every screen reads.
 *
 * WHY: APK 1.0.14 saved some voice-attendance records with no `date`. They are
 * still on farmers' phones after the upgrade, and the first screen that read
 * their date crashed (the saved screen, via computePreviousLog). The type says
 * `date: string`; stored data does not have to agree. These tests pin what the
 * gate does with such a row: leave it out of `history`, touch nothing else.
 *
 * spec: 2026-08-25-prod-cutover-waves (release 1.0.16)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { DailyLog } from '../../../types';
import { hasDateKey, keepDatedLogs } from '../datedHistory';

/** A stored row exactly as the phone holds it — `date` may be anything. */
const storedRow = (id: string, date: unknown): DailyLog => ({
    id,
    date,
    context: { selection: [] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
} as unknown as DailyLog);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('hasDateKey — can this row be placed on a day?', () => {
    it('accepts a YYYY-MM-DD day, and an ISO date-time whose day part is one', () => {
        expect(hasDateKey(storedRow('a', '2026-10-19'))).toBe(true);
        expect(hasDateKey(storedRow('b', '2026-10-19T06:30:00.000Z'))).toBe(true);
    });

    it('rejects a missing, non-string, empty or malformed date (never guesses one)', () => {
        for (const bad of [undefined, null, 20261019, '', 'undefined', '19-10-2026', '2026-8-1', 'T06:30:00']) {
            expect(hasDateKey(storedRow('x', bad))).toBe(false);
        }
    });

    it('rejects a missing row outright instead of throwing', () => {
        expect(hasDateKey(undefined)).toBe(false);
        expect(hasDateKey(null)).toBe(false);
    });
});

describe('keepDatedLogs — what reaches `history`', () => {
    it('leaves out the dateless row and keeps every dated row in its stored order', () => {
        const rows = [storedRow('first', '2026-10-18'), storedRow('legacy-1', undefined), storedRow('last', '2026-10-16')];

        expect(keepDatedLogs(rows).map(row => row.id)).toEqual(['first', 'last']);
    });

    it('does not change the rows or the list it was given — nothing is deleted, nothing is re-dated', () => {
        const legacy = storedRow('legacy-1', undefined);
        const rows = [storedRow('first', '2026-10-18'), legacy];

        const shown = keepDatedLogs(rows);

        expect(rows).toHaveLength(2);
        expect(rows[1]).toBe(legacy);
        expect(legacy.date).toBeUndefined();
        expect(shown[0]).toBe(rows[0]);
    });

    it('a missing row in the stored list is left out, not thrown on', () => {
        const rows = [storedRow('first', '2026-10-18'), undefined as unknown as DailyLog];

        expect(keepDatedLogs(rows).map(row => row.id)).toEqual(['first']);
    });

    it('says so ONCE, with the count and without any record id', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        keepDatedLogs([storedRow('legacy-1', undefined), storedRow('ok', '2026-10-18'), storedRow('legacy-2', null)]);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]).toHaveLength(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/^\[history\] 2 /);
        const said = JSON.stringify(warn.mock.calls[0]);
        expect(said).not.toContain('legacy-1');
        expect(said).not.toContain('legacy-2');
    });

    it('stays silent when every row has a date', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const rows = [storedRow('a', '2026-10-18'), storedRow('b', '2026-10-19')];

        expect(keepDatedLogs(rows)).toEqual(rows);
        expect(warn).not.toHaveBeenCalled();
    });
});
