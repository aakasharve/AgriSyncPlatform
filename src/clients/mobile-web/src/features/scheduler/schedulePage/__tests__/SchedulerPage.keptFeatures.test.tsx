// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S2 "keep every real feature")
 *
 * Every feature of the old English शेड्यूल page is still reachable from the new one, in Marathi, and does
 * what it says: crop / plot pick (and switching recomputes the page; lane UI-8: on the picture map), the 'N days behind' banner, last spray /
 * last water, the open-work lines (HONESTY-1 H10: the amber "काम मागे पडतंय" risk card is gone), today's spend → MoneyLens, Close Day, the library (+ its three steps, + the shortest-first
 * order), the schedule editor (REAL, not mocked: its choice takes effect on the page) and the day grid.
 * Plus the honest states: a schedule nobody chose, a schedule that has ended.
 */
import { autoOpenFolds } from './foldTestKit';
import React, { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../usePlotClips', () => ({ usePlotClips: () => new Map() }));
vi.mock('../../../voiceDiary/components/ClipPlayerCard', () => ({ default: () => <div /> }));
vi.mock('../../../finance/components/MoneyLensDrawer', () => ({
    MoneyLensDrawer: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="money-lens" /> : null),
}));
vi.mock('../../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 250 } }));

import SchedulerPage from '../../../../pages/SchedulerPage';
import { isFallbackTemplate, setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { getTemplateForCrop } from '../../planning/ClientPlanEngine';
import type { CropProfile, DailyLog, PlannedTask } from '../../../../types';
import { addDays } from '../scheduleDates';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, TEMPLATE_ID, crop, log, plot, water, work } from './scheduleFixtures';

const k = (day: number) => addDays(REF, day);
const WEATHER = { weatherStamp: { tempC: 31, conditionText: 'Partly cloudy', iconCode: '02d', humidity: 60, windKph: 8, cloudCoverPct: 40, precipMm: 0 } } as unknown as Partial<DailyLog>;
const LOGS = [log(k(0), work()), log(k(0), water()), log(k(4), water(), WEATHER), log(k(7), work('gap_recorded'))];

const ENGLISH = ['Schedule Maker', 'Build your master plan', 'Select Plot', 'Make new schedule', 'Select Schedule', 'Land Preparation', 'Drag activities',
    'SUGGESTIONS', 'SCHEDULE NAME', 'Save Schedule Plan', 'Template', 'Close Day', 'Last Action Memory', 'Partly cloudy', 'Shortest Duration', 'Adoption'];
const noEnglish = () => { for (const w of ENGLISH) expect(document.body.textContent).not.toContain(w); };

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z')); // 11:30 IST, schedule day 9
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

/** The page with a real parent: a save comes back as new crops, as in the app. */
function mount(initial: CropProfile[] = [crop()], logs: DailyLog[] = LOGS, tasks: PlannedTask[] = []) {
    const onUpdateCrops = vi.fn();
    const props = { onCloseDay: vi.fn(), onBack: vi.fn(), onUpdateCrops };
    const Harness = () => {
        const [crops, setCrops] = useState(initial);
        return <SchedulerPage crops={crops} logs={logs} tasks={tasks} {...props} onUpdateCrops={next => { onUpdateCrops(next); setCrops(next); }} />;
    };
    render(<Harness />);
    autoOpenFolds();
    return props;
}
const text = (id: string) => screen.getByTestId(id).textContent ?? '';

describe('crop and plot pick', () => {
    const twoPlots = () => crop([
        plot(),
        plot({ id: 'plot-2', name: 'B', startDate: k(3), schedule: { ...plot().schedule, id: 'sch-2', plotId: 'plot-2', referenceDate: k(3) } }),
    ]);

    it('lane UI-8: the picture map has a row for each plot; switching plot recomputes the page; a crop with no plot says so', () => {
        mount([twoPlots(), crop([], { id: 'crop-2', name: 'Onion' })]);
        expect(screen.getByTestId('map-plot-plot-1')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('map-plot-plot-2')).toHaveAttribute('aria-pressed', 'false');
        expect(text('sched-crop-plot')).toBe('द्राक्ष · A'); // spec I18: the server's "Grapes" in Marathi
        expect(text('day-now')).toBe('9');

        fireEvent.click(screen.getByTestId('map-plot-plot-2'));
        expect(text('sched-crop-plot')).toBe('द्राक्ष · B');
        expect(text('day-now')).toBe('6');
        expect(screen.getByTestId('map-plot-plot-2')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('map-plot-plot-1')).toHaveAttribute('aria-pressed', 'false');

        // A crop with no plot has nothing to tap on the map: it says so in one line (it was a tile that opened "या पिकात अजून प्लॉट नाही").
        expect(text('map-empty-crop-crop-2')).toContain('या पिकात अजून प्लॉट नाही');
        expect(screen.queryByTestId('sched-tabs')).toBeNull();
    });

    it('lane UI-8: every plot of every crop is on the one map; tapping a plot of the other crop chooses that crop and that plot', () => {
        mount([crop([plot(), plot({ id: 'plot-2', name: 'B' })], { color: 'bg-purple-500' }), crop([plot({ id: 'plot-9', name: 'Z' })], { id: 'crop-2', name: 'Onion', color: 'bg-pink-500' })]);
        for (const id of ['plot-1', 'plot-2', 'plot-9']) expect(screen.getByTestId(`map-plot-${id}`)).toBeInTheDocument();
        expect(text('sched-crop-plot')).toContain('· A');
        fireEvent.click(screen.getByTestId('map-plot-plot-9'));
        expect(text('sched-crop-plot')).toContain('· Z');
        expect(screen.getByTestId('map-plot-plot-9')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('map-plot-plot-1')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByTestId('map-plot-plot-2'));
        expect(text('sched-crop-plot')).toContain('· B');
    });

    it('one crop with one plot: the map shows that one plot; the old crop and plot chips are gone', () => {
        mount();
        expect(screen.getByTestId('map-plot-plot-1')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('crop-pick')).toBeNull();
        expect(screen.queryByTestId('plot-pick')).toBeNull();
    });
});

describe('the \'N days behind\' banner', () => {
    const shifted = () => plot({ scheduleShifts: [{ id: 's1', plotId: 'plot-1', date: k(3), shiftDays: 2, reason: 'WEATHER' }] } as never);

    it('in Marathi; the crop\'s day is the card\'s day and the editor\'s day — one rule, one number (V2-06)', () => {
        mount([crop([shifted()])]);
        expect(text('behind-banner')).toContain('शेड्यूल 2 दिवस मागे चाललं आहे');
        // Calendar: 9 days since day 0. Crop: 9 less the 2-day shift = 7 — the same 7 as the card's tile
        // (the old banner counted 1-based from the plot's start date and said 8 here).
        expect(text('day-now')).toBe('7');
        expect(text('behind-banner')).toContain('कॅलेंडरप्रमाणे दिवस 9 · पिकासाठी दिवस 7');
        fireEvent.click(screen.getByTestId('open-editor'));
        expect(text('editor-today-day')).toBe('म्हणजे आज दिवस 7');
    });

    it('after the editor moves day 0, the banner counts from the new day 0 (it kept the old start date before)', () => {
        mount([crop([shifted()])]);
        fireEvent.click(screen.getByTestId('open-editor'));
        fireEvent.change(screen.getByTestId('editor-date'), { target: { value: k(1) } });
        expect(text('editor-today-day')).toBe('म्हणजे आज दिवस 6');
        fireEvent.click(screen.getByTestId('editor-save'));
        expect(text('day-now')).toBe('6');
        expect(text('behind-banner')).toContain('कॅलेंडरप्रमाणे दिवस 8 · पिकासाठी दिवस 6');
    });

    it('not drawn when nothing slipped', () => {
        mount();
        expect(screen.queryByTestId('behind-banner')).toBeNull();
    });
});

describe('honest states', () => {
    it('nobody chose the schedule: it says so and opens the library', () => {
        mount([crop(undefined, { activeScheduleId: null })]);
        expect(text('default-schedule-note')).toContain('हे ॲपमधलं मूळ शेड्यूल आहे. तुम्ही अजून शेड्यूल निवडलेलं नाही.');
        fireEvent.click(screen.getByTestId('default-schedule-library'));
        expect(text('page-title')).toBe('शेड्यूल निवडा'); // lane UI-8: the library's one title (picture L2)
    });

    it('the schedule has ended: said plainly, and no stage says "तुम्ही इथे आहात"', () => {
        const old = plot({ startDate: k(-60), schedule: { ...plot().schedule, referenceDate: k(-60) } });
        mount([crop([old])]);
        expect(text('sched-ended')).toBe('या शेड्यूलचे सगळे दिवस संपले');
        expect(screen.queryByTestId('stage-line')).toBeNull();
        expect(screen.getByTestId('stage-row-2')).toHaveAttribute('data-current', 'no');
        expect(screen.getByTestId('stage-ribbon').textContent).toContain('तुम्ही इथे आहात'); // the overall pin, at the end
        expect(within(screen.getByTestId('stage-ribbon')).getAllByText('तुम्ही इथे आहात')).toHaveLength(1);
    });

    it('the today card after the end says it ended — never "दिवस 69 / 40", never "तुम्ही इथे आहात" (V2-03)', () => {
        const old = plot({ startDate: k(-60), schedule: { ...plot().schedule, referenceDate: k(-60) } });
        mount([crop([old])]);
        expect(text('today-pill')).toBe('आज · या शेड्यूलचे सगळे दिवस संपले');
        expect(text('today-card')).not.toMatch(/दिवस 69|तुम्ही इथे आहात/);
    });

    it('the today card before day 0 says when it starts — never "दिवस -3" and no pin (V2-03)', () => {
        const soon = plot({ startDate: k(12), schedule: { ...plot().schedule, referenceDate: k(12) } });
        mount([crop([soon])]);
        expect(text('day-now')).toBe('—');
        expect(text('not-started')).toBe('शेड्यूल 3 दिवसांनी सुरू होईल');
        expect(text('today-pill')).toBe('आज · शेड्यूल 3 दिवसांनी सुरू होईल');
        expect(text('today-card')).not.toMatch(/-3|तुम्ही इथे आहात/);
    });

    it('while on the schedule the pill is "तुम्ही इथे आहात · आज · दिवस 9 / 40"', () => {
        mount();
        expect(text('today-pill')).toBe('तुम्ही इथे आहात · आज · दिवस 9 / 40');
    });
});

describe('the risk card counts what the page shows (V2-01)', () => {
    const tools = () => text('sched-tools');

    it('day 9: "आज 1 कामं बाकी" — the one open line on the आज card (the weekly weeding is not counted daily)', () => {
        mount();
        const open = within(screen.getByTestId('today-parts')).getAllByTestId(/^item-/);
        expect(open.map(e => e.textContent)).toEqual(['ठिबक सिंचनअपेक्षित']);
        expect(text('open-work')).toContain('आज 1 कामं बाकी');
        expect(tools()).not.toContain('आज 2 कामं बाकी');
    });

    it('a plot on the app\'s stand-in schedule: "no schedule", and no "कामं बाकी" from the stand-in under it', () => {
        const standIn = getTemplateForCrop('Tomato');
        expect(isFallbackTemplate(standIn)).toBe(true);
        const p = plot({ schedule: { ...plot().schedule, templateId: standIn.id, referenceType: 'PLANTING' } });
        mount([crop([p], { name: 'Tomato', activeScheduleId: null })]);
        expect(text('sched-no-schedule')).toContain('या पिकासाठी अजून शेड्यूल नाही');
        expect(tools()).not.toContain('कामं बाकी');
        expect(text('last-water')).toBe('5 दिवसांपूर्वी'); // the log facts stay (as the tile; HONESTY-1 H10: no amber verdict beside it)
    });

    it('an ended schedule: "आज यात काही नाही" and no "कामं बाकी" beside it', () => {
        const old = plot({ startDate: k(-60), schedule: { ...plot().schedule, referenceDate: k(-60) } });
        mount([crop([old])]);
        expect(text('today-nothing')).toBe('आज यात काही नाही');
        expect(tools()).not.toContain('कामं बाकी');
    });

    it('watered today: the आज card shows it done and the risk card has no "आज … कामं बाकी"', () => {
        mount([crop()], [...LOGS, log(k(9), water())]);
        expect(tools()).not.toContain('आज 1 कामं बाकी');
    });

    it('the farmer\'s own to-do tasks keep their own line: open ones for this plot, due today or before', () => {
        const task = (id: string, extra: Partial<PlannedTask>): PlannedTask => ({
            id, title: 'औषध आणणे', plotId: 'plot-1', cropId: 'crop-1', dueDate: k(9), priority: 'normal', status: 'pending', sourceType: 'manual', createdAt: '2026-10-20T00:00:00Z', ...extra,
        });
        mount([crop()], LOGS, [
            task('t1', {}),
            task('t2', { dueDate: k(7) }),              // carried from day 7
            task('t3', { status: 'done' }),             // done
            task('t4', { dueDate: k(12) }),             // not due yet
            task('t5', { plotId: 'plot-9' }),           // another plot
        ]);
        expect(text('open-work')).toContain('करायच्या यादीत 2 कामं बाकी');
        expect(text('open-work')).toContain('आज 1 कामं बाकी'); // the schedule's own line is separate
    });
});

describe('today\'s tools', () => {
    it('last spray / last water, the risk card, today\'s spend → MoneyLens, Close Day in the app\'s own words', () => {
        const p = mount();
        expect(text('last-spray')).toBe('अजून नोंद नाही');
        expect(text('last-water')).toBe('5 दिवसांपूर्वी');
        expect(text('today-spend-amount')).toBe('₹ 250');
        fireEvent.click(screen.getByTestId('today-spend'));
        expect(screen.getByTestId('money-lens')).toBeInTheDocument();
        expect(text('close-day')).toBe('दिवस पूर्ण करा');
        // Founder change note 2026-11-17: no black block on the schedule tab; the button is the app's solid green.
        expect(screen.getByTestId('close-day').className).toContain('bg-emerald-600');
        expect(screen.getByTestId('close-day').className).not.toMatch(/stone-9|black/);
        fireEvent.click(screen.getByTestId('close-day'));
        expect(p.onCloseDay).toHaveBeenCalledTimes(1);
        noEnglish();
    });
});

describe('library + adopt', () => {
    it('its own page bar, Marathi names, the adopted schedule marked, stages with the schedule\'s own task names, ← मागे back', () => {
        mount();
        fireEvent.click(screen.getByTestId('open-library'));
        expect(text('page-title')).toBe('शेड्यूल निवडा'); // lane UI-8: it said "शेड्यूल लायब्ररी"; the three-step screen is titled by the picture's own words
        expect(text(`library-name-${TEMPLATE_ID}`)).toBe('द्राक्ष — हंगामी शेड्यूल');
        expect(text(`library-name-${SPRAY_TEMPLATE_ID}`)).toBe('द्राक्ष — फवारणी शेड्यूल');
        expect(text(`library-${TEMPLATE_ID}`)).toContain('वापरात आहे');
        expect(text(`library-${TEMPLATE_ID}`)).not.toMatch(/Adoption|Followers|\/100/);
        fireEvent.click(screen.getByTestId(`library-view-${SPRAY_TEMPLATE_ID}`));
        expect(text('library-stages-title')).toBe('द्राक्ष — फवारणी शेड्यूल');
        expect(screen.getAllByTestId('library-task-detail').map(e => e.textContent)).toEqual(['भुरीसाठी फवारणी', 'थ्रिप्ससाठी फवारणी']);
        fireEvent.click(screen.getByTestId('library-stages-back'));
        noEnglish();
        fireEvent.click(screen.getByTestId('page-back'));
        expect(text('page-title')).toBe('शेड्यूल');
    });

    it('the kept "shortest first" order really reorders by total days', () => {
        mount();
        fireEvent.click(screen.getByTestId('open-library'));
        const order = () => screen.getAllByTestId(/^library-name-/).map(e => e.getAttribute('data-testid'));
        expect(order()).toEqual([`library-name-${TEMPLATE_ID}`, `library-name-${SPRAY_TEMPLATE_ID}`]);
        fireEvent.click(screen.getByTestId('library-order-short'));
        expect(order()).toEqual([`library-name-${SPRAY_TEMPLATE_ID}`, `library-name-${TEMPLATE_ID}`]); // 30 days before 40
    });

    it('lane UI-8: choosing = pick the radio row, then the big button that names the plot; it saves for THAT plot, asks nothing more, and the page follows it', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const p = mount();
        fireEvent.click(screen.getByTestId('open-library'));
        expect(screen.getByTestId('library-confirm')).toBeDisabled(); // nothing picked yet: the button cannot be pressed
        fireEvent.click(screen.getByTestId(`library-pick-${SPRAY_TEMPLATE_ID}`));
        expect(text('library-confirm')).toBe('द्राक्ष · A साठी हे शेड्यूल लावा');
        fireEvent.click(screen.getByTestId('library-confirm'));
        expect(confirm).not.toHaveBeenCalled(); // the three steps ARE the confirmation (it asked "वापरायचं?" before)
        const saved = p.onUpdateCrops.mock.calls[0][0] as CropProfile[];
        expect(saved[0].activeScheduleId).toBe(TEMPLATE_ID); // that plot's choice, not the crop's (it was crop-wide before)
        expect(saved[0].plots[0].schedule).toMatchObject({ templateId: SPRAY_TEMPLATE_ID, referenceDate: REF, stageOverrides: [], expectationOverrides: [] });
        expect(text('page-title')).toBe('शेड्यूल'); // and the page is back on the शेड्यूल tab
        expect(text('sched-name')).toBe('द्राक्ष — फवारणी शेड्यूल');
    });
});

describe('the schedule editor (शेड्यूल बदला) — Marathi, and its choice takes effect', () => {
    it('opens on this plot, its schedule and its day 0; only controls that take effect; no English', () => {
        mount();
        fireEvent.click(screen.getByTestId('open-editor'));
        expect(text('page-title')).toBe('शेड्यूल बदला');
        expect(text('editor-plot-name')).toBe('द्राक्ष · A');
        expect(screen.getByTestId(`editor-schedule-${TEMPLATE_ID}`)).toHaveAttribute('aria-pressed', 'true');
        expect(text(`editor-schedule-${TEMPLATE_ID}`)).toContain('द्राक्ष — हंगामी शेड्यूल');
        expect(text(`editor-schedule-${TEMPLATE_ID}`)).toContain('एकूण दिवस 40 · स्टेज 2');
        expect(text('editor-day-zero')).toContain('छाटणीची तारीख (दिवस 0)');
        expect((screen.getByTestId('editor-date') as HTMLInputElement).value).toBe(REF);
        expect(text('editor-today-day')).toBe('म्हणजे आज दिवस 9');
        expect(text('editor-save')).toBe('जतन करा');
        expect(screen.queryByTestId('editor-this-plot-only')).toBeNull(); // one plot only
        noEnglish();
    });

    it('a different schedule and a new day 0: saved, and the page now shows that schedule — two sprays, two lines', async () => {
        const p = mount();
        fireEvent.click(screen.getByTestId('open-editor'));
        fireEvent.click(screen.getByTestId(`editor-schedule-${SPRAY_TEMPLATE_ID}`));
        fireEvent.change(screen.getByTestId('editor-date'), { target: { value: k(1) } });
        expect(text('editor-today-day')).toBe('म्हणजे आज दिवस 8');
        fireEvent.click(screen.getByTestId('editor-save'));

        const saved = p.onUpdateCrops.mock.calls[0][0] as CropProfile[];
        expect(saved[0].activeScheduleId).toBe(TEMPLATE_ID); // spec: lane L8b-2 (founder C2) - the editor's choice is that plot's, not the crop's
        expect(saved[0].plots[0].schedule).toMatchObject({ templateId: SPRAY_TEMPLATE_ID, referenceDate: k(1) });
        expect(text('page-title')).toBe('शेड्यूल');
        expect(text('sched-name')).toBe('द्राक्ष — फवारणी शेड्यूल');
        expect(text('day-now')).toBe('8');
        expect(text('stage-line')).toContain('फुलोऱ्यापूर्वी');
        await screen.findByTestId('owed-card'); // UI-4: the page is drawn again with its rows closed; autoOpenFolds opens them
        expect(screen.getAllByTestId('owed-spray').map(e => e.textContent)).toEqual([
            expect.stringContaining('भुरीसाठी फवारणी'), expect.stringContaining('थ्रिप्ससाठी फवारणी'),
        ]);
    });

    it('a crop with two plots: picking another schedule says it applies to this plot only (founder C2); the library is the crop-wide door', () => {
        mount([crop([plot(), plot({ id: 'plot-2', name: 'B' })])]);
        fireEvent.click(screen.getByTestId('open-editor'));
        expect(screen.queryByTestId('editor-this-plot-only')).toBeNull();
        // lane UI-7: the editor's plot choice is the shared chip too — the crop's colour dot, a tick on the chosen plot
        expect(screen.getByTestId('editor-plot-plot-1').querySelector('[data-part="dot"]')).toBeTruthy();
        expect(screen.getByTestId('editor-plot-plot-1')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('editor-plot-plot-2'));
        expect(screen.getByTestId('editor-plot-plot-2')).toHaveAttribute('aria-pressed', 'true');
        expect(text('editor-plot-name')).toBe('द्राक्ष · B');
        fireEvent.click(screen.getByTestId(`editor-schedule-${SPRAY_TEMPLATE_ID}`));
        expect(text('editor-this-plot-only')).toBe('हे शेड्यूल फक्त या प्लॉटसाठी लागू होईल. सगळ्या प्लॉटसाठी लायब्ररीतून निवडा.');
        // B013: the line is shown only when the pick would change THIS plot: picking what it already follows hides it.
        fireEvent.click(screen.getByTestId(`editor-schedule-${TEMPLATE_ID}`));
        expect(screen.queryByTestId('editor-this-plot-only')).toBeNull();
    });
});

describe('the day grid (दिवसवार तक्ता)', () => {
    it('Marathi columns, land-preparation rows in the first days, राहिलं on a missed day, here on today, no English weather words', () => {
        mount();
        fireEvent.click(screen.getByTestId('open-grid'));
        expect(text('page-title')).toBe('दिवसवार तक्ता');
        const grid = screen.getByTestId('schedule-grid');
        for (const w of ['सिंचन', 'खत', 'फवारणी', 'कामे', 'तयारी']) expect(grid.textContent).toContain(w);
        expect(text(`grid-${k(-1)}`)).toContain('तयारी');
        expect(text(`grid-${k(6)}`)).toContain('राहिलं');
        expect(text(`grid-${k(8)}`)).toContain('बुरशीनाशक फवारणी');
        expect(text(`grid-${k(9)}`)).toContain('तुम्ही इथे आहात');
        expect(text(`grid-${k(4)}`)).toContain('31');
        noEnglish();
        fireEvent.click(within(screen.getByTestId(`grid-${k(8)}`)).getAllByRole('button')[0]);
        expect(text('day-sheet-title')).toContain('दिवस 8');
    });
});
