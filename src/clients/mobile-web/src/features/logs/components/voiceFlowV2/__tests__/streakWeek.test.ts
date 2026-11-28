/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — the meter card's 7 days, from the phone's own history: a day is
 * filled only by a saved, not deleted talk of this farm told to Sathi; a form entry is not a talk.
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { lastSevenDays, streakWeekOf } from '../streakWeek';

const log = (id: string, date: string, over: Record<string, unknown> = {}): DailyLog =>
    ({ id, date, meta: { farmId: 'farm-1', provenance: { source: 'ai' } }, ...over }) as unknown as DailyLog;

describe('lastSevenDays', () => {
    it('seven keys, oldest first, today last — across a month end', () => {
        expect(lastSevenDays('2026-11-03')).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
        expect(lastSevenDays('not a key')).toEqual([]);
    });
});

describe('streakWeekOf', () => {
    const history = [
        log('a', '2026-10-26'),
        log('b', '2026-10-24'),
        log('b2', '2026-10-24'),
        log('form', '2026-10-21', { meta: { farmId: 'farm-1', provenance: { source: 'manual' } } }),
        log('gone', '2026-10-22', { deletion: { at: '2026-10-22T05:00:00Z' } }),
        log('other-farm', '2026-10-23', { meta: { farmId: 'farm-2', provenance: { source: 'ai' } } }),
        log('no-farm', '2026-10-25', { meta: { provenance: { source: 'ai' } } }),
        log('old', '2026-10-01'),
    ];

    it('fills only the days with a talk of this farm; a form entry, a deleted log and another farm\'s log do not count', () => {
        const days = streakWeekOf(history, 'farm-1', '2026-10-26');
        expect(days.map(d => d.dateKey)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
        expect(days.map(d => d.told)).toEqual([false, false, false, false, true, true, true]);
        expect(days.filter(d => d.today).map(d => d.dateKey)).toEqual(['2026-10-26']);
    });

    it('weekdays are the real ones (26 Oct 2026 is a Monday)', () => {
        expect(streakWeekOf([], 'farm-1', '2026-10-26').map(d => d.weekday)).toEqual([2, 3, 4, 5, 6, 0, 1]);
    });

    it('no history = seven empty days (the caller draws them only once the phone has pulled)', () => {
        expect(streakWeekOf([], null, '2026-10-26').every(d => !d.told)).toBe(true);
    });
});
