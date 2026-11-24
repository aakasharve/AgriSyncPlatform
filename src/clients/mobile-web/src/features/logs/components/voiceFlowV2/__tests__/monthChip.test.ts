import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { monthChipWords, monthDaysOf } from '../monthChip';

const log = (date: string, plot: string, over: Record<string, unknown> = {}): DailyLog =>
    ({ id: `${date}-${plot}`, date, context: { selection: [{ selectedPlotIds: [plot] }] }, ...over }) as unknown as DailyLog;

describe('monthDaysOf - only real saved logs, this month, this plot', () => {
    const h = [log('2026-11-02', 'p1'), log('2026-11-02', 'p1'), log('2026-11-10', 'p1'), log('2026-11-11', 'p2'), log('2026-10-30', 'p1'), log('2026-11-12', 'p1', { deletion: { at: 'x' } })];
    it('counts distinct days, not logs; other plots, other months and deleted logs do not count', () => {
        expect(monthDaysOf(h, 'p1', '2026-11-24')).toBe(2);
        expect(monthDaysOf(h, 'p2', '2026-11-24')).toBe(1);
        expect(monthDaysOf([], 'p1', '2026-11-24')).toBe(0);
    });
    it('words in each language', () => {
        expect(monthChipWords(18, 'mr')).toBe('या महिन्यात १८ दिवस');
        expect(monthChipWords(1, 'en')).toBe('1 day this month');
        expect(monthChipWords(18, 'en')).toBe('18 days this month');
    });
});
