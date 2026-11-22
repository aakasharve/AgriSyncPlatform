// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 7; founder D-D, D-H) - only a person who plans the farm's
 * work is handed passed schedule tasks to be asked about, counted against the real India today, never the saved log's day.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { DailyLog } from '../../../../types';

const hostProps = vi.fn();
const findMissedCards = vi.fn();

vi.mock('../MeterQuestionHost', () => ({
    MeterQuestionHost: (props: unknown) => { hostProps(props); return null; },
}));
vi.mock('../../services/dfesWhyNot', () => ({ findMissedCards: (...args: unknown[]) => findMissedCards(...args) }));
vi.mock('../../services/pendingQuestionAnswer', () => ({ settlePendingQuestionAnswer: vi.fn() }));
vi.mock('../../hooks/useFarmerEngagement', () => ({
    useFarmerEngagement: () => ({ engagement: null, isLoading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../services/dfesScheduleWindow', () => ({ computeScheduleGap: () => null }));
vi.mock('../../services/dfesWeatherReconcile', () => ({ reconcileWeather: () => null }));
vi.mock('../../services/dfesPreviousLog', () => ({ computePreviousLog: () => null }));
vi.mock('../../../../infrastructure/voice/speakUnlockReward', () => ({ speakUnlockReward: vi.fn() }));
vi.mock('../../../../infrastructure/storage/unlockSpeechStore', () => ({ wasUnlockSpoken: () => true, markUnlockSpoken: vi.fn() }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr' }),
}));
vi.mock('../../../../core/domain/services/DateKeyService', async () => {
    const actual = await vi.importActual<typeof import('../../../../core/domain/services/DateKeyService')>('../../../../core/domain/services/DateKeyService');
    return { ...actual, getDateKey: (d?: unknown) => (d === undefined ? '2026-11-14' : actual.getDateKey(d as string)) };
});

const card = { cardRef: 'plot-1:tpl:2026-11-01:ot_spray', dateKey: '2026-11-11' };
const savedLog: DailyLog = {
    id: 'log-1', date: '2026-11-05', context: { selection: [] }, dayOutcome: 'WORK_RECORDED',
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
};

async function renderPanel(mayPlanWork?: boolean) {
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { understandingMeter: true, stageQuestions: true, spokenUnlockReward: false },
        isEnabled: () => true,
    }));
    const { LedgerRecognitionPanel } = await import('../LedgerRecognitionPanel');
    render(<LedgerRecognitionPanel farmId="farm-1" plotId="plot-1" todayLocalDate="2026-11-05" allLogs={[]} savedLog={savedLog}
        mayPlanWork={mayPlanWork} onTellPastDay={vi.fn()} />);
    return hostProps.mock.calls.at(-1)?.[0] as { questionInputs: { missedCards?: unknown }; onTellPastDay?: unknown };
}

beforeEach(() => { hostProps.mockReset(); findMissedCards.mockReset(); findMissedCards.mockReturnValue([card]); });
afterEach(() => { cleanup(); vi.doUnmock('../../../../app/featureFlags'); });

describe('lane DFES-Q - who is asked why a task was not done', () => {
    it('a person who plans the work is handed the passed tasks, counted against today, not the saved log\'s day', async () => {
        const props = await renderPanel(true);

        expect(findMissedCards).toHaveBeenCalledWith(expect.objectContaining({ plotId: 'plot-1', todayLocalDate: '2026-11-14' }));
        expect(props.questionInputs.missedCards).toEqual([card]);
        expect(props.onTellPastDay).toEqual(expect.any(Function));
    });

    it('anyone else (or a caller that does not say) is never handed any', async () => {
        for (const mayPlanWork of [false, undefined]) {
            findMissedCards.mockClear();
            const props = await renderPanel(mayPlanWork);
            expect(findMissedCards).not.toHaveBeenCalled();
            expect(props.questionInputs.missedCards).toBeUndefined();
        }
    });
});
