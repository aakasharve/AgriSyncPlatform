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

    it('no user-facing clock is ever 24-hour', () => {
        // Every hour of the day, asserted as a property rather than by example.
        for (let hour = 0; hour < 24; hour++) {
            const utc = Date.UTC(2026, 7, 16, hour, 20) - (5 * 60 + 30) * 60 * 1000;
            const out = formatDisplayTime(new Date(utc));
            expect(out, `hour ${hour}`).toMatch(/^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/);
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
