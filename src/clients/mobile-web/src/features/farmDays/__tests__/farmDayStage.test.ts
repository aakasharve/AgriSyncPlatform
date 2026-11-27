/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2 (the day-3 / 7 / 14 / 18 cards, no price).
 * The farm's day comes ONLY from what the phone holds about this farm: its creation date as the server sent it in the pull
 * (`FarmDto.createdAtUtc`, stored in the phone's farms table). Not known, not a real date, or in the future: no day, no card
 * (never a guess, P4). Each stage owns the days up to the next one; from day 21 there is no card (D21 = nothing in the pilot).
 */
import { describe, it, expect } from 'vitest';
import { currentStage, farmDayOf, farmStartKey } from '../farmDayStage';

describe('farmStartKey — the farm\'s first day, from the server\'s creation date', () => {
    it('reads the server\'s UTC time as the farm\'s own day (India time)', () => {
        expect(farmStartKey('2026-11-20T10:00:00Z')).toBe('2026-11-20');
        // 20:00 UTC is 01:30 the next morning in India.
        expect(farmStartKey('2026-11-20T20:00:00Z')).toBe('2026-11-21');
        expect(farmStartKey('2026-11-20T20:00:00.1234567+00:00')).toBe('2026-11-21');
    });

    it('a time with no zone is the server\'s UTC (the field is named Utc), never the phone\'s local time', () => {
        expect(farmStartKey('2026-11-20T20:00:00')).toBe('2026-11-21');
    });

    it('nothing that is not a real date gives a day (fails closed)', () => {
        for (const v of [undefined, null, '', '   ', 'yesterday', '2026-13-45T00:00:00Z', 12345, {}, '0001-01-01T00:00:00']) {
            expect(farmStartKey(v), String(v)).toBeNull();
        }
    });
});

describe('farmDayOf — whole days since the farm\'s first day', () => {
    it('day 0 is the day it was made', () => {
        expect(farmDayOf('2026-11-20', '2026-11-20')).toBe(0);
        expect(farmDayOf('2026-11-20', '2026-11-23')).toBe(3);
        expect(farmDayOf('2026-10-30', '2026-11-02')).toBe(3);
        expect(farmDayOf('2026-02-27', '2026-03-02')).toBe(3);
    });

    it('a start after today, or no start, is no day', () => {
        expect(farmDayOf('2026-11-24', '2026-11-23')).toBeNull();
        expect(farmDayOf(null, '2026-11-23')).toBeNull();
    });
});

describe('currentStage — the card of the CURRENT stage only, never a backlog', () => {
    it.each([
        [0, null], [1, null], [2, null],
        [3, 'd3'], [6, 'd3'],
        [7, 'd7'], [13, 'd7'],
        [14, 'd14'], [17, 'd14'],
        [18, 'd18'], [20, 'd18'],
        [21, null], [40, null], [400, null],
    ])('day %s → %s', (day, stage) => {
        expect(currentStage(day)).toBe(stage);
    });

    it('no day → no stage', () => {
        expect(currentStage(null)).toBeNull();
    });
});
