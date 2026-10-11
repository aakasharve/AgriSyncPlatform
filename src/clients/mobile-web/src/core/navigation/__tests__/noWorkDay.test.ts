// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildNoWorkDayPayload, hasDeclaredNoWorkDay } from '../noWorkDay';

describe('noWorkDay - the one declared-rest-day payload', () => {
    it('is exactly dayOutcome NO_WORK_PLANNED, manual provenance, no buckets', () => {
        const p = buildNoWorkDayPayload('2026-10-11');
        expect(p).toMatchObject({ date: '2026-10-11', dayOutcome: 'NO_WORK_PLANNED', provenance: { source: 'manual' } });
        expect(p.disturbance).toBeUndefined(); // P9: no chip, no disturbance
        expect(Object.keys(p).sort()).toEqual(['date', 'dayOutcome', 'disturbance', 'provenance']);
    });

    it('carries HIS chip as the full-day reason, and nothing invented', () => {
        const p = buildNoWorkDayPayload('2026-10-11', 'WEATHER');
        expect(p.disturbance).toEqual({ scope: 'FULL_DAY', group: 'no_work', reason: 'WEATHER', cause: 'WEATHER', blockedSegments: [] });
    });

    it('knows a day already declared (and only that day)', () => {
        const history = [{ date: '2026-10-11', dayOutcome: 'NO_WORK_PLANNED' }, { date: '2026-10-10', dayOutcome: 'WORK_RECORDED' }];
        expect(hasDeclaredNoWorkDay(history, '2026-10-11')).toBe(true);
        expect(hasDeclaredNoWorkDay(history, '2026-10-10')).toBe(false);
        expect(hasDeclaredNoWorkDay([], '2026-10-11')).toBe(false);
    });
});
