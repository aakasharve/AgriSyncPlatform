// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 14 fixes, CTO ruling) - the approved design (version 7, the spec that wins over the build plan) draws a day before
 * pruning on the Schedule tab calendar as "−N", and the calendar's rule line says so. This locks it: N is the SAME number the day card says ("छाटणीआधी N दिवस"), the
 * pruning day reads १, and English mode carries no Devanagari.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScheduleTabCalendar } from '../ScheduleTabCalendar';
import { dayCardWords } from '../../dayCards/dayCardWords';
import { positionText } from '../../dayCards/dayCardTiming';
import { shownScheduleDay } from '../scheduleDates';

const language = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: language.current }) }));
vi.mock('../../dayCards/DayCardsEntries', () => ({ DayCardsDayButton: () => null }));
vi.mock('../../dayCards/DayCardsViewer', () => ({ DayCardsViewer: () => null }));

afterEach(() => cleanup());

const empty = { items: [], status: 'none' } as unknown;
const mkDay = (key: string, day: number) => ({ key, day, when: 'past', prep: day < 0, stageId: null, items: [], cells: { irrigation: empty, nutrition: empty, spray: empty, work: empty }, logs: [] });
const KEYS = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];
const DAYS = [-3, -1, 0, 1, 2];
const model = () => ({
    todayKey: '2026-10-14', todayDay: 2, lossDays: 0, totalDays: 40, totalDaysShown: 41, progressPct: null, stages: [], currentStage: null, ended: false,
    byKey: new Map(KEYS.map((k, i) => [k, mkDay(k, DAYS[i])])),
}) as unknown as React.ComponentProps<typeof ScheduleTabCalendar>['model'];
const deva = (n: number) => String(n).replace(/[0-9]/g, d => '०१२३४५६७८९'[Number(d)]);

const show = (lang: 'mr' | 'en') => {
    language.current = lang;
    return render(<ScheduleTabCalendar templateId="t" model={model()} />);
};

describe('the calendar draws days before pruning as the approved design does', () => {
    it('Marathi: "−N" with the same N as the day card, the pruning day reads १', () => {
        show('mr');
        const words = dayCardWords('mr');
        for (const [i, k] of KEYS.entries()) {
            if (DAYS[i] >= 0) continue;
            const n = deva(-DAYS[i]);
            expect(screen.getByTestId(`calendar-shown-${k}`).textContent).toBe(`−${n}`);
            expect(positionText(shownScheduleDay(DAYS[i]), words)).toBe(`छाटणीआधी ${n} दिवस`);
        }
        expect(screen.getByTestId(`calendar-shown-${KEYS[2]}`).textContent).toBe('१');
        expect(screen.getByTestId('calendar-rule').textContent).toContain('−');
    });

    it('English: "−N" with Latin digits and no Devanagari anywhere', () => {
        show('en');
        expect(screen.getByTestId(`calendar-shown-${KEYS[0]}`).textContent).toBe('−3');
        expect(screen.getByTestId(`calendar-shown-${KEYS[1]}`).textContent).toBe('−1');
        expect(screen.getByTestId('calendar-grid').textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
