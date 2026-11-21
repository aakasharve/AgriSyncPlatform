// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, bug 1) - a spoken answer to Sathi's question is kept.
 *
 * When the farmer answers the day's question by speaking, the next saved log carries his words, and the panel settles the
 * pending answer with them (`question_events.response`, verbatim, P4). The panel read `savedLog.transcriptSnapshot.raw`,
 * which no production code writes, so every spoken answer was dropped. His words are on `savedLog.fullTranscript`.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { DailyLog } from '../../../../types';

const settleMock = vi.fn();

vi.mock('../../services/pendingQuestionAnswer', () => ({
    settlePendingQuestionAnswer: (...args: unknown[]) => settleMock(...args),
}));
vi.mock('../../hooks/useFarmerEngagement', () => ({
    useFarmerEngagement: () => ({ engagement: null, isLoading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../hooks/useDfesQuestion', () => ({
    useDfesQuestion: () => ({ selected: null, loading: false, recordOutcome: vi.fn() }),
}));
vi.mock('../../services/dfesScheduleWindow', () => ({ computeScheduleGap: () => null }));
vi.mock('../../services/dfesWeatherReconcile', () => ({ reconcileWeather: () => null }));
vi.mock('../../services/dfesPreviousLog', () => ({ computePreviousLog: () => null }));
vi.mock('../../../../infrastructure/voice/speakUnlockReward', () => ({ speakUnlockReward: vi.fn() }));
vi.mock('../../../../infrastructure/storage/unlockSpeechStore', () => ({
    wasUnlockSpoken: () => true,
    markUnlockSpoken: vi.fn(),
}));
vi.mock('../../hooks/useDayUnderstanding', () => ({
    useDayUnderstanding: () => ({ score: null, isLoading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
}));

function makeSavedLog(overrides: Partial<DailyLog> = {}): DailyLog {
    return {
        id: 'log-1', date: '2026-11-21',
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...overrides,
    };
}

async function renderPanel(savedLog: DailyLog) {
    const { LedgerRecognitionPanel } = await import('../LedgerRecognitionPanel');
    render(<LedgerRecognitionPanel farmId="farm-1" plotId="plot-1" allLogs={[]} savedLog={savedLog} />);
}

beforeEach(() => settleMock.mockReset());
afterEach(() => cleanup());

describe('lane DFES-Q bug 1 - a spoken answer is kept', () => {
    it('settles the pending answer with the words on the saved log (fullTranscript)', async () => {
        await renderPanel(makeSavedLog({ fullTranscript: ' 10 पैकी 7 काड्यांवर कळ्या फुटल्या ' }));

        expect(settleMock).toHaveBeenCalledTimes(1);
        expect(settleMock).toHaveBeenCalledWith({ transcript: '10 पैकी 7 काड्यांवर कळ्या फुटल्या' });
    });

    it('still reads an older transcriptSnapshot when there is no fullTranscript', async () => {
        await renderPanel(makeSavedLog({ transcriptSnapshot: { raw: 'पाऊस आला', cleaned: 'पाऊस आला' } as DailyLog['transcriptSnapshot'] }));

        expect(settleMock).toHaveBeenCalledWith({ transcript: 'पाऊस आला' });
    });

    it('settles nothing when the saved log carries no words (a typed log), and never invents any', async () => {
        await renderPanel(makeSavedLog({ fullTranscript: '   ' }));

        expect(settleMock).not.toHaveBeenCalled();
    });
});
