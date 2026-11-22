/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 7; founder D-H 2026-11-21 "Sorry My bad Dfes Must ask them")
 * - which schedule tasks DFES may ask "why wasn't this done?" about, and the engine asking it once per task.
 *
 * Only the "which template applies to this plot" indirection is substituted (the dfesScheduleWindow.test.ts pattern);
 * `derivePlannedItemsForDay` and `calculateDayNumber` stay the REAL plan engine.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CropProfile, Plot } from '../../../../domain/types/farm.types';
import type { DailyLog } from '../../../../domain/types/log.types';
import type { CropScheduleTemplate, PlotScheduleInstance } from '../../../scheduler/scheduler.types';
import type { MissedCard } from '../dfesWhyNot';
import type { DailyQuestionInputs, RecentQuestionEvent } from '../dfesQuestionEngine';

const TEMPLATE_ID = 'tpl_why_not';
const REF = '2026-11-01'; // day 0 of the plot's schedule

function template(overrides: Partial<CropScheduleTemplate> = {}): CropScheduleTemplate {
    return {
        id: TEMPLATE_ID, cropCode: 'grape', name: 'Test', referenceType: 'PRUNING',
        stages: [{ id: 'stg', templateId: TEMPLATE_ID, name: 'All', code: 'CUSTOM', dayStart: 0, dayEnd: 200, orderIndex: 1 }],
        periodicExpectations: [],
        // A spray due on day 10 (window days 8-12) and a pruning job due on day 7 (no tolerance).
        oneTimeExpectations: [
            { id: 'ot_spray', stageId: 'stg', operationTypeId: 'op_spray_gen', targetDayFromRef: 10, toleranceDays: 2 },
            { id: 'ot_prune', stageId: 'stg', operationTypeId: 'op_pruning', targetDayFromRef: 7 },
        ],
        createdBy: 'test', ownerType: 'USER',
        ...overrides,
    };
}

const schedule = (referenceDate = REF): PlotScheduleInstance => ({
    id: 'sch-1', plotId: 'plot-1', templateId: TEMPLATE_ID, referenceType: 'PRUNING',
    referenceDate, stageOverrides: [], expectationOverrides: [],
});

const plot = (overrides: Partial<Plot> = {}): Plot => ({ id: 'plot-1', name: 'Plot 1', baseline: { unit: 'Acre' }, schedule: schedule(), ...overrides });
const crops = (p: Plot = plot()): CropProfile[] => [{ id: 'crop-1', name: 'grape', iconName: 'grape', color: '#000', plots: [p], supportedTasks: [], workflow: [] }];

function log(date: string, overrides: Partial<DailyLog> = {}, plotId = 'plot-1'): DailyLog {
    return {
        id: `log-${date}-${plotId}`, date,
        context: { selection: [{ cropId: 'crop-1', cropName: 'grape', selectedPlotIds: [plotId], selectedPlotNames: ['P'] }] },
        dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...overrides,
    };
}

async function find(today: string, history: DailyLog[] = [], tpl: CropScheduleTemplate | null = template(), p: Plot = plot()): Promise<MissedCard[]> {
    vi.resetModules();
    vi.doMock('../../../scheduler/planning/ClientPlanEngine', async () => {
        const actual = await vi.importActual<typeof import('../../../scheduler/planning/ClientPlanEngine')>('../../../scheduler/planning/ClientPlanEngine');
        return { ...actual, scheduleTemplateForPlot: () => tpl ?? undefined };
    });
    const { findMissedCards } = await import('../dfesWhyNot');
    return findMissedCards({ crops: crops(p), history, plotId: 'plot-1', todayLocalDate: today });
}

afterEach(() => {
    vi.doUnmock('../../../scheduler/planning/ClientPlanEngine');
    vi.doUnmock('../dfesQuestionBank');
    vi.resetModules();
});

describe('lane DFES-Q - findMissedCards: only a fully passed, undone task of his own schedule', () => {
    it('while the window is still open nothing is asked (day 12 is the spray window\'s last day)', async () => {
        expect((await find('2026-11-13')).map(c => c.cardRef)).not.toContain(`plot-1:${TEMPLATE_ID}:${REF}:ot_spray`);
    });

    it('the day after the window closes, with no spray logged on the plot, the spray is a missed task', async () => {
        const cards = await find('2026-11-14'); // day 13
        const spray = cards.find(c => c.cardRef.endsWith(':ot_spray'));

        expect(spray).toEqual({
            cardRef: `plot-1:${TEMPLATE_ID}:${REF}:ot_spray`, plotId: 'plot-1', category: 'FOLIAR_SPRAY',
            dayNumber: 10, dateKey: '2026-11-11', workMr: 'फवारणी', dateMr: '११ नोव्हेंबर',
        });
    });

    it('a spray logged on the plot anywhere inside the window counts as done: nothing asked', async () => {
        const sprayed = log('2026-11-09', { inputs: [{ id: 'i1', method: 'Spray', mix: [] }] }); // day 8, first day of the window
        expect((await find('2026-11-14', [sprayed])).some(c => c.cardRef.endsWith(':ot_spray'))).toBe(false);
    });

    it('a spray outside the window, or on another plot, does not count', async () => {
        const early = log('2026-11-08', { inputs: [{ id: 'i1', method: 'Spray', mix: [] }] }); // day 7
        const otherPlot = log('2026-11-11', { inputs: [{ id: 'i2', method: 'Spray', mix: [] }] }, 'plot-2');
        expect((await find('2026-11-14', [early, otherPlot])).some(c => c.cardRef.endsWith(':ot_spray'))).toBe(true);
    });

    it('work of another kind inside the window does not hide a missed spray', async () => {
        const watered = log('2026-11-11', { irrigation: [{ id: 'w', method: 'Drip', source: 'well' }] });
        expect((await find('2026-11-14', [watered])).some(c => c.cardRef.endsWith(':ot_spray'))).toBe(true);
    });

    it('most recently closed first: the spray (closed day 12) before the pruning job (closed day 7)', async () => {
        const cards = await find('2026-11-14');
        expect(cards.map(c => c.cardRef.split(':').pop())).toEqual(['ot_spray', 'ot_prune']);
    });

    it('a task whose window closed more than 7 days ago is not asked about', async () => {
        // day 13: a pruning job that closed on day 4, nine days ago
        const cards = await find('2026-11-14', [], template({
            oneTimeExpectations: [{ id: 'ot_prune', stageId: 'stg', operationTypeId: 'op_pruning', targetDayFromRef: 4 }],
        }));
        expect(cards).toEqual([]);
    });

    it('a routine (periodic) task is never asked about', async () => {
        const cards = await find('2026-11-14', [], template({
            oneTimeExpectations: [],
            periodicExpectations: [{ id: 'pe', stageId: 'stg', operationTypeId: 'op_spray_gen', frequencyMode: 'EVERY_N_DAYS', frequencyValue: 3 }],
        }));
        expect(cards).toEqual([]);
    });

    it('no schedule, no template or no reference date: nothing honest to ask', async () => {
        expect(await find('2026-11-14', [], template(), plot({ schedule: undefined }))).toEqual([]);
        expect(await find('2026-11-14', [], null)).toEqual([]);
        expect(await find('2026-11-14', [], template(), plot({ schedule: schedule('') }))).toEqual([]);
    });

    it('a new season (a new reference date) makes a new card for the same task', async () => {
        const next = await find('2027-11-14', [], template(), plot({ schedule: schedule('2027-11-01') }));
        expect(next[0].cardRef).toBe(`plot-1:${TEMPLATE_ID}:2027-11-01:ot_spray`);
    });
});

describe('lane DFES-Q - the engine asks why once per task, in the one-a-day slot', () => {
    const card: MissedCard = {
        cardRef: `plot-1:${TEMPLATE_ID}:${REF}:ot_spray`, plotId: 'plot-1', category: 'FOLIAR_SPRAY',
        dayNumber: 10, dateKey: '2026-11-11', workMr: 'फवारणी', dateMr: '११ नोव्हेंबर',
    };
    const second: MissedCard = { ...card, cardRef: `plot-1:${TEMPLATE_ID}:${REF}:ot_prune`, category: 'ACTIVITY', workMr: 'काम', dateMr: '६ नोव्हेंबर', dateKey: '2026-11-06' };

    const inputs = (over: Partial<DailyQuestionInputs> = {}): DailyQuestionInputs => ({
        crop: 'grape', todayLocalDate: '2026-11-14', askedOnLocalDate: '2026-11-14',
        engagement: { totalRichDays: 0, unlockStatus: 'locked' }, recentEvents: [], missedCards: [card], ...over,
    });
    const asked = (cardRef: string, createdAtLocalDate = '2026-11-10'): RecentQuestionEvent => ({
        questionKey: 'schedule.why_not', createdAtLocalDate, ageDays: 4, skipped: false, dailyLogId: null, scheduleCardRef: cardRef,
    });

    /** The engine with the why-not sentence ticked (as the founder's approval will do); the shipped entry stays a draft. */
    async function engineWithTickedWhyNot() {
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            const ticked = { ...actual.findQuestion('schedule.why_not')!, marathiApproved: true };
            return { ...actual, findQuestion: (key: string) => (key === 'schedule.why_not' ? ticked : actual.findQuestion(key)) };
        });
        return import('../dfesQuestionEngine');
    }

    it('the shipped sentence is a draft: never asked until the founder ticks it', async () => {
        vi.resetModules();
        const { selectDailyQuestion } = await import('../dfesQuestionEngine');
        expect(selectDailyQuestion(inputs())?.question.questionKey).not.toBe('schedule.why_not');
    });

    it('once ticked, asks about the task, names his work and the day, and carries the card', async () => {
        const { selectDailyQuestion } = await engineWithTickedWhyNot();
        const picked = selectDailyQuestion(inputs());

        expect(picked?.question.questionKey).toBe('schedule.why_not');
        expect(picked?.resolvedPromptMr).toBe('तुमच्या वेळापत्रकात ११ नोव्हेंबर ला फवारणी होतं. ते राहिलं, असं दिसतं. काय झालं?');
        expect(picked?.scheduleCardRef).toBe(card.cardRef);
        expect(picked?.missedCard).toEqual(card);
        expect(picked?.lookLineIds).toEqual([]);
        expect(picked?.resolvedPromptMr).not.toMatch(/[A-Za-z]/);
    });

    it('a task already asked is never asked again; the next missed task may be (after the cooldown)', async () => {
        const { selectDailyQuestion } = await engineWithTickedWhyNot();
        expect(selectDailyQuestion(inputs({ recentEvents: [asked(card.cardRef)] }))?.question.questionKey).not.toBe('schedule.why_not');

        const old = { ...asked(card.cardRef), ageDays: 5 };
        const picked = selectDailyQuestion(inputs({ missedCards: [card, second], recentEvents: [old] }));
        expect(picked?.scheduleCardRef).toBe(second.cardRef);
        expect(picked?.resolvedPromptMr).toContain('६ नोव्हेंबर ला काम');
    });

    it('stays inside the one-question-a-day slot', async () => {
        const { selectDailyQuestion } = await engineWithTickedWhyNot();
        const answeredToday: RecentQuestionEvent = { questionKey: 'gap.dose', createdAtLocalDate: '2026-11-14', ageDays: 0, skipped: false, dailyLogId: null };
        expect(selectDailyQuestion(inputs({ recentEvents: [answeredToday] }))).toBeNull();
    });

    it('no missed tasks handed in (a person who does not plan the work): never asked', async () => {
        const { selectDailyQuestion } = await engineWithTickedWhyNot();
        expect(selectDailyQuestion(inputs({ missedCards: undefined }))?.question.questionKey).not.toBe('schedule.why_not');
    });
});
