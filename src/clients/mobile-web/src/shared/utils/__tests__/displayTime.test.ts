// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (twelve-hour-time-display)
 *
 * Founder decision (2026-08-16): *"Indian time strictly and use 12 hrs cycle
 * properly AM and PM."*
 *
 * MIDNIGHT AND NOON get their own named cases because they are where 12-hour
 * formatting goes wrong: `00:15` must read `12:15 AM` (not `0:15 AM`) and
 * `12:15` must read `12:15 PM` (not `0:15 PM`). Every hand-rolled clock in this
 * codebase got them right by luck; none of them tested it.
 */
import { describe, it, expect } from 'vitest';

import {
    formatDisplayDateTime,
    formatDisplayTime,
    formatDisplayTimeFromHHmm,
    formatDisplayTimeWithSeconds,
    formatDisplayTimestamp,
    DISPLAY_TIME_ZONE,
} from '../displayTime';

/** IST is UTC+5:30, so these UTC instants are the IST wall-clock times named. */
const AT_0915_IST = '2026-08-16T03:45:00Z';
const AT_1430_IST = '2026-08-16T09:00:00Z';
const AT_0015_IST = '2026-08-15T18:45:00Z';
const AT_1215_IST = '2026-08-16T06:45:00Z';

describe('formatDisplayTime — 12-hour with AM/PM', () => {
    it('morning reads as AM', () => {
        expect(formatDisplayTime(AT_0915_IST)).toBe('9:15 AM');
    });

    it('afternoon reads as PM, not 14:xx', () => {
        expect(formatDisplayTime(AT_1430_IST)).toBe('2:30 PM');
    });

    it('MIDNIGHT is 12:15 AM, not 0:15 AM and not 00:15', () => {
        // The classic off-by-twelve. `00` must become `12`, and the period is AM.
        expect(formatDisplayTime(AT_0015_IST)).toBe('12:15 AM');
    });

    it('NOON is 12:15 PM, not 0:15 PM', () => {
        // The other half: 12 stays 12, and the period flips to PM.
        expect(formatDisplayTime(AT_1215_IST)).toBe('12:15 PM');
    });

    it('the period is upper case, because the founder asked for AM and PM', () => {
        // `en-IN` yields lower-case `am`/`pm` on this ICU. Left alone, every
        // screen would have read `9:15 am`.
        expect(formatDisplayTime(AT_0915_IST)).toMatch(/ AM$/);
        expect(formatDisplayTime(AT_1430_IST)).toMatch(/ PM$/);
    });

    it('every hour of the day maps to the right 12-hour reading AND the right period', () => {
        // REVIEW M-3 — this used to assert the SHAPE only, so a single-hour
        // inversion (13 rendering as `1:20 AM`) passed. It now asserts the exact
        // expected string per hour, which is the claim the report was making.
        for (let hour = 0; hour < 24; hour++) {
            const utc = Date.UTC(2026, 7, 16, hour, 20) - (5 * 60 + 30) * 60 * 1000;
            const expectedHour = hour % 12 === 0 ? 12 : hour % 12;
            const expectedPeriod = hour < 12 ? 'AM' : 'PM';
            expect(formatDisplayTime(new Date(utc)), `hour ${hour}`)
                .toBe(`${expectedHour}:20 ${expectedPeriod}`);
        }
    });
});

describe('formatDisplayTime — Indian time strictly', () => {
    it('renders IST regardless of the device timezone', () => {
        // The instant is 00:15 IST. A device in UTC would otherwise show the
        // previous evening; a device in New York, the previous afternoon.
        expect(DISPLAY_TIME_ZONE).toBe('Asia/Kolkata');
        expect(formatDisplayTime(AT_0015_IST)).toBe('12:15 AM');
    });

    it('accepts a Date, an ISO string and an epoch number identically', () => {
        const iso = AT_1430_IST;
        expect(formatDisplayTime(new Date(iso))).toBe('2:30 PM');
        expect(formatDisplayTime(iso)).toBe('2:30 PM');
        expect(formatDisplayTime(Date.parse(iso))).toBe('2:30 PM');
    });
});

describe('formatDisplayTime — absent and malformed input', () => {
    it('renders the caller fallback rather than inventing a time', () => {
        // Never show a made-up clock for a timestamp we do not have.
        expect(formatDisplayTime(undefined)).toBe('');
        expect(formatDisplayTime(null)).toBe('');
        expect(formatDisplayTime('')).toBe('');
        expect(formatDisplayTime('not-a-date')).toBe('');
        expect(formatDisplayTime(undefined, '--:--')).toBe('--:--');
        expect(formatDisplayTime('not-a-date', '--:--')).toBe('--:--');
    });
});

describe('M-1 — a zone-less string is a wall clock, not an instant', () => {
    it('renders a zone-less literal exactly as written, whatever the device zone', () => {
        // `log-factory-helpers.ts:288` synthesises `${log.date}T12:00:00` as a
        // deliberate midday placeholder, with no `Z` and no offset. Before this
        // task it parsed device-local and rendered device-local, so the round
        // trip cancelled and it always read 12:00 pm. Pinning only the render to
        // IST made a UTC handset show 5:30 PM.
        expect(formatDisplayTime('2026-08-16T12:00:00')).toBe('12:00 PM');
        expect(formatDisplayTime('2026-08-16T00:00:00')).toBe('12:00 AM');
        expect(formatDisplayTime('2026-08-16T09:15:00')).toBe('9:15 AM');
        expect(formatDisplayTime('2026-08-16T14:30:00')).toBe('2:30 PM');
    });

    it('still converts a real instant — anything carrying Z or an offset', () => {
        // The distinction that matters: a zoned value IS an instant and must be
        // shown in IST; a zone-less one has no offset to apply.
        expect(formatDisplayTime('2026-08-16T12:00:00Z')).toBe('5:30 PM');
        expect(formatDisplayTime('2026-08-16T12:00:00+05:30')).toBe('12:00 PM');
    });

    it('the date half of a zone-less literal does not roll either', () => {
        expect(formatDisplayDateTime('2026-08-16T23:30:00')).toBe('16 Aug, 11:30 PM');
    });
});

describe('M-2 — formatDisplayTimestamp keeps the year and the seconds', () => {
    it('renders day, month, YEAR and seconds', () => {
        // The sites that previously used a bare `toLocaleString()` carried both;
        // routing them through formatDisplayDateTime dropped them, and a stale
        // failures row then looks like a current one.
        expect(formatDisplayTimestamp(AT_1430_IST)).toBe('16 Aug 2026, 2:30:00 PM');
    });

    it('midnight keeps the IST date and the AM period', () => {
        expect(formatDisplayTimestamp(AT_0015_IST)).toBe('16 Aug 2026, 12:15:00 AM');
    });

    it('formatDisplayDateTime deliberately has NO year — it is for sites that had none', () => {
        expect(formatDisplayDateTime(AT_1430_IST)).toBe('16 Aug, 2:30 PM');
    });
});

describe('formatDisplayTimeWithSeconds', () => {
    it('keeps 12-hour and AM/PM when seconds are shown', () => {
        expect(formatDisplayTimeWithSeconds('2026-08-16T09:00:07Z')).toBe('2:30:07 PM');
    });

    it('midnight with seconds is still 12:xx AM', () => {
        expect(formatDisplayTimeWithSeconds('2026-08-15T18:45:07Z')).toBe('12:15:07 AM');
    });
});

describe('formatDisplayDateTime', () => {
    it('shows the date unchanged and the time in 12-hour AM/PM', () => {
        // The DATE half is deliberately untouched by this task.
        expect(formatDisplayDateTime(AT_1430_IST)).toBe('16 Aug, 2:30 PM');
    });

    it('midnight rolls the date to the IST day, not the UTC one', () => {
        // 18:45Z on the 15th is 00:15 IST on the 16th.
        expect(formatDisplayDateTime(AT_0015_IST)).toBe('16 Aug, 12:15 AM');
    });
});

describe('formatDisplayTimeFromHHmm — stored wall-clock config', () => {
    it('renders a stored HH:mm as 12-hour AM/PM', () => {
        expect(formatDisplayTimeFromHHmm('09:15')).toBe('9:15 AM');
        expect(formatDisplayTimeFromHHmm('14:30')).toBe('2:30 PM');
    });

    it('MIDNIGHT and NOON', () => {
        expect(formatDisplayTimeFromHHmm('00:15')).toBe('12:15 AM');
        expect(formatDisplayTimeFromHHmm('00:00')).toBe('12:00 AM');
        expect(formatDisplayTimeFromHHmm('12:15')).toBe('12:15 PM');
        expect(formatDisplayTimeFromHHmm('12:00')).toBe('12:00 PM');
    });

    it('does not shift a wall-clock value through a timezone', () => {
        // A config value has no date and no zone. Routing it through a `Date`
        // would apply an offset to a number that never had one — the exact
        // quiet shift this task exists to remove. 09:15 stays 9:15.
        expect(formatDisplayTimeFromHHmm('09:15')).toBe('9:15 AM');
        expect(formatDisplayTimeFromHHmm('23:59')).toBe('11:59 PM');
    });

    it('returns a malformed value verbatim rather than inventing one', () => {
        expect(formatDisplayTimeFromHHmm('')).toBe('');
        expect(formatDisplayTimeFromHHmm('nonsense')).toBe('nonsense');
        expect(formatDisplayTimeFromHHmm('25:00')).toBe('25:00');
        expect(formatDisplayTimeFromHHmm('12:75')).toBe('12:75');
    });
});
