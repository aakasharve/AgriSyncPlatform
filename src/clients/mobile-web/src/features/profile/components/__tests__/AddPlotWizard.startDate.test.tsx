// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane WIZARD-F2; founder pick F2, 2026-11-19)
 *
 * "At plot creation ask only the date; the checked schedule for the crop is followed by itself; change it later in the schedule tab.
 *  The day counter is a must." Step 3 of the add-plot wizard asks ONE required question - when was this planted / pruned / sown - with
 * two big choices, "आज" and "आधी केली" (a date picker). Nothing is pre-selected; the finish button stays off until one is chosen. The
 * plot's start date, its schedule's day 0 and the schedule choice sent with the plot all come from that answer.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const lang = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AddPlotWizard from '../AddPlotWizard';
import { SC } from '../../../scheduler/schedulePage/scheduleCopy';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE } from '../../../scheduler/schedulePage/__tests__/scheduleFixtures';
import type { CropProfile, FarmerProfile, Plot } from '../../../../types';

const CHECKED_ID = '10000000-0000-4000-8000-000000000003';
const SAMPLE_ID = '10000000-0000-4000-8000-000000000001';
const checked = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const row = (id: string, name: string, extra: Record<string, unknown> = {}, cropType = 'Grapes') => ({ ...SERVER_TEMPLATE, id, name, cropType, versionHash: 'h', ...extra });
const CHECKED_GRAPES = row(CHECKED_ID, 'Grapes - Standard Seasonal Template', { ownerType: 'INSTITUTION', check: checked, hasStoredDays: true });
const SAMPLE_GRAPES = row(SAMPLE_ID, 'Grapes - Standard Seasonal Template', { check: null, ownerType: null });

const crop: CropProfile = {
    id: 'c_11111111-1111-4111-8111-111111111111',
    name: 'Grapes',
    iconName: 'Grape',
    color: 'bg-purple-500',
    plots: [],
    activeScheduleId: null,
    supportedTasks: [],
    workflow: [],
};
const profile = {
    name: 'Test Farmer', village: '', phone: '', language: 'mr', operators: [], activeOperatorId: '',
    waterResources: [], motors: [], machineries: [],
} as unknown as FarmerProfile;

const next = () => fireEvent.click(screen.getByRole('button', { name: /profile\.nextStep/ }));
const fillStep = () => {
    for (const el of Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[]) {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden') continue;
        fireEvent.change(el, { target: { value: el.type === 'number' ? '5' : 'abc' } });
    }
};
const finish = () => screen.getByRole('button', { name: /profile\.finishSetup/ }) as HTMLButtonElement;
const byId = (id: string) => screen.getByTestId(id);

/** Opens the wizard and walks to step 3 with valid answers on steps 1 and 2. */
function openStep3(onSave = vi.fn(), cropProp: CropProfile = crop) {
    render(<AddPlotWizard crop={cropProp} profile={profile} onSave={onSave} onCancel={vi.fn()} />);
    fillStep(); next();
    fillStep(); next();
    return onSave;
}

describe('add-plot wizard, step 3 - the one date question (F2)', () => {
    beforeEach(() => {
        lang.current = 'mr';
        setScheduleTemplatesFromReferenceData([CHECKED_GRAPES]);
        // 2026-11-19, 11:30 in the app's own day (IST)
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-19T06:00:00Z'));
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        setScheduleTemplatesFromReferenceData([]);
    });

    it('asks the question in the crop\'s own word, offers two big choices, and pre-selects NOTHING', () => {
        openStep3();
        expect(byId('plot-start-question')).toHaveTextContent('ही छाटणी केव्हा केली?');
        expect(byId('plot-start-today')).toHaveAttribute('aria-pressed', 'false');
        expect(byId('plot-start-earlier')).toHaveAttribute('aria-pressed', 'false');
        expect(byId('plot-start-today')).toHaveTextContent('आज');
        expect(byId('plot-start-earlier')).toHaveTextContent('आधी केली');
        expect(screen.queryByTestId('plot-start-date')).toBeNull();
        expect(screen.queryByTestId('plot-start-day')).toBeNull();
    });

    it('the old schedule list and its "Required" pill are gone; the machinery part stays', () => {
        openStep3();
        expect(screen.queryByText(/Choose Schedule/)).toBeNull();
        expect(screen.queryByText('Required')).toBeNull();
        expect(screen.getByText('profile.selectTools')).toBeInTheDocument();
    });

    it('cannot finish until a date choice is made', () => {
        const onSave = openStep3();
        expect(finish()).toBeDisabled();
        fireEvent.click(finish());
        expect(onSave).not.toHaveBeenCalled();
    });

    it('"आज" enables finish and the counter reads आज दिवस ० in Devanagari digits (the schedule tab\'s own count: day 0 is the chosen day)', () => {
        openStep3();
        fireEvent.click(byId('plot-start-today'));
        expect(byId('plot-start-today')).toHaveAttribute('aria-pressed', 'true');
        expect(byId('plot-start-day')).toHaveTextContent('आज दिवस ०');
        expect(finish()).not.toBeDisabled();
    });

    it('"आधी केली" opens a date picker and keeps finish OFF until a date is picked', () => {
        openStep3();
        fireEvent.click(byId('plot-start-earlier'));
        expect(byId('plot-start-earlier')).toHaveAttribute('aria-pressed', 'true');
        const date = byId('plot-start-date') as HTMLInputElement;
        expect(date).toHaveAttribute('type', 'date');
        expect(date).toHaveAttribute('max', '2026-11-19');
        expect(date).toHaveAttribute('min', '2023-11-19');
        expect(date.value).toBe('');
        expect(finish()).toBeDisabled();
        expect(screen.queryByTestId('plot-start-day')).toBeNull();
    });

    it('an earlier date gives the right "आज दिवस N" live, and turns finish on', () => {
        openStep3();
        fireEvent.click(byId('plot-start-earlier'));
        fireEvent.change(byId('plot-start-date'), { target: { value: '2026-10-12' } });
        expect(byId('plot-start-day')).toHaveTextContent('आज दिवस ३८');
        expect(finish()).not.toBeDisabled();
        fireEvent.change(byId('plot-start-date'), { target: { value: '2026-11-09' } });
        expect(byId('plot-start-day')).toHaveTextContent('आज दिवस १०');
    });

    it('a date after today is refused in words and finish stays off', () => {
        openStep3();
        fireEvent.click(byId('plot-start-earlier'));
        fireEvent.change(byId('plot-start-date'), { target: { value: '2026-11-20' } });
        expect(byId('plot-start-problem')).toHaveTextContent('आजपर्यंतची तारीख निवडा');
        expect(screen.queryByTestId('plot-start-day')).toBeNull();
        expect(finish()).toBeDisabled();
    });

    it('a date more than three years back is refused in words and finish stays off', () => {
        openStep3();
        fireEvent.click(byId('plot-start-earlier'));
        fireEvent.change(byId('plot-start-date'), { target: { value: '2023-11-18' } });
        expect(byId('plot-start-problem')).toHaveTextContent('३ वर्षांपेक्षा जुनी तारीख चालत नाही');
        expect(finish()).toBeDisabled();
        fireEvent.change(byId('plot-start-date'), { target: { value: '2023-11-19' } });
        expect(finish()).not.toBeDisabled();
    });

    it('switching back from a picked date to "आज" counts from today again, never from the old date', () => {
        openStep3();
        fireEvent.click(byId('plot-start-earlier'));
        fireEvent.change(byId('plot-start-date'), { target: { value: '2026-10-12' } });
        fireEvent.click(byId('plot-start-today'));
        expect(byId('plot-start-day')).toHaveTextContent('आज दिवस ०');
        expect(screen.queryByTestId('plot-start-date')).toBeNull();
    });

    it('shows the checked schedule that will follow by itself, in plain words', () => {
        openStep3();
        const card = byId('plot-start-schedule');
        expect(card).toHaveTextContent('शेड्यूल आपोआप लागेल');
        expect(card).toHaveTextContent('द्राक्ष');            // the schedule's name in Marathi (scheduleNameMr)
        // UI-9a item 9: the SAME words as the schedule page's check badge, not the Latin brand name
        expect(card).toHaveTextContent(SC.checkedByShramSafal);
        expect(card).toHaveTextContent('श्रमसफलने तपासलेलं');
        expect(card.textContent).not.toContain('ShramSafal');
        expect(card).toHaveTextContent('बदलायचं असेल तर नंतर शेड्यूल टॅबमध्ये');
        expect(screen.queryByTestId('plot-start-no-schedule')).toBeNull();
    });

    it('"आज": the plot and its schedule start TODAY (a plain day, not a timestamp), and the checked schedule is the one handed on', () => {
        const onSave = openStep3();
        fireEvent.click(byId('plot-start-today'));
        fireEvent.click(finish());
        expect(onSave).toHaveBeenCalledTimes(1);
        const [plot, start] = onSave.mock.calls[0] as [Plot, { scheduleTemplateId: string | null; referenceDate: string }];
        expect(plot.startDate).toBe('2026-11-19');
        expect(plot.schedule.referenceDate).toBe('2026-11-19');
        expect(plot.schedule.templateId).toBe(CHECKED_ID);
        expect(start).toEqual({ scheduleTemplateId: CHECKED_ID, referenceDate: '2026-11-19' });
    });

    it('an earlier date: the plot\'s start date, the schedule\'s day 0 and the choice sent with the plot are ALL the chosen day', () => {
        const onSave = openStep3();
        fireEvent.click(byId('plot-start-earlier'));
        fireEvent.change(byId('plot-start-date'), { target: { value: '2026-10-12' } });
        fireEvent.click(finish());
        const [plot, start] = onSave.mock.calls[0] as [Plot, { scheduleTemplateId: string | null; referenceDate: string }];
        expect(plot.startDate).toBe('2026-10-12');
        expect(plot.schedule.referenceDate).toBe('2026-10-12');
        expect(start).toEqual({ scheduleTemplateId: CHECKED_ID, referenceDate: '2026-10-12' });
    });

    it('a crop with NO checked schedule says so in words, makes the plot with no schedule, and hands on NO schedule (the sample is not adopted)', () => {
        setScheduleTemplatesFromReferenceData([SAMPLE_GRAPES]);
        const onSave = openStep3();
        expect(byId('plot-start-no-schedule')).toHaveTextContent('या पिकासाठी अजून तपासलेलं शेड्यूल नाही, प्लॉट शेड्यूलशिवाय बनेल');
        expect(screen.queryByTestId('plot-start-schedule')).toBeNull();
        expect(byId('plot-start-question')).toHaveTextContent('ही लागवड केव्हा केली?'); // no schedule to name the date after: planting
        fireEvent.click(byId('plot-start-earlier'));
        fireEvent.change(byId('plot-start-date'), { target: { value: '2026-09-01' } });
        fireEvent.click(finish());
        const [plot, start] = onSave.mock.calls[0] as [Plot, { scheduleTemplateId: string | null; referenceDate: string }];
        expect(start).toEqual({ scheduleTemplateId: null, referenceDate: '2026-09-01' });
        // the date still counts: the plot and its day 0 are the chosen day
        expect(plot.startDate).toBe('2026-09-01');
        expect(plot.schedule.referenceDate).toBe('2026-09-01');
        // never a stand-in or a sample as the plot's schedule
        expect(plot.schedule.templateId).toBe('');
    });

    it('a crop with no schedule at all (the app\'s stand-in) behaves the same: words, no schedule handed on', () => {
        setScheduleTemplatesFromReferenceData([]);
        const onSave = openStep3();
        expect(byId('plot-start-no-schedule')).toBeInTheDocument();
        fireEvent.click(byId('plot-start-today'));
        fireEvent.click(finish());
        expect((onSave.mock.calls[0] as [Plot, { scheduleTemplateId: string | null }])[1].scheduleTemplateId).toBeNull();
    });

    it('the no-schedule words are still shown with the date question unanswered, and finish still needs the date', () => {
        setScheduleTemplatesFromReferenceData([]);
        openStep3();
        expect(byId('plot-start-no-schedule')).toBeInTheDocument();
        expect(finish()).toBeDisabled();
    });

    it('English twin: same two choices, the live count in 0-9, the card in English', () => {
        lang.current = 'en';
        openStep3();
        expect(byId('plot-start-question')).toHaveTextContent('When was this pruning done?');
        expect(byId('plot-start-today')).toHaveTextContent('Today');
        expect(byId('plot-start-earlier')).toHaveTextContent('Earlier');
        fireEvent.click(byId('plot-start-earlier'));
        fireEvent.change(byId('plot-start-date'), { target: { value: '2026-10-12' } });
        expect(byId('plot-start-day')).toHaveTextContent('Day 38 today');
        expect(byId('plot-start-schedule')).toHaveTextContent('Schedule will start by itself');
        expect(byId('plot-start-schedule')).toHaveTextContent('Checked by ShramSafal');
        expect(within(byId('plot-start-schedule')).getByText(/Grapes - Standard Seasonal Template/)).toBeInTheDocument();
    });

    it('English twin for a crop with no checked schedule', () => {
        lang.current = 'en';
        setScheduleTemplatesFromReferenceData([]);
        openStep3();
        expect(byId('plot-start-no-schedule')).toHaveTextContent('No checked schedule for this crop yet');
        expect(byId('plot-start-question')).toHaveTextContent('When was this planting done?');
    });

    it('the touch targets are at least 44 px and the words at least 14 px (no tiny text on a 360 px phone)', () => {
        openStep3();
        fireEvent.click(byId('plot-start-earlier'));
        for (const id of ['plot-start-today', 'plot-start-earlier']) {
            expect(byId(id).className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
        }
        expect(byId('plot-start-date').className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
        const tiny = Array.from(byId('plot-start-section').querySelectorAll('*')).filter(el => /text-\[(\d|1[0-3])(\.\d+)?px\]|text-xs\b/.test(el.getAttribute('class') ?? ''));
        expect(tiny).toEqual([]);
        expect(byId('plot-start-section').className).not.toMatch(/overflow-x/);
    });
});
