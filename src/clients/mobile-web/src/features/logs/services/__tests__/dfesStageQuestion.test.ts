/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 6) - the day's stage question from Shram Safal's own schedule
 * (the Schedule Maker's October fruit-pruning file, projected), pruning day = day 1 (founder 22 Nov).
 *
 * Only the "which template applies to this plot" indirection is substituted; `calculateDayNumber` is the real plan engine, and the
 * look lines are the REAL projected file the server embeds too.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CropProfile, Plot } from '../../../../domain/types/farm.types';
import type { CropScheduleTemplate, PlotScheduleInstance } from '../../../scheduler/scheduler.types';
import type { StageQuestionContext } from '../dfesStageQuestion';
import type { DailyQuestionInputs } from '../dfesQuestionEngine';
import { GRAPES_OCT_FRUIT_PRUNING, askableLinesForDay, sampleVinesFor } from '../../../../domain/schedule/dfesScheduleLines';

const PRUNED = '2026-10-15'; // the fixture's own example: pruning day = day 1

const grapeTemplate: CropScheduleTemplate = {
    id: 'tpl_grape', cropCode: 'grape', name: 'Grape', referenceType: 'PRUNING', stages: [],
    periodicExpectations: [], oneTimeExpectations: [], createdBy: 'test', ownerType: 'USER',
};
const schedule = (referenceDate = PRUNED, referenceType: PlotScheduleInstance['referenceType'] = 'PRUNING'): PlotScheduleInstance => ({
    id: 'sch', plotId: 'plot-1', templateId: 'tpl_grape', referenceType, referenceDate, stageOverrides: [], expectationOverrides: [],
});
const plot = (over: Partial<Plot> = {}): Plot => ({ id: 'plot-1', name: 'P', baseline: { unit: 'Acre', totalArea: 2 }, schedule: schedule(), ...over });
const crops = (p: Plot = plot()): CropProfile[] => [{ id: 'c', name: 'Grapes', iconName: 'grape', color: '#000', plots: [p], supportedTasks: [], workflow: [] }];

async function stageFor(today: string, p: Plot = plot(), tpl: CropScheduleTemplate | null = grapeTemplate, language = 'mr'): Promise<StageQuestionContext | null> {
    vi.resetModules();
    vi.doMock('../../../scheduler/planning/ClientPlanEngine', async () => {
        const actual = await vi.importActual<typeof import('../../../scheduler/planning/ClientPlanEngine')>('../../../scheduler/planning/ClientPlanEngine');
        return { ...actual, scheduleTemplateForPlot: () => tpl ?? undefined };
    });
    const { computeStageQuestion } = await import('../dfesStageQuestion');
    return computeStageQuestion({ crops: crops(p), plotId: 'plot-1', todayLocalDate: today, language });
}

afterEach(() => {
    vi.doUnmock('../../../scheduler/planning/ClientPlanEngine');
    vi.doUnmock('../dfesQuestionBank');
    vi.resetModules();
});

describe('lane DFES-Q - the schedule\'s look lines, as DFES may ask them', () => {
    it('every askable line on every day of the file stands on a source, is no choice of ours, and needs no condition', () => {
        for (let day = -19; day <= 17; day++) {
            for (const { line, askMr } of askableLinesForDay(GRAPES_OCT_FRUIT_PRUNING, day, 40)) {
                expect(line.sources.length).toBeGreaterThan(0);
                expect(line.ourChoice || line.expertDecides).toBe(false);
                expect(line.cardType).not.toBe('conditional');
                expect(line.startsWhenStageSeen).toBe(false);
                expect(day).toBeGreaterThanOrEqual(line.n0);
                expect(day).toBeLessThanOrEqual(line.n1);
                expect(askMr).not.toContain('{N}');
                expect(askMr).not.toContain('तज्ज्ञ ठरवतील');
            }
        }
    });

    it('a question that counts vines is asked only when the number to count is known, and then says it (20 per acre)', () => {
        const withSample = (n: number | null) => askableLinesForDay(GRAPES_OCT_FRUIT_PRUNING, 8, n).filter(x => x.line.askFarmerHasSample);
        expect(withSample(null)).toEqual([]);
        expect(withSample(40).length).toBeGreaterThan(0);
        expect(withSample(40).every(x => x.askMr.includes('40'))).toBe(true);
        expect(sampleVinesFor(2, 'Acre')).toBe(40);
        expect(sampleVinesFor(20, 'Guntha')).toBe(10);
        expect(sampleVinesFor(undefined, 'Acre')).toBeNull();
    });
});

describe('lane DFES-Q - computeStageQuestion', () => {
    it('pruning day is day 1: on 2026-10-15 the question comes from a day-1 line', async () => {
        const q = await stageFor('2026-10-15');
        expect(q?.kind).toBe('stage_look');
        expect(q?.scheduleDay).toBe(1);
        expect(q!.line!.n0).toBeLessThanOrEqual(1);
        expect(q!.line!.n1).toBeGreaterThanOrEqual(1);
    });

    it('on 2026-10-26 it is day 12, with that day\'s line, its sources and its question', async () => {
        const q = await stageFor('2026-10-26');
        expect(q?.kind).toBe('stage_look');
        expect(q?.scheduleDay).toBe(12);
        expect(q!.line!.id.startsWith('grapes-table-oct-fruit-pruning/')).toBe(true);
        expect(q!.line!.sources.length).toBeGreaterThan(0);
        expect(q!.askMr).toBeTruthy();
    });

    it('a plot with no pruning date, a non-grape schedule, or a spring (foundation) pruning gets the open question, never a line', async () => {
        expect((await stageFor('2026-10-26', plot({ schedule: schedule('') })))?.kind).toBe('stage_open');
        expect((await stageFor('2026-10-26', plot(), { ...grapeTemplate, cropCode: 'pomegranate' }))?.kind).toBe('stage_open');
        expect((await stageFor('2026-04-26', plot({ schedule: schedule('2026-04-15') })))?.kind).toBe('stage_open');
        expect((await stageFor('2026-10-26', plot({ schedule: schedule(PRUNED, 'PLANTING') })))?.kind).toBe('stage_open');
    });

    it('past the file\'s last day there is no line: the open question, with the day still known', async () => {
        const q = await stageFor('2026-12-20');
        expect(q).toEqual({ kind: 'stage_open', scheduleDay: 67, line: null, askMr: null });
    });

    it('in English mode no look line is asked (no English twin yet)', async () => {
        expect((await stageFor('2026-10-26', plot(), grapeTemplate, 'en'))?.kind).toBe('stage_open');
    });

    it('no plot: no stage question at all', async () => {
        vi.resetModules();
        const { computeStageQuestion } = await import('../dfesStageQuestion');
        expect(computeStageQuestion({ crops: crops(), plotId: null, todayLocalDate: '2026-10-26' })).toBeNull();
    });
});

describe('lane DFES-Q - the engine asks the stage question', () => {
    const base = (stageQuestion: StageQuestionContext): DailyQuestionInputs => ({
        crop: 'grape', todayLocalDate: '2026-10-26', askedOnLocalDate: '2026-10-26',
        engagement: { totalRichDays: 0, unlockStatus: 'locked' }, recentEvents: [], stageQuestion,
    });

    async function engineWithTicked(...keys: string[]) {
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            return {
                ...actual,
                findQuestion: (key: string) => {
                    const q = actual.findQuestion(key);
                    return q && keys.includes(key) ? { ...q, marathiApproved: true } : q;
                },
            };
        });
        return import('../dfesQuestionEngine');
    }

    it('the shipped stage sentences are drafts: never asked until the founder ticks them', async () => {
        vi.resetModules();
        const { selectDailyQuestion } = await import('../dfesQuestionEngine');
        const look = await stageFor('2026-10-26');
        const picked = selectDailyQuestion(base(look!));
        expect(picked?.question.questionKey ?? null).not.toBe('stage.look');
        expect(picked?.question.questionKey ?? null).not.toBe('stage.open');
    });

    it('once ticked, the look line is asked in its own words and travels with the event (never a source)', async () => {
        const look = await stageFor('2026-10-26');
        const { selectDailyQuestion } = await engineWithTicked('stage.look', 'stage.open');
        const picked = selectDailyQuestion(base(look!));

        expect(picked?.question.questionKey).toBe('stage.look');
        expect(picked?.resolvedPromptMr).toBe(look!.askMr);
        expect(picked?.lookLineIds).toEqual([look!.line!.id]);
    });

    it('the open question is the low fallback: asked when nothing else is, without any line', async () => {
        const { selectDailyQuestion } = await engineWithTicked('stage.look', 'stage.open');
        const picked = selectDailyQuestion(base({ kind: 'stage_open', scheduleDay: 67, line: null, askMr: null }));

        expect(picked?.question.questionKey).toBe('stage.open');
        expect(picked?.resolvedPromptMr).toBe('आज बागेत काय दिसलं?');
        expect(picked?.lookLineIds).toEqual([]);
    });

    it('a look question without its line is never asked (the source gate)', async () => {
        const look = await stageFor('2026-10-26');
        const { selectDailyQuestion } = await engineWithTicked('stage.look');
        const picked = selectDailyQuestion(base({ ...look!, line: null }));
        expect(picked?.question.questionKey ?? null).not.toBe('stage.look');
    });
});
