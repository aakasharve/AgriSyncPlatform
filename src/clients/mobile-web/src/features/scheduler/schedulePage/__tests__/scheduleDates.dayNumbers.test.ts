/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (founder D-167: the start day - pruning day for grapes, planting day for the other crops - is
 * DAY 1 as the farmer reads it; the server stores it as day 0)
 *
 * The two helpers that are the ONLY place the farmer's day numbering meets the stored one: `shownScheduleDay(stored)` = stored + 1 for a number that
 * is PRINTED, `storedScheduleDay(shown)` = shown - 1 for a number the farmer TYPED. A difference of days is not a day number and never goes through them.
 */
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, shownScheduleDay, storedScheduleDay } from '../scheduleDates';

describe('shownScheduleDay: the stored (0-based) day, as the farmer reads it', () => {
    it('the start day, stored 0, reads day 1', () => {
        expect(shownScheduleDay(0)).toBe(1);
    });

    it('every stored day reads one higher: 9 -> 10, 39 -> 40', () => {
        expect(shownScheduleDay(9)).toBe(10);
        expect(shownScheduleDay(39)).toBe(40);
    });

    it('a day before the start day moves up by one too: -3 -> -2', () => {
        expect(shownScheduleDay(-3)).toBe(-2);
    });
});

describe('storedScheduleDay: the day the farmer typed, as the server keeps it', () => {
    it('the typed day 1 is the start day, stored 0', () => {
        expect(storedScheduleDay(1)).toBe(0);
    });

    it('a typed day goes in one lower: 5 -> 4, 40 -> 39', () => {
        expect(storedScheduleDay(5)).toBe(4);
        expect(storedScheduleDay(40)).toBe(39);
    });

    it('-2 goes back to -3', () => {
        expect(storedScheduleDay(-2)).toBe(-3);
    });
});

describe('the two are exact inverses', () => {
    it('stored -> shown -> stored and shown -> stored -> shown give the same number back, for every day from -30 to 400', () => {
        for (let n = -30; n <= 400; n++) {
            expect(storedScheduleDay(shownScheduleDay(n)), `stored ${n}`).toBe(n);
            expect(shownScheduleDay(storedScheduleDay(n)), `shown ${n}`).toBe(n);
        }
    });
});

describe('a count or a difference of days is not a day number: shifting both ends leaves it as it was', () => {
    it('the days between two stored days equal the days between the same two as printed ("starts in 3 days", "5 days behind")', () => {
        for (const [from, to] of [[0, 3], [9, 14], [-3, 0], [0, 39]] as const) {
            expect(shownScheduleDay(to) - shownScheduleDay(from), `${from} -> ${to}`).toBe(to - from);
        }
    });

    it('daysBetween still counts the plain days between two dates: the start day to 9 days later is 9 (printed as day 10)', () => {
        const start = '2026-10-17';
        const today = addDays(start, 9);
        expect(daysBetween(start, today)).toBe(9);
        expect(shownScheduleDay(daysBetween(start, today))).toBe(10);
    });
});
