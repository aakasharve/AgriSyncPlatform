// @vitest-environment jsdom
/**
 * spec: plr-d10-final-polish - after a tap on Sathi's question card the card says what ACTUALLY happened to the answer, and nothing more:
 * queued on the phone (will be sent), kept (the server recorded it), or not kept (and he may tap again). Nothing is claimed before it is true.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { TASK_ANSWER_OPTIONS, type SelectedQuestion } from '../../services/dfesQuestionEngine';
import { findQuestion } from '../../services/dfesQuestionBank';
import type { TaskStageLine } from '../../services/taskStageLines';

let currentLanguage: 'mr' | 'en' = 'mr';
const useDfesQuestionMock = vi.fn();
vi.mock('../../hooks/useDfesQuestion', () => ({ useDfesQuestion: (...args: unknown[]) => useDfesQuestionMock(...args) }));
vi.mock('../../hooks/useDayUnderstanding', () => ({ useDayUnderstanding: () => ({ score: null, isLoading: false, error: null, refresh: vi.fn() }) }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: currentLanguage, setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: currentLanguage, setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../../../app/featureFlags', () => ({
    FEATURE_FLAGS: { understandingMeter: true, stageQuestions: true, DwcChip: false, disciplineSystem: false, voiceContinuity: false, unlockCounterPaused: true, simulateUnlock: false },
    isFarmGeographyV2Enabled: () => false, isWeatherBackendFetchEnabled: () => false, isVoiceDoomLoopDetectorEnabled: () => true,
    IS_E2E_HARNESS_ENABLED: false, isE2EHarnessEnabled: () => false, isEnabled: () => true,
}));

const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const PLOT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const CYCLE = 'c1c1c1c1-0000-4000-8000-0000000000c1';
const DEVANAGARI = /[ऀ-ॿ]/;

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

async function mount(task: TaskStageLine, recordOutcome: (o: unknown) => Promise<unknown>) {
    useDfesQuestionMock.mockReturnValue({ selected: selectedFor(task), loading: false, recordOutcome, shownAtUtc: '2026-11-25T01:00:00Z' });
    const { MeterQuestionHost } = await import('../MeterQuestionHost');
    return render(<MeterQuestionHost farmId={FARM} plotId={PLOT} questionInputs={inputs} look="sathi" />);
}
const state = (v: ReturnType<typeof render>) => v.queryByTestId('vr-answer-status');

beforeEach(async () => {
    currentLanguage = 'mr';
    await resetDatabase();
    await getDatabase().mutationQueue.clear();
    useDfesQuestionMock.mockReset();
});
afterEach(() => cleanup());

describe('Sathi card after a tap', () => {
    it('shows no answer state before any tap', async () => {
        const view = await mount(line({ takesSignEvent: false, kind: 'reference' }), async () => 'kept');
        expect(state(view)).toBeNull();
        expect(view.getAllByTestId('vr-answer-option')).toHaveLength(3);
    });

    it('a queued answer (own work that waits for a sign) says it is kept on the phone and will be sent, before the server has it', async () => {
        const view = await mount(line(), () => new Promise(() => undefined)); // the question's own record never answers
        fireEvent.click(view.getAllByTestId('vr-answer-option')[0]);
        await waitFor(() => expect(state(view)).toHaveAttribute('data-state', 'queued'));
        expect(state(view)!.textContent).toBe('उत्तर फोनवर ठेवलं आहे आणि पाठवलं जाईल.');
        expect(await getDatabase().mutationQueue.count()).toBe(1);
        expect(state(view)!.textContent).not.toMatch(/[A-Za-z]/);
    });

    it('English mode: the queued words are English only', async () => {
        currentLanguage = 'en';
        const view = await mount(line(), () => new Promise(() => undefined));
        fireEvent.click(view.getAllByTestId('vr-answer-option')[0]);
        await waitFor(() => expect(state(view)).toHaveAttribute('data-state', 'queued'));
        expect(state(view)!.textContent).toBe('Your answer is kept on the phone and will be sent.');
        expect(state(view)!.textContent).not.toMatch(DEVANAGARI);
    });

    it('a server-recorded answer says kept only after the server took it; before that it claims nothing kept', async () => {
        let finish: (v: string) => void = () => undefined;
        const view = await mount(line({ takesSignEvent: false, kind: 'reference' }), () => new Promise<string>(r => { finish = r; }));
        fireEvent.click(view.getAllByTestId('vr-answer-option')[0]);
        await waitFor(() => expect(state(view)).toHaveAttribute('data-state', 'saving'));
        expect(state(view)!.textContent).toBe('उत्तर ठेवत आहोत…');
        expect(state(view)!.textContent).not.toContain('ठेवलं');
        finish('kept');
        await waitFor(() => expect(state(view)).toHaveAttribute('data-state', 'kept'));
        expect(state(view)!.textContent).toBe('तुमचं उत्तर ठेवलं आहे.');
        expect(view.queryAllByTestId('vr-answer-option')).toHaveLength(0);
        expect(await getDatabase().mutationQueue.count()).toBe(0);
    });

    it('a failed recording says not kept, keeps the buttons and a second tap really tries again', async () => {
        const record = vi.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('kept');
        const view = await mount(line({ takesSignEvent: false, kind: 'reference' }), record);
        fireEvent.click(view.getAllByTestId('vr-answer-option')[0]);
        await waitFor(() => expect(state(view)).toHaveAttribute('data-state', 'failed'));
        expect(state(view)!.textContent).toBe('उत्तर आत्ता ठेवता आलं नाही — पुन्हा दाबा');
        expect(view.getAllByTestId('vr-answer-option')).toHaveLength(3);
        fireEvent.click(view.getAllByTestId('vr-answer-option')[0]);
        await waitFor(() => expect(state(view)).toHaveAttribute('data-state', 'kept'));
        expect(record).toHaveBeenCalledTimes(2);
    });

    it('an ordinary (non-task) question: kept after the server took it', async () => {
        const view = render(<div />);
        view.unmount();
        const q = { ...selectedFor(line()), taskLine: undefined, taskCropCycleId: undefined, answerOptions: [{ value: 'yes', labelMr: 'हो', labelEn: 'Yes' }] } as unknown as SelectedQuestion;
        useDfesQuestionMock.mockReturnValue({ selected: q, loading: false, recordOutcome: async () => 'kept', shownAtUtc: 'x' });
        const { MeterQuestionHost } = await import('../MeterQuestionHost');
        const v = render(<MeterQuestionHost farmId={FARM} plotId={PLOT} questionInputs={inputs} look="sathi" />);
        fireEvent.click(v.getAllByTestId('vr-answer-option')[0]);
        await waitFor(() => expect(state(v)).toHaveAttribute('data-state', 'kept'));
    });
});

describe('Part 03 B4 - a product question holds the ONE question slot', () => {
    it('held: the day\'s question engine is told it is off (nothing picked, nothing fetched); released: on again', async () => {
        useDfesQuestionMock.mockReturnValue({ selected: null, loading: false, recordOutcome: vi.fn(), shownAtUtc: '' });
        const { MeterQuestionHost } = await import('../MeterQuestionHost');
        const held = render(<MeterQuestionHost farmId={FARM} plotId={PLOT} questionInputs={inputs} look="sathi" holdQuestion />);
        expect(useDfesQuestionMock.mock.calls.at(-1)?.[3]).toBe(false);
        expect(held.queryByTestId('vr-question')).toBeNull();
        held.unmount();
        render(<MeterQuestionHost farmId={FARM} plotId={PLOT} questionInputs={inputs} look="sathi" />);
        expect(useDfesQuestionMock.mock.calls.at(-1)?.[3]).toBe(true);
    });
});
