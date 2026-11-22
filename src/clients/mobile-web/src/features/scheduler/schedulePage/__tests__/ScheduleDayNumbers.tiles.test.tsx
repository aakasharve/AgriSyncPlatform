// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (founder D-167: the start day is DAY 1 as the farmer reads it; the server stores it as day 0)
 *
 * The day numbers the schedule tab prints, one component at a time:
 *   - the 'N days behind' banner prints the SHOWN day (stored + 1) for the calendar day and for the crop's day, and leaves its count of days alone;
 *   - the last day of a schedule reads N / N - when the schedule states its length, and when the length falls back to the last stage's end day
 *     (a stored, 0-based day, so N - 1 as stored) - never N / (N - 1), and never one day past the end.
 */
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { getTemplateById, setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import type { CropScheduleTemplate } from '../../scheduler.types';
import { addDays, shownScheduleDay } from '../scheduleDates';
import { buildScheduleModel, type ScheduleModel } from '../scheduleModel';
import { TodayPill } from '../TodayTab';
import { BehindBanner, ScheduleHeader } from '../WhereYouAre';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, TEMPLATE_ID, plot } from './scheduleFixtures';

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));
afterEach(() => cleanup());

const text = (id: string) => screen.getByTestId(id).textContent ?? '';

describe('BehindBanner prints the shown day, not the stored one', () => {
    it('crop on stored day 7, 2 days behind: the calendar reads day 10, the crop day 8, and "2 days behind" is still 2', () => {
        render(<BehindBanner model={{ todayDay: 7, lossDays: 2 }} />);

        expect(text('behind-banner')).toContain('शेड्यूल २ दिवस मागे चाललं आहे');
        expect(text('behind-banner')).toContain('कॅलेंडरप्रमाणे दिवस १० · पिकासाठी दिवस ८');
    });

    it('the start day itself (stored 0) reads day 1 for the crop, and the calendar is the days behind plus one', () => {
        render(<BehindBanner model={{ todayDay: 0, lossDays: 3 }} />);

        expect(text('behind-banner')).toContain('शेड्यूल ३ दिवस मागे चाललं आहे');
        expect(text('behind-banner')).toContain('कॅलेंडरप्रमाणे दिवस ४ · पिकासाठी दिवस १');
    });

    it('the gap between the two day numbers is the days behind, as before', () => {
        for (const [todayDay, lossDays] of [[7, 2], [20, 5], [0, 1]] as const) {
            cleanup();
            render(<BehindBanner model={{ todayDay, lossDays }} />);
            const calendar = shownScheduleDay(todayDay + lossDays);
            const crop = shownScheduleDay(todayDay);
            expect(calendar - crop, `${todayDay}/${lossDays}`).toBe(lossDays);
        }
    });

    it('nothing slipped: nothing is drawn', () => {
        const { container } = render(<BehindBanner model={{ todayDay: 7, lossDays: 0 }} />);

        expect(container).toBeEmptyDOMElement();
    });
});

describe('the last day of a schedule reads N / N', () => {
    // SERVER_TEMPLATE: 40 days in all, its second stage ends on stored day 39, so the last day is stored day 39 and the farmer reads it as day 40.
    const LAST_DAY_KEY = addDays(REF, 39);
    const withLength = (): CropScheduleTemplate => getTemplateById(TEMPLATE_ID)!;
    /** The same schedule when nothing states its length: the model falls back to the last stage's end day. */
    const withoutLength = (): CropScheduleTemplate => ({ ...getTemplateById(TEMPLATE_ID)!, totalDurationDays: undefined });
    const modelOn = (template: CropScheduleTemplate, todayKey: string): ScheduleModel =>
        buildScheduleModel({ template, instance: plot().schedule, plotId: 'plot-1', logs: [], todayKey });

    it('a schedule that states its length (40): the last day (stored 39) reads "दिवस ४० / ४०" on the pill', () => {
        const m = modelOn(withLength(), LAST_DAY_KEY);
        render(<TodayPill day={m.todayDay} totalDays={m.totalDaysShown} ended={m.ended} />);

        expect(m.todayDay).toBe(39);
        expect(m.totalDaysShown).toBe(40);
        expect(text('today-pill')).toContain('दिवस ४० / ४०');
        expect(text('today-pill')).not.toContain('/ ३९');
    });

    it('a schedule that gives no length: the length falls back to the last end day, and the last day still reads "दिवस ४० / ४०", never "/ ३९"', () => {
        const m = modelOn(withoutLength(), LAST_DAY_KEY);
        render(<TodayPill day={m.todayDay} totalDays={m.totalDaysShown} ended={m.ended} />);

        expect(m.todayDay).toBe(39);
        expect(m.totalDaysShown).toBe(40);
        expect(text('today-pill')).toContain('दिवस ४० / ४०');
        expect(text('today-pill')).not.toContain('/ ३९');
    });

    it('with or without a stated length, the shown number of the last day IS the shown length (N = N)', () => {
        for (const template of [withLength(), withoutLength()]) {
            const m = modelOn(template, LAST_DAY_KEY);
            expect(shownScheduleDay(m.todayDay)).toBe(m.totalDaysShown);
        }
    });

    it('the header tiles on the last day: the day tile and the total tile both read ४०, with a stated length and without', () => {
        for (const template of [withLength(), withoutLength()]) {
            cleanup();
            const m = modelOn(template, LAST_DAY_KEY);
            render(<ScheduleHeader cropName="द्राक्ष" plotName="A" template={template} model={m} />);

            expect(text('day-now')).toBe('४०');
            expect(text('day-total')).toBe('४०');
        }
    });

    it('the day before the last: day 39 of 40 on the pill', () => {
        const m = modelOn(withLength(), addDays(REF, 38));
        render(<TodayPill day={m.todayDay} totalDays={m.totalDaysShown} ended={m.ended} />);

        expect(text('today-pill')).toContain('दिवस ३९ / ४०');
    });

    it('the day after the last day says the schedule ended, never "दिवस ४१ / ४०"', () => {
        for (const template of [withLength(), withoutLength()]) {
            cleanup();
            const m = modelOn(template, addDays(REF, 40));
            render(<TodayPill day={m.todayDay} totalDays={m.totalDaysShown} ended={m.ended} />);

            expect(m.ended).toBe(true);
            expect(text('today-pill')).not.toMatch(/दिवस ४[१-९]/);
            expect(text('today-pill')).not.toContain('तुम्ही इथे आहात');
        }
    });
});
