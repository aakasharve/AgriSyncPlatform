/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule") - the stage question as the engine picks it when the plot follows a
 * task-format schedule or owns a work: the line comes from the TASK, the embedded json is never used, and a plot with no task format keeps the json as its fallback.
 * The wording of `stage.look` stays hidden in the bank until the founder approves it; this test reads it through the test seam (VITE_DFES_STAGE_LOOK_TEST_APPROVED) only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile, Plot } from '../../../../domain/types/farm.types';
import type { TaskStageLine, TaskStageSource } from '../taskStageLines';
import type { TaskStageState } from '../taskStageSource';

const plot = (): Plot => ({ id: 'plot-1', name: 'P', baseline: { unit: 'Acre', totalArea: 2 } } as Plot);
const crops = (): CropProfile[] => [{ id: 'c', name: 'Grapes', iconName: 'grape', color: '#000', plots: [plot()], supportedTasks: [], workflow: [] }];

const taskLine = (over: Partial<TaskStageLine> = {}): TaskStageLine => ({
    lineId: 'task:flower:look', taskKey: 'flower', part: 'look', askMr: 'फुलोरा सुरू — दिसलं का?', sourceLabelMr: 'स्रोत: तुमचा अनुभव',
    kind: 'own-by-hand', takesSignEvent: true, ...over,
});
const state = (source: TaskStageSource, shownDay = 41): TaskStageState => ({ shownDay, source, cropCycleId: 'cycle-1' });

async function load(seamOn: boolean) {
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', async () => {
        const actual = await vi.importActual<typeof import('../../../../app/featureFlags')>('../../../../app/featureFlags');
        return { ...actual, FEATURE_FLAGS: { ...actual.FEATURE_FLAGS, dfesStageLookTestApproved: seamOn } };
    });
    const stage = await import('../dfesStageQuestion');
    const engine = await import('../dfesQuestionEngine');
    return { ...stage, ...engine };
}

afterEach(() => {
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

describe('computeStageQuestion reads the plot\'s tasks', () => {
    it('asks the line of the task, names it task:{key}:look, and never the embedded json', async () => {
        const { computeStageQuestion } = await load(true);
        const ctx = computeStageQuestion({ crops: crops(), plotId: 'plot-1', todayLocalDate: '2026-11-25', language: 'mr', taskStage: state({ hasTaskFormat: true, lines: [taskLine()] }) });

        expect(ctx).toMatchObject({ kind: 'stage_look', scheduleDay: 41, line: null, lineId: 'task:flower:look', askMr: 'फुलोरा सुरू — दिसलं का?', cropCycleId: 'cycle-1' });
        expect(ctx?.task?.sourceLabelMr).toBe('स्रोत: तुमचा अनुभव');
    });

    it('a plot that uses the task format but has no question today asks the open question: the json is NOT used', async () => {
        const { computeStageQuestion } = await load(true);
        const ctx = computeStageQuestion({ crops: crops(), plotId: 'plot-1', todayLocalDate: '2026-10-20', language: 'mr', taskStage: state({ hasTaskFormat: true, lines: [] }, 6) });

        expect(ctx).toEqual({ kind: 'stage_open', scheduleDay: 6, line: null, askMr: null });
    });

    it('in English mode no task line is asked (the lines are Marathi words of the schedule)', async () => {
        const { computeStageQuestion } = await load(true);
        const ctx = computeStageQuestion({ crops: crops(), plotId: 'plot-1', todayLocalDate: '2026-11-25', language: 'en', taskStage: state({ hasTaskFormat: true, lines: [taskLine()] }) });

        expect(ctx?.kind).toBe('stage_open');
    });

    it('a plot with no task format is left to the embedded json as before (no task stage, or one that says none)', async () => {
        const { computeStageQuestion } = await load(true);
        const none = computeStageQuestion({ crops: crops(), plotId: 'plot-1', todayLocalDate: '2026-10-20', language: 'mr', taskStage: state({ hasTaskFormat: false, lines: [] }) });
        const absent = computeStageQuestion({ crops: crops(), plotId: 'plot-1', todayLocalDate: '2026-10-20', language: 'mr' });

        expect(none).toEqual({ kind: 'stage_open', scheduleDay: null, line: null, askMr: null });
        expect(absent).toEqual(none);
    });
});

describe('the engine picks the task question with its three answers and its source', () => {
    const base = { crop: 'grapes', todayLocalDate: '2026-11-25', recentEvents: [], engagement: { totalRichDays: 0, unlockStatus: 'locked' as const } };

    it('selects stage.look with the task line, the three answers and the task to read the source from', async () => {
        const { computeStageQuestion, selectDailyQuestion, TASK_ANSWER_OPTIONS } = await load(true);
        const stageQuestion = computeStageQuestion({ crops: crops(), plotId: 'plot-1', todayLocalDate: '2026-11-25', language: 'mr', taskStage: state({ hasTaskFormat: true, lines: [taskLine()] }) })!;

        const picked = selectDailyQuestion({ ...base, stageQuestion });

        expect(picked?.question.questionKey).toBe('stage.look');
        expect(picked?.lookLineIds).toEqual(['task:flower:look']);
        expect(picked?.resolvedPromptMr).toBe('फुलोरा सुरू — दिसलं का?');
        expect(picked?.answerOptions?.map(o => o.value)).toEqual(['seen', 'not_yet', 'unsure']);
        expect(picked?.answerOptions).toEqual([...TASK_ANSWER_OPTIONS]);
        expect(picked?.taskLine?.takesSignEvent).toBe(true);
        expect(picked?.taskCropCycleId).toBe('cycle-1');
    });

    it('stays hidden until the founder approves the wording: with the seam off nothing is selected', async () => {
        const { computeStageQuestion, selectDailyQuestion } = await load(false);
        const stageQuestion = computeStageQuestion({ crops: crops(), plotId: 'plot-1', todayLocalDate: '2026-11-25', language: 'mr', taskStage: state({ hasTaskFormat: true, lines: [taskLine()] }) })!;

        expect(selectDailyQuestion({ ...base, stageQuestion })).toBeNull();
    });
});
