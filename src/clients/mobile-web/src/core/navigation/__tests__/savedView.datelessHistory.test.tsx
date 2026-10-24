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
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { t as translate } from '../../../i18n/translations';
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

const dataSource = {
    crops: { getAll: vi.fn(async () => []), save: vi.fn(async () => { }) },
    profile: { get: vi.fn(async () => null) },
    logs: { getAll: vi.fn(async () => [justSaved, legacyDateless, priorSpray]) },
};

const stub = (label: string) => ({
    default: () => React.createElement('div', { 'data-stub': label }),
});

async function loadSavedPath() {
    vi.resetModules();

    // Leaf children of the log view — same stubs as mainView.dayUnderstandingOrder.test.tsx.
    vi.doMock('../../../features/context/components/CropSelector', () => ({
        default: () => React.createElement('div', { 'data-stub': 'crop-selector' }),
        CropSymbol: () => null,
    }));
    vi.doMock('../../../shared/components/ui/InputMethodToggle', () => stub('input-toggle'));
    vi.doMock('../../../features/weather/components/WeatherWidget', () => stub('weather'));
    vi.doMock('../../../features/voice/components/AudioRecorder', () => stub('audio'));
    vi.doMock('../../../features/voice/components/AudioRecorderStreaming', () => stub('audio-streaming'));
    vi.doMock('../../../features/voice/components/LiveCaption', () => stub('live-caption'));
    vi.doMock('../../../features/logs/components/ManualEntry', () => stub('manual-entry'));
    vi.doMock('../../../features/logs/components/DailyLogCard', () => stub('daily-log-card'));
    vi.doMock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));

    // The REAL recognition panel (it is where the crash lives). Only its server
    // reads are neutralised, so the panel needs no network.
    vi.doUnmock('../../../features/logs/components/LedgerRecognitionPanel');
    vi.doMock('../../../features/logs/hooks/useFarmerEngagement', () => ({
        useFarmerEngagement: () => ({ engagement: null, isLoading: false, error: null, refresh: vi.fn() }),
    }));
    vi.doMock('../../../features/logs/hooks/useDfesQuestion', () => ({
        useDfesQuestion: () => ({ selected: null, loading: false, recordOutcome: vi.fn() }),
    }));
    vi.doMock('../../../features/logs/hooks/useDayUnderstanding', () => ({
        useDayUnderstanding: () => ({ score: null, isLoading: false, error: null, refresh: vi.fn() }),
    }));
    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => { }, t: (k: string) => translate(k, 'mr') }),
    }));
    // Stage questions ON, as release-build.yml / release.yml set them: the panel
    // runs computePreviousLog over `allLogs` only when this is on.
    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { understandingMeter: true, stageQuestions: true, dailyLoop: false, voiceContinuity: false },
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
    }));

    // The app's real history loader, over a stored ledger holding the 1.0.14 row.
    vi.doMock('../../../app/providers/DataSourceProvider', () => ({
        useDataSource: () => ({ dataSource, auditPort: {}, isDemoMode: false, setDemoMode: async () => { }, isLoading: false }),
    }));
    vi.doMock('../../../app/providers/AuthProvider', () => ({
        useAuth: () => ({ isAuthenticated: false, session: null }),
    }));
    vi.doMock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
        backgroundSyncWorker: { triggerNow: vi.fn(async () => { }) },
    }));

    const { useAppData } = await import('../../../app/hooks/useAppData');
    const { renderLogView } = await import('../mainView');
    return { useAppData, renderLogView };
}

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

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.resetModules();
});

describe('saved screen — an old dateless diary row on the phone cannot crash it (1.0.16)', () => {
    it('opens, with the real recognition panel, over the history the app loads', async () => {
        const { useAppData, renderLogView } = await loadSavedPath();
        const { result } = renderHook(() => useAppData());
        await waitFor(() => expect(result.current.dataLoaded).toBe(true));

        render(<>{renderLogView(makeCtx(result.current.history))}</>);

        expect(screen.getByTestId('saved-to-ledger')).toBeInTheDocument();
        expect(screen.getByTestId('ledger-recognition-panel')).toBeInTheDocument();
        // The record the screen is about is still there: its work is summarised.
        expect(screen.getByText('कुठे')).toBeInTheDocument();
    });
});
