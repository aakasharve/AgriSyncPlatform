// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule") - the PHONE half of the answer: a stage question read from an own work
 * that waits for a sign is answered with "हो, दिसलं / अजून नाही / खात्री नाही"; each answer queues ONE `schedule.task_event` for that task (with no internet, replayed once by
 * its own request id), and "unsure" (unsureChangesNothing) writes that event and NOTHING else: no log, no plan, no own work, no schedule.
 *
 * Real Dexie (fake-indexeddb) and the real mutation queue; the question hook is mocked so the test stays on the host's own wiring (as MeterQuestionHost.test.tsx does).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { TASK_ANSWER_OPTIONS, type SelectedQuestion } from '../../services/dfesQuestionEngine';
import { findQuestion } from '../../services/dfesQuestionBank';
import type { TaskStageLine } from '../../services/taskStageLines';

const useDfesQuestionMock = vi.fn();
vi.mock('../../hooks/useDfesQuestion', () => ({ useDfesQuestion: (...args: unknown[]) => useDfesQuestionMock(...args) }));
vi.mock('../../hooks/useDayUnderstanding', () => ({ useDayUnderstanding: () => ({ score: null, isLoading: false, error: null, refresh: vi.fn() }) }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../../../app/featureFlags', () => ({
    FEATURE_FLAGS: { understandingMeter: true, stageQuestions: true, DwcChip: false, disciplineSystem: false, voiceContinuity: false, unlockCounterPaused: true, simulateUnlock: false },
    isFarmGeographyV2Enabled: () => false, isWeatherBackendFetchEnabled: () => false, isVoiceDoomLoopDetectorEnabled: () => true,
    IS_E2E_HARNESS_ENABLED: false, isE2EHarnessEnabled: () => false, isEnabled: () => true,
}));

const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const PLOT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const CYCLE = 'c1c1c1c1-0000-4000-8000-0000000000c1';

const line = (over: Partial<TaskStageLine> = {}): TaskStageLine => ({
    lineId: 'task:flower:look', taskKey: 'flower', part: 'look', askMr: 'फुलोरा सुरू — दिसलं का?', sourceLabelMr: 'स्रोत: तुमचा अनुभव',
    kind: 'own-by-hand', takesSignEvent: true, ...over,
});

const selectedFor = (task: TaskStageLine): SelectedQuestion => ({
    question: findQuestion('stage.look')!, resolvedPromptMr: task.askMr, triggerReason: 'stage look', weatherContext: null, expectedStage: null,
    actualStageApplicability: 'current_stage', answerOptions: [...TASK_ANSWER_OPTIONS], promptOrigin: 'bank', lookLineIds: [task.lineId], scheduleCardRef: null,
    taskLine: task, taskCropCycleId: CYCLE,
});

const inputs = { crop: 'grapes', todayLocalDate: '2026-11-25', askedOnLocalDate: '2026-11-25', engagement: { totalRichDays: 0, unlockStatus: 'locked' as const } };

async function mount(task: TaskStageLine) {
    const recordOutcome = vi.fn(async () => undefined);
    useDfesQuestionMock.mockReturnValue({ selected: selectedFor(task), loading: false, recordOutcome, shownAtUtc: '2026-11-25T01:00:00Z' });
    const { MeterQuestionHost } = await import('../MeterQuestionHost');
    const view = render(<MeterQuestionHost farmId={FARM} plotId={PLOT} questionInputs={inputs} />);
    return { recordOutcome, ...view };
}

const events = async () => (await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.ScheduleTaskEvent).toArray())
    .map(r => r.payload as { answer: string; taskKey: string; cropCycleId: string; observedOn?: string });

const queueTypes = async () => (await getDatabase().mutationQueue.toArray()).map(r => r.mutationType).sort();

beforeEach(async () => {
    await resetDatabase();
    await getDatabase().mutationQueue.clear();
    useDfesQuestionMock.mockReset();
});
afterEach(() => cleanup());

describe('the question shows its source and the three answers', () => {
    it('draws the source line beside the question and one button for each of the three answers', async () => {
        const view = await mount(line());
        expect(view.getByTestId('shramsathi-question-source')).toHaveTextContent('स्रोत: तुमचा अनुभव');
        expect(view.getAllByTestId('shramsathi-answer-option').map(b => b.textContent)).toEqual(['हो, दिसलं', 'अजून नाही', 'खात्री नाही']);
    });
});

describe('an answer queues one task event for that task', () => {
    it('"हो, दिसलं" queues a "seen" event for the task, in the crop season, on the day it was answered', async () => {
        const { getAllByTestId, recordOutcome } = await mount(line());
        fireEvent.click(getAllByTestId('shramsathi-answer-option')[0]);
        await waitFor(async () => expect(await events()).toHaveLength(1));
        expect(await events()).toEqual([expect.objectContaining({ answer: 'seen', taskKey: 'flower', cropCycleId: CYCLE, observedOn: '2026-11-25' })]);
        await waitFor(() => expect(recordOutcome).toHaveBeenCalledTimes(1));
        expect(recordOutcome).toHaveBeenCalledWith({ skipped: false, response: 'हो, दिसलं', dailyLogId: null });
    });

    it('"अजून नाही" queues a "not_yet" event', async () => {
        const { getAllByTestId } = await mount(line());
        fireEvent.click(getAllByTestId('shramsathi-answer-option')[1]);
        await waitFor(async () => expect((await events()).map(e => e.answer)).toEqual(['not_yet']));
    });

    it('tapping twice (or the question\'s own write being retried) queues ONE event: it is replayed once', async () => {
        const { getAllByTestId } = await mount(line());
        fireEvent.click(getAllByTestId('shramsathi-answer-option')[0]);
        fireEvent.click(getAllByTestId('shramsathi-answer-option')[0]);
        await waitFor(async () => expect(await events()).toHaveLength(1));
        await new Promise(r => setTimeout(r, 50));
        expect(await events()).toHaveLength(1);
    });

    it('a question read from a task that is not a work waiting for a sign writes no event (the server takes none for it); the answer is still recorded', async () => {
        const { getAllByTestId, recordOutcome } = await mount(line({ takesSignEvent: false, kind: 'reference' }));
        fireEvent.click(getAllByTestId('shramsathi-answer-option')[0]);
        await waitFor(() => expect(recordOutcome).toHaveBeenCalledTimes(1));
        expect(await events()).toEqual([]);
    });
});

describe('with no internet, a question whose answer could not be kept is not asked', () => {
    const setOnline = (value: boolean) => {
        Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
        window.dispatchEvent(new Event(value ? 'online' : 'offline'));
    };
    afterEach(() => setOnline(true));

    it('a reference task (no own work, no queued event) is NOT shown offline, and comes back when the internet does', async () => {
        setOnline(false);
        const view = await mount(line({ takesSignEvent: false, kind: 'reference' }));
        expect(view.queryAllByTestId('shramsathi-answer-option')).toHaveLength(0);
        setOnline(true);
        await waitFor(() => expect(view.getAllByTestId('shramsathi-answer-option')).toHaveLength(3));
    });

    it('an own work that waits for a sign IS shown offline, and its answer is queued', async () => {
        setOnline(false);
        const view = await mount(line());
        fireEvent.click(view.getAllByTestId('shramsathi-answer-option')[0]);
        await waitFor(async () => expect((await events()).map(e => e.answer)).toEqual(['seen']));
    });
});

describe('unsureChangesNothing', () => {
    it('"खात्री नाही" queues its event and nothing else: no log, no plan, no own work, no schedule choice', async () => {
        const db = getDatabase();
        const before = {
            logs: await db.logs.count(), plans: await db.plannedWork.count(), own: await db.ownScheduleItems.count(),
            subs: await db.scheduleSubscriptions.count(), revisions: await db.ownScheduleItemRevisions.count(),
        };
        const { getAllByTestId, recordOutcome } = await mount(line());

        fireEvent.click(getAllByTestId('shramsathi-answer-option')[2]);
        await waitFor(async () => expect(await events()).toHaveLength(1));
        await waitFor(() => expect(recordOutcome).toHaveBeenCalledTimes(1));

        expect((await events())[0].answer).toBe('unsure');
        expect(await queueTypes()).toEqual([SyncMutationName.ScheduleTaskEvent]); // the ONLY thing queued
        expect({
            logs: await db.logs.count(), plans: await db.plannedWork.count(), own: await db.ownScheduleItems.count(),
            subs: await db.scheduleSubscriptions.count(), revisions: await db.ownScheduleItemRevisions.count(),
        }).toEqual(before);
        // the question's own record names no log and carries no words: nothing a log or a plan could read
        expect(recordOutcome).toHaveBeenCalledWith({ skipped: false, response: null, dailyLogId: null });
    });
});
