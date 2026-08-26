/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * The one rule this file exists to pin: `formatUpToWhen` renders the instant
 * it was GIVEN, or nothing. There is no third outcome — no device clock, no
 * "now", no partially-built time. A fabricated freshness claim on the
 * oversight bar would be worse than the staleness it was added to expose
 * (doctrine `P4`).
 */
import { describe, it, expect } from 'vitest';

import { formatUpToWhen } from '../formatUpToWhen';

// A fixed "now" so the today/yesterday boundary is a property of the code
// and not of the day the suite happens to run. 2026-08-26T06:30:00Z is
// 12:00 IST on 26 Aug — noon, which is also the founder's own example hour.
const NOW = new Date('2026-08-26T06:30:00Z');

describe('formatUpToWhen — it never invents a time', () => {
    it('returns null for a null cursor rather than falling back to now', () => {
        // `useSyncQueueStatus` reports `null` both before its first Dexie read
        // and on a device that has never completed a pull. Neither licenses a
        // freshness claim.
        expect(formatUpToWhen(null, 'mr', NOW)).toBeNull();
        expect(formatUpToWhen(null, 'en', NOW)).toBeNull();
        expect(formatUpToWhen(undefined, 'mr', NOW)).toBeNull();
        expect(formatUpToWhen('', 'mr', NOW)).toBeNull();
    });

    it('returns null for an unparseable cursor rather than printing today', () => {
        // LOAD-BEARING, not defensive. `DateKeyService.getDateKey()`
        // deliberately falls back to the CURRENT TIME on an invalid date, so
        // without the guard in `formatUpToWhen` a malformed cursor value would
        // print today's date as the app's freshness — a fabricated claim
        // arriving through a helper that looks like it is just formatting.
        for (const bad of [
            'not-a-date',
            'null',
            // `new Date('0000')` PARSES. Before the shape guard this exact
            // four-character string rendered '0-01-01 पहाटे 5:53' — a date and
            // a clock conjured out of nothing, on the line whose only job is
            // to say how current the screen is.
            '0000',
            '2026-13-45T99:99:99Z',
            // Right shape, no instant behind it — February has no 30th.
            '2026-02-30T10:00:00Z',
            // Well-shaped and impossible: before the epoch.
            '0000-01-01T00:00:00Z',
            // A wall clock with no zone is not an instant. `displayTime.ts`
            // keeps the two apart deliberately; a freshness line needs the
            // instant.
            '2026-08-26T12:00:00',
        ]) {
            expect(formatUpToWhen(bad, 'mr', NOW), bad).toBeNull();
            expect(formatUpToWhen(bad, 'en', NOW), bad).toBeNull();
        }
    });
});

describe('formatUpToWhen — the day half is a calendar word, not an hours count', () => {
    it('same IST date key reads आज / Today', () => {
        // 05:30Z on 26 Aug = 11:00 IST, the same IST day as NOW.
        expect(formatUpToWhen('2026-08-26T05:30:00Z', 'mr', NOW)).toBe('आज सकाळी 11:00');
        expect(formatUpToWhen('2026-08-26T05:30:00Z', 'en', NOW)).toBe('Today 11:00 AM');
    });

    it('the previous IST date key reads काल / Yesterday, even five minutes before midnight', () => {
        // 18:25Z on 25 Aug = 23:55 IST on 25 Aug — five minutes before the IST
        // day rolls, and ~12.5 hours before NOW. An elapsed-hours rule would
        // call this "today"; a farmer calls it काल.
        expect(formatUpToWhen('2026-08-25T18:25:00Z', 'mr', NOW)).toBe('काल रात्री 11:55');
        expect(formatUpToWhen('2026-08-25T18:25:00Z', 'en', NOW)).toBe('Yesterday 11:55 PM');
    });

    it('five minutes after IST midnight reads आज, not काल', () => {
        // 18:35Z on 25 Aug = 00:05 IST on 26 Aug. The mirror of the case
        // above, and the one an hours-based rule gets backwards in the other
        // direction.
        expect(formatUpToWhen('2026-08-25T18:35:00Z', 'mr', NOW)).toBe('आज रात्री 12:05');
        expect(formatUpToWhen('2026-08-25T18:35:00Z', 'en', NOW)).toBe('Today 12:05 AM');
    });

    it('anything older falls back to the date, with no year and no invented weekday', () => {
        // NO Marathi weekday name exists anywhere under `src/clients/`, so
        // rendering one would mean inventing seven farmer-facing Marathi
        // words. The date is shipped copy (`formatDateKeyForDisplay`) and
        // needs none. No year — a year on a freshness line reads as an
        // archive date.
        const out = formatUpToWhen('2026-08-16T06:30:00Z', 'mr', NOW);
        expect(out).toBe('16 Aug दुपारी 12:00');
        expect(out).not.toContain('2026');
        expect(formatUpToWhen('2026-08-16T06:30:00Z', 'en', NOW)).toBe('16 Aug 12:00 PM');
    });
});

describe('formatUpToWhen — the time half is the app\'s own clock', () => {
    it('Marathi gets the founder-directed natural-language form, English gets AM/PM', () => {
        // `formatFarmerTime` / `formatDisplayTime` from
        // `shared/utils/displayTime.ts` — no second clock is defined here.
        // Noon is the classic off-by-twelve and is the founder's own example.
        expect(formatUpToWhen('2026-08-26T06:30:00Z', 'mr', NOW)).toBe('आज दुपारी 12:00');
        expect(formatUpToWhen('2026-08-26T06:30:00Z', 'en', NOW)).toBe('Today 12:00 PM');
    });

    it('is pinned to IST, not to the device zone', () => {
        // 20:00Z on 25 Aug is 01:30 IST on 26 Aug — a different calendar day
        // in IST than in UTC. The farm's clock wins.
        expect(formatUpToWhen('2026-08-25T20:00:00Z', 'mr', NOW)).toBe('आज रात्री 1:30');
    });
});
