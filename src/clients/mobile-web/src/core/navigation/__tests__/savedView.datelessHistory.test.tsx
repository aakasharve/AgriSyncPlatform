// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE SAVED SCREEN, OPENED OVER A LEDGER THAT STILL HOLDS A 1.0.14 ROW.
 *
 * Founder's crash on 1.0.15: save a voice log → the saved screen opens →
 * `savedView` passes `allLogs={history}` to the REAL `LedgerRecognitionPanel`
 * → `computePreviousLog` → `normalizeDateKey(undefined).includes` → TypeError,
 * because an old voice-attendance record on the phone has no `date`.
 *
 * This test builds `history` exactly as the app does — the real `useAppData`
 * reading a stored ledger that holds one dateless row — and renders the real
 * saved screen with the real panel and stage questions ON (they are ON in the
 * release workflows). Before the fix the render throws that TypeError.
 *
 * Only leaf children and server reads are stubbed; the stubs mirror
 * mainView.dayUnderstandingOrder.test.tsx, which renders this same surface.
 *
 * spec: 2026-08-25-prod-cutover-waves (release 1.0.16)
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AppRouterContext } from '../routeContext';
import type { DailyLog } from '../../../types';

const TODAY = '2026-10-19';

const makeLog = (o: Partial<DailyLog> = {}): DailyLog => ({
    id: 'log-1',
    date: TODAY,
    context: { selection: [{ cropId: 'crop-1', cropName: 'grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['Plot 1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
    ...o,
});

/** The record the farmer just saved by voice — the one the saved screen is about. */
const justSaved = makeLog({ id: 'today-log', irrigation: [{ id: 'ir-1', method: 'Drip', source: 'well' }] });
const priorSpray = makeLog({ id: 'spray-2026-10-16', date: '2026-10-16', inputs: [{ id: 'in-1', method: 'Spray', mix: [] }] });
/** Saved by 1.0.14's voice-attendance बरोबर: labour on the same plot, no `date`. */
const legacyDateless = {
    ...makeLog({ id: 'legacy-dateless-1', labour: [{ id: 'lab-1', type: 'HIRED', count: 4 }], captureScope: 'labour' }),
    date: undefined,
} as unknown as DailyLog;

// F85 (lane OPS-1): the cost of this test is IMPORTING the whole log-view graph (mainView and everything under it).
// It used to be imported inside the test body after vi.resetModules(), so a cold transform of that graph (12 s and more
// on a loaded full run) was charged to the test's 15 s limit and it timed out with the render itself taking milliseconds.
// The mocks are now hoisted (vi.mock) and the graph is imported ONCE, at the top of the file, in the collection phase -
// no per-test limit applies to that, the work is the same, and the test itself measures only what it is about.
const { dataSource, stub } = vi.hoisted(() => ({
    dataSource: {
        crops: { getAll: async () => [], save: async () => { } },
        profile: { get: async () => null },
        logs: { getAll: async () => [] as unknown[] },
    },
    stub: async (label: string) => {
        const React = await import('react');
        return { default: () => React.createElement('div', { 'data-stub': label }) };
    },
}));

// Leaf children of the log view - same stubs as mainView.dayUnderstandingOrder.test.tsx.
vi.mock('../../../features/context/components/CropSelector', async () => {
    const React = await import('react');
    return {
        default: () => React.createElement('div', { 'data-stub': 'crop-selector' }),
        CropSymbol: () => null,
    };
});
vi.mock('../../../shared/components/ui/InputMethodToggle', () => stub('input-toggle'));
vi.mock('../../../features/weather/components/WeatherWidget', () => stub('weather'));
vi.mock('../../../features/voice/components/AudioRecorder', () => stub('audio'));
vi.mock('../../../features/voice/components/AudioRecorderStreaming', () => stub('audio-streaming'));
vi.mock('../../../features/voice/components/LiveCaption', () => stub('live-caption'));
vi.mock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));

// The REAL recognition panel (it is where the crash lives). Only its server reads are neutralised, so the panel needs no network.
vi.mock('../../../features/logs/hooks/useFarmerEngagement', () => ({
    useFarmerEngagement: () => ({ engagement: null, isLoading: false, error: null, refresh: () => { } }),
}));
vi.mock('../../../features/logs/hooks/useDfesQuestion', () => ({
    useDfesQuestion: () => ({ selected: null, loading: false, recordOutcome: () => { } }),
}));
vi.mock('../../../features/logs/hooks/useDayUnderstanding', () => ({
    useDayUnderstanding: () => ({ score: null, isLoading: false, error: null, refresh: () => { } }),
}));
vi.mock('../../../i18n/LanguageContext', async () => {
    const { t: translate } = await import('../../../i18n/translations');
    return {
        useLanguage: () => ({ language: 'mr', setLanguage: () => { }, t: (k: string) => translate(k, 'mr') }),
    };
});
// Stage questions ON, as release-build.yml / release.yml set them: the panel runs computePreviousLog over `allLogs` only when this is on.
vi.mock('../../../app/featureFlags', () => ({
    FEATURE_FLAGS: { understandingMeter: true, stageQuestions: true, dailyLoop: false, voiceContinuity: false },
    IS_E2E_HARNESS_ENABLED: false,
    isE2EHarnessEnabled: () => false,
    isFarmGeographyV2Enabled: () => false,
    isWeatherBackendFetchEnabled: () => false,
    isVoiceDoomLoopDetectorEnabled: () => true,
}));
// The app's real history loader, over a stored ledger holding the 1.0.14 row.
vi.mock('../../../app/providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource, auditPort: {}, isDemoMode: false, setDemoMode: async () => { }, isLoading: false }),
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: false, session: null }),
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: async () => { } },
}));

import { useAppData } from '../../../app/hooks/useAppData';
import { renderLogView } from '../mainView';

/** The success-card context, as mainView.dayUnderstandingOrder.test.tsx builds it, over the loaded history. */
function makeCtx(history: DailyLog[]): AppRouterContext {
    const day = {
        closurePercent: 40, isClosed: false, hasStarted: true,
        completedCount: 3, plannedCount: 5, pendingCount: 2, unverifiedCount: 0,
    };
    return {
        currentRoute: 'main',
        mainView: 'log',
        status: 'success',
        mode: 'voice',
        recordingSegment: null,
        weatherData: null,
        weatherStatus: 'idle',
        boundaryUnset: false,
        refetchWeather: () => { },
        setCurrentRoute: () => { },
        ownerDisplayName: 'Owner',
        todayDayState: day,
        yesterdayDayState: day,
        showCloseDaySummary: false,
        setShowCloseDaySummary: () => { },
        showCloseYesterdaySummary: false,
        setShowCloseYesterdaySummary: () => { },
        setShowReviewInbox: () => { },
        setMainView: () => { },
        crops: [],
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: () => { },
        setMode: () => { },
        setStatus: () => { },
        hasActiveLogContext: false,
        isContextReady: false,
        error: null,
        errorTranscript: undefined,
        handleAudioReady: () => { },
        handleTextReady: () => { },
        handleManualSubmit: () => { },
        currentLogContext: null,
        ledgerDefaults: {},
        farmerProfile: { operators: [], activeOperatorId: '' },
        draftLog: null,
        setDraftLog: () => { },
        provenance: undefined,
        voiceStreamingPhase: 'idle',
        liveCaption: '',
        continuityLevel: null,
        savedPendingCaptureId: null,
        getTodayCounts: () => ({}),
        getContextColorIndicator: () => null,
        activeFarmId: 'farm-1',
        history,
        todayLogs: [],
        operatorNameById: new Map(),
        getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
        handleEditLog: () => { },
        costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0 },
        yesterdayCost: 0,
        setRecordingSegment: () => { },
        lastSavedLogSummary: [{ logId: 'today-log', cropId: null, cropName: 'द्राक्ष', plotName: 'प्लॉट १' }],
        lastSavedLogIds: ['today-log'],
        mockHistory: history,
        handleReset: () => { },
    } as unknown as AppRouterContext;
}

beforeAll(() => {
    dataSource.logs.getAll = async () => [justSaved, legacyDateless, priorSpray];
});

afterEach(() => {
    cleanup();
});

describe('saved screen — an old dateless diary row on the phone cannot crash it (1.0.16)', () => {
    it('opens, with the real recognition panel, over the history the app loads', async () => {
        const { result } = renderHook(() => useAppData());
        await waitFor(() => expect(result.current.dataLoaded).toBe(true));

        render(<>{renderLogView(makeCtx(result.current.history))}</>);

        expect(screen.getByTestId('saved-to-ledger')).toBeInTheDocument();
        expect(screen.getByTestId('ledger-recognition-panel')).toBeInTheDocument();
        // The record the screen is about is still there: its work is summarised.
        expect(screen.getByText('कुठे')).toBeInTheDocument();
    });
});
