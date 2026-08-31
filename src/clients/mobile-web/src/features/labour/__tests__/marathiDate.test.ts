/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * `formatWindowRange` — the Marathi date range shown above the dashboard's
 * figures. Founder report 2026-08-31: "in आढावा it does not change the date
 * ranges". It could not: the server sent only the window's START, as a bare
 * ISO date, and the client suppressed it (correctly — a farmer must never be
 * shown `2026-08-24`). So NO range rendered under any window, and the period
 * a figure covered was never stated.
 */
import { describe, it, expect } from 'vitest';
import { formatWindowRange } from '../marathiDate';

describe('formatWindowRange', () => {
    it('collapses a range inside one month to a single month name', () => {
        expect(formatWindowRange('2026-08-24', '2026-08-30')).toBe('२४–३० ऑग');
    });

    it('names both months when the window straddles one', () => {
        expect(formatWindowRange('2026-08-28', '2026-09-03')).toBe('२८ ऑग – ३ सप्टें');
    });

    it('states a single day once, not as a range against itself', () => {
        expect(formatWindowRange('2026-08-31', '2026-08-31')).toBe('३१ ऑग');
    });

    it('spans a year boundary without claiming one month', () => {
        expect(formatWindowRange('2026-12-29', '2027-01-04')).toBe('२९ डिसें – ४ जाने');
    });

    // The absence rule (R8): no boundary is not a zero-length range, it is a
    // window with nothing to state. आजपर्यंत is unbounded at both ends.
    it('returns nothing for an unbounded window rather than inventing an end', () => {
        expect(formatWindowRange('', '')).toBe('');
    });

    it('returns nothing when only one end is known — it will not guess the other', () => {
        expect(formatWindowRange('2026-08-01', '')).toBe('');
        expect(formatWindowRange('', '2026-08-31')).toBe('');
    });

    it('returns nothing for anything that is not exactly an ISO date', () => {
        expect(formatWindowRange('24 Aug', '2026-08-30')).toBe('');
        expect(formatWindowRange('2026-8-4', '2026-08-30')).toBe('');
        expect(formatWindowRange('2026-08-24T00:00:00', '2026-08-30')).toBe('');
    });

    it('refuses a backwards range instead of rendering it reversed', () => {
        expect(formatWindowRange('2026-08-30', '2026-08-24')).toBe('');
    });

    it('renders every month name without a hole in the table', () => {
        const months = Array.from({ length: 12 }, (_, i) => {
            const mm = String(i + 1).padStart(2, '0');
            return formatWindowRange(`2026-${mm}-05`, `2026-${mm}-05`);
        });
        expect(months.every((m) => m !== '' && !m.includes('undefined'))).toBe(true);
        expect(new Set(months).size).toBe(12);
    });
});
