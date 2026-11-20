// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane HONESTY-1, item H1; doctrine P4)
 *
 * The result screen's "{done} पूर्ण, {left} बाकी" line is a computed count of the day's plan. It is drawn only when that plan is a
 * real one (`todayDayState.planIsReal === true`); on the app's stand-in or an unchecked default - or a snapshot that does not say -
 * the screen draws no line. (The saved card's twin is pinned in mainView.successClarity.test.tsx.)
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AppRouterContext } from '../routeContext';
import type { DailyLog } from '../../../types';

async function load() {
    vi.resetModules();
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({
        LedgerRecognitionPanel: () => React.createElement('div', { 'data-testid': 'ledger-recognition-panel' }),
    }));
    // The result screen is a stub that only hosts what the route hands it as `extras` (where the line lives).
    vi.doMock('../../../features/logs/components/voiceResult/VoiceResultContainer', () => ({
        VoiceResultContainer: (p: Record<string, unknown>) => React.createElement('div', { 'data-testid': 'voice-result-stub' }, p.extras as React.ReactNode),
    }));
    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => (k === 'dfes.dailyLoopClarity' ? '{done} पूर्ण, {left} बाकी' : k) }),
    }));
    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { dailyLoop: true, voiceContinuity: false, taskCloseConfirm: false, understandingMeter: false },
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
    }));
    return (await import('../voiceResultView')).renderVoiceResultView;
}

const SAVED = {
    id: 'LOG-1', date: '2026-10-26', fullTranscript: 'चार मजूर आले',
    context: { selection: [{ farmId: 'farm-1', cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['p1'], selectedPlotNames: ['सोनाका'] }] },
    cropActivities: [], irrigation: [], labour: [{ id: 'l', count: 4 }], inputs: [], machinery: [],
} as unknown as DailyLog;
const RESULT = { logIds: ['LOG-1'], clipId: 'clip-1', key: 'clip-1|T', unclear: [] };

const day = { closurePercent: 40, isClosed: false, hasStarted: true, completedCount: 3, plannedCount: 5, pendingCount: 2, unverifiedCount: 0 };
const ctx = (todayDayState: Record<string, unknown>): AppRouterContext => ({
    history: [SAVED], plannedTasks: [], activeFarmId: 'farm-1', farmRole: 'PrimaryOwner', crops: [],
    todayDayState, yesterdayDayState: day, lastSavedLogSummary: [], lastSavedLogIds: ['LOG-1'],
    handleReset: vi.fn(), handleEditLog: vi.fn(), moveSavedDay: vi.fn(), handleUpdateTask: vi.fn(),
    farmerProfile: { operators: [], activeOperatorId: 'op-1' }, operatorNameById: new Map(), canOpenAttendanceFromHome: false,
} as unknown as AppRouterContext);

afterEach(() => { cleanup(); vi.resetModules(); });

describe('H1 - the result screen\'s done / left line', { timeout: 60_000 }, () => {
    it('a real plan: the line shows, with the real counts', async () => {
        const render1 = await load();
        render(<>{render1(ctx({ ...day, planIsReal: true }), RESULT as never)}</>);
        const line = await screen.findByTestId('daily-loop-clarity');
        expect(line.textContent).toBe('3 पूर्ण, 2 बाकी');
    });

    it('a stand-in or an unchecked default (planIsReal false): NO line, and the rest of the screen is still there', async () => {
        const render1 = await load();
        render(<>{render1(ctx({ ...day, planIsReal: false }), RESULT as never)}</>);
        await screen.findByTestId('voice-result-stub');
        expect(screen.queryByTestId('daily-loop-clarity')).toBeNull();
    });

    it('a snapshot that does not say whether its plan is real: NO line (fails closed)', async () => {
        const render1 = await load();
        render(<>{render1(ctx({ ...day }), RESULT as never)}</>);
        await screen.findByTestId('voice-result-stub');
        expect(screen.queryByTestId('daily-loop-clarity')).toBeNull();
    });
});
