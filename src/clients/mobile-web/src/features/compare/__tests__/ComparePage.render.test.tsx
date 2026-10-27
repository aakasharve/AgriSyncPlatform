// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-1, CMP-2)
 *
 * तुलना as the founder approved it (PLR-D9 T7): one card per plot, "x पैकी y कामं झाली" for 7 days, a bar,
 * at most three "अजून करायचं" rows each with "झालं, सांगा" that opens the log flow for THAT plot, otherwise
 * "सगळं वेळेवर — छान!"; a plot with no schedule says so in Marathi with a real door to शेड्यूल; "पूर्ण शेड्यूल
 * पाहा" opens शेड्यूल; no back of its own (it is a home tab); no English; every old feature still reachable
 * under "पूर्ण तपशील", where the planned cost is "—" (P4).
 *
 * Only the edges are mocked: the schedule catalog lookup, the comparison engine's summary (so the test does not
 * depend on today's date — its matcher, which the 7-day week runs, is the REAL one), the module-level money store
 * and the money drawer.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CropProfile, DailyLog, ExecutedItem, ExecutionBucket, PlannedItem, Plot, PlotComparisonSummary } from '../../../types';

const SCHEDULED = new Set(['g1', 'g2', 'g3', 'g4']);
vi.mock('../../../infrastructure/reference/TemplateCatalog', () => ({
    getTemplateById: (id: string) => (id === 'sched-1' ? { id: 'sched-1' } : undefined),
}));

// `isMatched` is the stage-wide engine's flag (the details read it); the card's week reads the recorded work.
const item = (id: string, name: string, expectedDay: number, isMatched: boolean): PlannedItem =>
    ({ id, name, expectedDay, frequency: 'Once', isMatched, status: isMatched ? 'COMPLETED' : 'MISSED' }) as PlannedItem;
const work = (id: string, name: string, executedDay: number, isExtra = false): ExecutedItem =>
    ({ id, sourceLogId: 'l1', sourceEventId: id, name, executedDate: '', executedDay, isMatchedToPlan: !isExtra, isExtra });
const bucket = (bucketType: ExecutionBucket['bucketType'], planned: PlannedItem[], executed: ExecutedItem[] = []): ExecutionBucket =>
    ({ bucketType, bucketLabel: '', planned, executed, plannedCount: planned.length, executedCount: executed.length, matchedCount: planned.filter(p => p.isMatched).length, missedCount: planned.filter(p => !p.isMatched).length, extraCount: executed.filter(e => e.isExtra).length, health: 'ON_TRACK' }) as ExecutionBucket;

// An extra spray the log recorded with no product name: the engine names it 'Spray' itself
// (`plotComparisonService.ts`), and the log's issue is a raw code with an English reason. Recorded before the
// week (day 30), with no spray planned then, so it stays extra.
const EXTRA_SPRAY = work('e1', 'Spray', 30, true);

const SUMMARIES: Record<string, ExecutionBucket[]> = {
    // g1: 4 due in the week (days 34–40), 1 recorded; water open twice, spray open, plus one older water miss
    g1: [
        bucket('IRRIGATION', [item('w1', 'Drip Irrigation #1', 20, false), item('w2', 'Drip Irrigation #2', 38, false), item('w3', 'Drip Irrigation #3', 40, false)]),
        bucket('SPRAY', [item('s1', 'Foliar Spray', 39, false)], [EXTRA_SPRAY]),
        bucket('ACTIVITY', [item('a1', 'Manual Weeding', 37, true)], [work('ea1', 'Manual Weeding', 37)]),
    ],
    // g2: everything due this week was recorded — but an earlier stage left a pruning unrecorded
    g2: [bucket('IRRIGATION', [item('x1', 'Drip Irrigation #1', 39, true), item('x2', 'Drip Irrigation #2', 40, true)], [work('ex1', 'Drip - 2hrs', 39), work('ex2', 'Drip - 2hrs', 40)])],
    // g4: everything due this week was recorded, nothing older open
    g4: [bucket('IRRIGATION', [item('y1', 'Drip Irrigation #1', 36, true)], [work('ey1', 'Drip - 1hrs', 36)])],
    // g5: the crop's schedule is known but this plot has no schedule start, so the engine plans nothing — and
    // so every job recorded on it comes back flagged extra (I14-V3-03)
    g5: [bucket('IRRIGATION', [], [work('ez1', 'Drip - 1hrs', 39, true)])],
};
// g2 also has an EARLIER stage with a pruning never recorded (an "older" miss from another stage).
const EARLIER: Record<string, ExecutionBucket[]> = { g2: [bucket('ACTIVITY', [item('p0', 'Pruning', 5, false)])] };

vi.mock('../plotComparisonService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../plotComparisonService')>()),
    generatePlotComparison: (plot: Plot) => {
        // g3: the comparison cannot be worked out (the real engine throws on a broken schedule)
        if (plot.id === 'g3') throw new Error('no stage');
        // The REAL template stage names are English (`GetScheduleTemplatesHandler.cs`).
        const current = { stageId: 's1', stageName: 'Flowering & Fruit Set', stageCode: 'FLOWERING_FRUIT_SET', plannedStartDay: 30, plannedEndDay: 60, status: 'IN_PROGRESS', completionPercent: 0, buckets: SUMMARIES[plot.id], issues: [] };
        const earlier = EARLIER[plot.id]
            ? [{ stageId: 's0', stageName: 'Post Pruning', stageCode: 'ESTABLISHMENT', plannedStartDay: 0, plannedEndDay: 29, status: 'COMPLETED', completionPercent: 0, buckets: EARLIER[plot.id], issues: [] }]
            : [];
        return {
            plotId: plot.id, plotName: plot.name, cropId: 'grape', cropName: 'द्राक्ष', referenceDate: '2026-09-15', currentDay: 40,
            currentStage: current, stages: [...earlier, current],
            overallHealth: 'GOOD', overallCompletionPercent: 0, totalPlanned: 0, totalExecuted: 0, totalMissed: 0, totalExtra: 0, actualCostSpent: 0,
        } as unknown as PlotComparisonSummary;
    },
}));
vi.mock('../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 1250 } }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({
    MoneyLensDrawer: ({ isOpen, filters }: { isOpen: boolean; filters: object }) => (isOpen ? <div data-testid="money-lens">{JSON.stringify(filters)}</div> : null),
}));

import { ComparePage } from '../ComparePage';

const plot = (id: string, name: string, extra: Partial<Plot> = {}): Plot => ({ id, name, baseline: {}, schedule: SCHEDULED.has(id) ? { templateId: 'sched-1', referenceDate: '2026-09-15' } : undefined, ...extra }) as unknown as Plot;
const CROPS: CropProfile[] = [
    {
        id: 'grape', name: 'द्राक्ष', color: 'bg-purple-500',
        plots: [
            plot('g1', 'सोनाका'), plot('g2', 'थॉम्पसन'), plot('g3', 'जुना प्लॉट'), plot('g4', 'नवा प्लॉट'),
            // the schedule is known (template) but no start date was ever set on this plot
            plot('g5', 'माळ', { schedule: { templateId: 'sched-1' } as unknown as Plot['schedule'] }),
        ],
    } as unknown as CropProfile,
    { id: 'cane', name: 'ऊस', color: 'bg-emerald-500', plots: [plot('c1', 'ऊस १')] } as unknown as CropProfile,
];
const LOGS = [{
    id: 'l1', date: '2026-10-24', context: { selection: [{ cropId: 'grape', selectedPlotIds: ['g1'] }] },
    cropActivities: [], labour: [], machinery: [], irrigation: [],
    inputs: [{ id: 'in1', method: 'Spray', issue: { issueType: 'WEATHER', reason: 'heavy rain expected', severity: 'HIGH' } }],
}] as unknown as DailyLog[];

const ENGLISH = /Report Card|Where You Are|Behind|Do this now|late|Back|No Schedule|Go to Schedule|Planned Rs|Missed|Extra Work|Flowering|Pruning|Spray|WEATHER|heavy rain/i;

// g3's comparison throws on purpose; `compareRows.ts` logs it. Keep only THAT line out of the output.
const realConsoleError = console.error;
beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        if (args[0] !== 'Error generating comparison:') realConsoleError(...args);
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderPage = (over: Partial<React.ComponentProps<typeof ComparePage>> = {}) => {
    const props = { crops: CROPS, logs: LOGS, onTellPlot: vi.fn(), onTell: vi.fn(), onOpenSchedule: vi.fn(), ...over };
    render(<ComparePage {...props} />);
    return props;
};

describe('तुलना — one gentle card per plot (CMP-1)', () => {
    it('shows "x पैकी y कामं झाली", the percent and a bar for each scheduled plot', () => {
        renderPage();
        expect(screen.getByText('शेड्यूलप्रमाणे काम होतंय का?')).toBeInTheDocument();
        expect(screen.getByTestId('compare-week-line-g1')).toHaveTextContent('4 पैकी 1 कामं झाली');
        expect(screen.getByTestId('compare-percent-g1')).toHaveTextContent('25%');
        expect(screen.getByTestId('compare-bar-g1')).toBeInTheDocument();
        expect(screen.getByTestId('compare-week-line-g2')).toHaveTextContent('2 पैकी 2 कामं झाली');
        expect(screen.getByTestId('compare-percent-g2')).toHaveTextContent('100%');
    });

    it('lists what is still open (grouped, Marathi) with "झालं, सांगा" that opens the log flow for THAT plot', () => {
        const props = renderPage();
        const todo = screen.getByTestId('compare-todo-g1');
        expect(within(todo).getByText('अजून करायचं')).toBeInTheDocument();
        expect(within(todo).getByText('ठिबकने पाणी (2 वेळा)')).toBeInTheDocument();
        expect(within(todo).getByText('फवारणी')).toBeInTheDocument();
        expect(within(todo).getAllByText('झालं, सांगा')).toHaveLength(2);
        fireEvent.click(screen.getByTestId('compare-tell-g1-0'));
        expect(props.onTellPlot).toHaveBeenCalledWith('grape', 'g1');
        // the older open watering is counted, not listed
        expect(screen.getByTestId('compare-older-g1')).toHaveTextContent('त्याआधीची 1 कामं नोंदलेली नाहीत');
    });

    it('names the crop on every card, so two crops\' plots are told apart', () => {
        renderPage();
        expect(screen.getByTestId('compare-crop-g1')).toHaveTextContent('द्राक्ष');
        expect(screen.getByTestId('compare-crop-c1')).toHaveTextContent('ऊस');
    });

    it('a plot whose comparison could not be worked out says "माहिती नाही" and "—" — never "no work was due" (P4)', () => {
        renderPage();
        expect(screen.getByTestId('compare-week-line-g3')).toHaveTextContent('माहिती नाही');
        expect(screen.getByTestId('compare-week-line-g3')).not.toHaveTextContent('काम नव्हतं');
        expect(screen.getByTestId('compare-percent-g3')).toHaveTextContent('—');
        expect(screen.queryByTestId('compare-bar-g3')).toBeNull();
        expect(screen.queryByTestId('compare-details-toggle-g3')).toBeNull();
    });

    it('a plot where everything due was done says "सगळं वेळेवर — छान!" and lists nothing', () => {
        renderPage();
        expect(screen.getByTestId('compare-week-line-g4')).toHaveTextContent('1 पैकी 1 कामं झाली');
        expect(screen.getByTestId('compare-ontime-g4')).toHaveTextContent('सगळं वेळेवर — छान!');
        expect(screen.queryByTestId('compare-todo-g4')).toBeNull();
        expect(screen.queryByTestId('compare-older-g4')).toBeNull();
    });

    it('the week all done but older work unrecorded: praises the WEEK, never "everything on time" above the older count', () => {
        renderPage();
        expect(screen.getByTestId('compare-week-line-g2')).toHaveTextContent('2 पैकी 2 कामं झाली');
        expect(screen.getByTestId('compare-ontime-g2')).toHaveTextContent('या आठवड्याचं सगळं झालं — छान!');
        expect(screen.getByTestId('compare-ontime-g2')).not.toHaveTextContent('सगळं वेळेवर');
        expect(screen.getByTestId('compare-older-g2')).toHaveTextContent('त्याआधीची 1 कामं नोंदलेली नाहीत');
        expect(screen.queryByTestId('compare-todo-g2')).toBeNull();
    });

    it('a plot with no schedule start: "माहिती नाही", "—" and why — never "no work was due" (I14-V2-03, P4)', () => {
        renderPage();
        expect(screen.getByTestId('compare-week-line-g5')).toHaveTextContent('माहिती नाही');
        expect(screen.getByTestId('compare-week-line-g5')).not.toHaveTextContent('काम नव्हतं');
        expect(screen.getByTestId('compare-percent-g5')).toHaveTextContent('—');
        expect(screen.getByTestId('compare-nostart-g5')).toHaveTextContent('या प्लॉटवर शेड्यूल कोणत्या दिवसापासून सुरू झालं ते नोंदलेलं नाही');
        expect(screen.queryByTestId('compare-bar-g5')).toBeNull();
        expect(screen.queryByTestId('compare-ontime-g5')).toBeNull();
        // a plot WITH a start never shows that line
        expect(screen.queryByTestId('compare-nostart-g1')).toBeNull();
    });

    it('a plot with no schedule says so in Marathi and its button opens the real शेड्यूल page', () => {
        const props = renderPage();
        expect(screen.getByTestId('compare-noschedule-c1')).toHaveTextContent('या प्लॉटला अजून शेड्यूल लावलेलं नाही');
        expect(screen.queryByTestId('compare-percent-c1')).toBeNull();
        fireEvent.click(screen.getByTestId('compare-adopt-c1'));
        expect(props.onOpenSchedule).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('compare-schedule'));
        expect(screen.getByTestId('compare-schedule')).toHaveTextContent('पूर्ण शेड्यूल पाहा');
        expect(props.onOpenSchedule).toHaveBeenCalledTimes(2);
    });

    it('is a home tab: no back button of its own, and no English anywhere (CMP-2)', () => {
        renderPage();
        expect(screen.queryByTestId('page-back')).toBeNull();
        expect(screen.queryByRole('button', { name: /back|मागे/i })).toBeNull();
        expect(screen.getByTestId('compare-page').textContent).not.toMatch(ENGLISH);
    });
});

describe('तुलना — every old feature kept under "पूर्ण तपशील"', () => {
    it('opens the plot details: where we are, money ("—" for the planned cost), categories, checklist, replica, extra work', () => {
        renderPage();
        expect(screen.queryByTestId('compare-details-g1')).toBeNull();
        fireEvent.click(screen.getByTestId('compare-details-toggle-g1'));
        const details = screen.getByTestId('compare-details-g1');
        expect(within(details).getByText('आता कुठे आहोत')).toBeInTheDocument();
        // the template's English stage "Flowering & Fruit Set" is said in Marathi
        expect(screen.getByTestId('compare-stage-g1')).toHaveTextContent('फुलोरा ते फळधारणा');
        expect(within(details).getByText('हंगामाचा दिवस 40 · टप्प्याचा दिवस 11')).toBeInTheDocument();
        expect(screen.getByTestId('compare-planned-cost-g1')).toHaveTextContent('—');
        // no watering time recorded for the plot: expected water hours are "—", not an assumed 60 minutes
        expect(screen.getByTestId('compare-water-g1')).toHaveTextContent('पाण्याची वेळ नोंदलेली नाही');
        expect(within(details).getByText('कामाचे प्रकार')).toBeInTheDocument();
        expect(within(details).getByText('आतापर्यंतची यादी')).toBeInTheDocument();
        expect(within(details).getByText('जास्तीचं केलेलं काम')).toBeInTheDocument();
        expect(details.textContent).not.toMatch(ENGLISH);
        // the checklist never says "N days late"
        expect(within(details).getAllByText(/अजून नोंद नाही/).length).toBeGreaterThan(0);
    });

    it('extra work: the engine\'s "Spray" and the issue code "WEATHER" are said in Marathi; his English reason is not printed', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('compare-details-toggle-g1'));
        const extra = screen.getByTestId('compare-extra-g1');
        expect(within(extra).getByText('फवारणी')).toBeInTheDocument();
        expect(within(extra).getByText('कारण: पाऊस / हवामान')).toBeInTheDocument();
        expect(extra.textContent).not.toMatch(/Spray|WEATHER|heavy rain/);
    });

    it('an older miss from an EARLIER stage, counted on the card, is really there in the details list', () => {
        renderPage();
        expect(screen.getByTestId('compare-older-g2')).toHaveTextContent('त्याआधीची 1 कामं नोंदलेली नाहीत — पूर्ण तपशीलात पाहा');
        fireEvent.click(screen.getByTestId('compare-details-toggle-g2'));
        const list = screen.getByTestId('compare-checklist-g2');
        expect(within(list).getByText('आतापर्यंतची यादी')).toBeInTheDocument();
        expect(within(list).getByText('छाटणी')).toBeInTheDocument();
    });

    it('no extra work at all: says "so far", not "in this stage" (the list covers every stage begun)', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('compare-details-toggle-g4'));
        expect(screen.getByTestId('compare-extra-none-g4')).toHaveTextContent('आतापर्यंत जास्तीचं काम नाही.');
        expect(screen.getByTestId('compare-extra-g4')).not.toHaveTextContent('या टप्प्यात');
    });

    it('a plot with no schedule start opens its SPEND only — never "वेळेवर आहे" or every job called extra (I14-V3-03, P4)', () => {
        renderPage();
        // a plot WITH a start still offers its full details
        expect(screen.getByTestId('compare-details-toggle-g1')).toHaveTextContent('पूर्ण तपशील पाहा');
        const toggle = screen.getByTestId('compare-details-toggle-g5');
        expect(toggle).toHaveTextContent('खर्च पाहा');
        expect(toggle).not.toHaveTextContent('पूर्ण तपशील');
        fireEvent.click(toggle);
        const details = screen.getByTestId('compare-details-g5');
        // what is real without a plan stays: the spend so far, with its money link; the planned cost is "—"
        expect(screen.getByTestId('compare-planned-cost-g5')).toHaveTextContent('—');
        fireEvent.click(within(screen.getByTestId('compare-money-g5')).getByRole('button'));
        expect(screen.getByTestId('money-lens')).toHaveTextContent('"cropId":"grape","plotId":"g5"');
        // nothing that reads the (missing) plan: no status, no counts, no kinds of work, no checklist, no replica, no "extra"
        for (const part of ['now', 'stage', 'done', 'open', 'categories', 'checklist', 'replica', 'extra']) {
            expect(screen.queryByTestId(`compare-${part}-g5`)).toBeNull();
        }
        expect(details.textContent).not.toMatch(/वेळेवर आहे|जास्तीचं|हंगामाचा दिवस/);
        // and the card's own "तुलना करता येत नाही" stays, uncontradicted
        expect(screen.getByTestId('compare-nostart-g5')).toHaveTextContent('तुलना करता येत नाही');
    });

    it('the checklist is one row per kind of work with its count, and each row unfolds its items (I14-V3-06)', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('compare-details-toggle-g1'));
        const water = screen.getByTestId('compare-checklist-g1-IRRIGATION');
        // three "Drip Irrigation #n" items are ONE row, not three
        const groups = within(water).getAllByTestId(/^compare-checklist-group-g1-IRRIGATION-\d+$/);
        expect(groups).toHaveLength(1);
        expect(within(groups[0]).getByText('ठिबकने पाणी')).toBeInTheDocument();
        expect(screen.getByTestId('compare-checklist-group-g1-IRRIGATION-0-count')).toHaveTextContent('झालं 0 · बाकी 3');
        // folded: the per-day rows are not a wall until he asks
        expect(within(water).queryByText(/ठरलेला दिवस/)).toBeNull();
        const toggle = screen.getByTestId('compare-checklist-group-g1-IRRIGATION-0-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        // nothing dropped: every item, with its planned day and "अजून नोंद नाही"
        const items = screen.getByTestId('compare-checklist-group-g1-IRRIGATION-0-items');
        expect(within(items).getByText('ठरलेला दिवस 20 · अजून नोंद नाही')).toBeInTheDocument();
        expect(within(items).getByText('ठरलेला दिवस 38 · अजून नोंद नाही')).toBeInTheDocument();
        expect(within(items).getByText('ठरलेला दिवस 40 · अजून नोंद नाही')).toBeInTheDocument();
        // a done kind of work reads as done
        expect(screen.getByTestId('compare-checklist-group-g1-ACTIVITY-0-count')).toHaveTextContent('झालं 1 · बाकी 0');
    });

    it('the money link opens the money lens for this crop and plot', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('compare-details-toggle-g1'));
        fireEvent.click(within(screen.getByTestId('compare-money-g1')).getByRole('button'));
        expect(screen.getByTestId('money-lens')).toHaveTextContent('"cropId":"grape","plotId":"g1"');
    });

    it('the schedule replica folds open with Marathi columns and day rows', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('compare-details-toggle-g1'));
        fireEvent.click(screen.getByTestId('compare-replica-toggle-g1'));
        const replica = screen.getByTestId('compare-replica-g1');
        expect(within(replica).getByText('सगळे दिवस दाखवा')).toBeInTheDocument();
        expect(screen.getByTestId('replica-day-41')).toBeInTheDocument();
        expect(replica.textContent).not.toMatch(/\bDAY\b|STD|DONE|MISSED/);
    });
});

describe('तुलना — honest empty states', () => {
    it('no crops: says so in Marathi', () => {
        renderPage({ crops: [] });
        expect(screen.getByTestId('compare-no-plots')).toHaveTextContent('अजून पीक किंवा प्लॉट नोंदलेला नाही');
    });

    it('nothing recorded yet: says so, and "काम सांगा" opens the log flow', () => {
        const props = renderPage({ logs: [] });
        expect(screen.getByTestId('compare-no-logs')).toHaveTextContent('अजून एकही काम नोंदलेलं नाही');
        fireEvent.click(screen.getByTestId('compare-tell-first'));
        expect(props.onTell).toHaveBeenCalled();
        expect(screen.queryByTestId('compare-plot-g1')).toBeNull();
    });
});
