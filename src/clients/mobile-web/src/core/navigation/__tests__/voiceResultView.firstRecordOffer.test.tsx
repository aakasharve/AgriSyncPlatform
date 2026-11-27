// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1b (CTO ruling 3). The route hands the saved
 * screen its "शेताची माहिती भरा" door: the setup hub (सेट-अप केंद्र, the `profile` place), with the log tab left on its
 * work home behind it (the same reset the screen's own self-close does), so its मागे lands Home.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppRouterContext } from '../routeContext';
import type { DailyLog } from '../../../types';

async function load() {
    vi.resetModules();
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({ LedgerRecognitionPanel: () => null }));
    // The saved screen is a stub with the one door this suite follows.
    vi.doMock('../../../features/logs/components/voiceResult/VoiceResultContainer', () => ({
        VoiceResultContainer: (p: { onOpenSetupHub?: () => void }) => React.createElement('button', {
            type: 'button', 'data-testid': 'stub-fill', disabled: !p.onOpenSetupHub, onClick: () => p.onOpenSetupHub?.(),
        }, 'fill'),
    }));
    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => k }),
    }));
    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { dailyLoop: false, voiceContinuity: false, taskCloseConfirm: false, understandingMeter: false },
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
    }));
    return (await import('../voiceResultView')).renderVoiceResultView;
}

const SAVED = {
    id: 'LOG-1', date: '2026-11-28', fullTranscript: 'आज फवारणी केली',
    context: { selection: [{ farmId: 'farm-1', cropId: 'FARM_GLOBAL', cropName: 'संपूर्ण शेत', selectedPlotIds: [], selectedPlotNames: [] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
} as unknown as DailyLog;
const RESULT = { logIds: ['LOG-1'], clipId: null, key: 'k|T', unclear: [] };
const day = { closurePercent: 0, isClosed: false, hasStarted: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 };

afterEach(() => { cleanup(); vi.resetModules(); });

describe('R1-g 1b — "शेताची माहिती भरा" opens the setup hub', { timeout: 60_000 }, () => {
    it('opens the सेट-अप केंद्र place, with the log tab reset to its work home behind it', async () => {
        const renderView = await load();
        const handleReset = vi.fn();
        const setLogScope = vi.fn();
        const openPlace = vi.fn();
        const setCurrentRoute = vi.fn();
        const ctx = {
            history: [SAVED], plannedTasks: [], activeFarmId: 'farm-1', farmRole: 'PrimaryOwner', crops: [],
            todayDayState: day, yesterdayDayState: day, lastSavedLogSummary: [], lastSavedLogIds: ['LOG-1'],
            handleReset, setLogScope, openPlace, setCurrentRoute, handleEditLog: vi.fn(), moveSavedDay: vi.fn(), handleUpdateTask: vi.fn(),
            farmerProfile: { operators: [], activeOperatorId: 'op-1' }, operatorNameById: new Map(), canOpenAttendanceFromHome: false,
        } as unknown as AppRouterContext;
        render(<>{renderView(ctx, RESULT as never)}</>);
        const door = await screen.findByTestId('stub-fill');
        expect(door).not.toBeDisabled();
        fireEvent.click(door);
        expect(handleReset).toHaveBeenCalledTimes(1);
        expect(setLogScope).toHaveBeenCalledWith({ selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' });
        expect(openPlace).toHaveBeenCalledWith('profile');
        expect(setCurrentRoute).not.toHaveBeenCalled();
    });
});
