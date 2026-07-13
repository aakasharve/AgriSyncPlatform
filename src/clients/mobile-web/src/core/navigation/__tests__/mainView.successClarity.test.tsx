// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11
//
// renderLogView — Daily Clarity Loop v1 REWARD line on the "Saved to Ledger" card.
//
// Proves the reward contract on the success card:
//   • dailyLoop OFF → NO clarity line; the success card is byte-unchanged (the
//     recognition panel still hosts Sathi's question, nothing above it).
//   • dailyLoop ON  → the "{done} पूर्ण, {left} बाकी" clarity line renders,
//     positioned ABOVE the DFES recognition panel (which hosts the one question),
//     driven by todayDayState.completedCount / .pendingCount.
//   • Decision 3B: there is NO fact/insight fallback element in either state — on
//     a no-question day (panel yields nothing) the clarity line stands alone.
//
// The heavy success-card children (recognition panel, recorders, ledger cards)
// are stubbed; the recognition panel becomes a recognizable marker so we can
// assert ordering. featureFlags + LanguageContext are mocked. Mirrors the
// mock-then-dynamic-import pattern in mainView.dailyLoop.test.tsx.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AppRouterContext } from '../routeContext';

const stub = (label: string) => ({
    default: () => React.createElement('div', { 'data-stub': label }),
});

const CLARITY_TEMPLATE = '{done} पूर्ण, {left} बाकी';

async function loadRenderLogView(dailyLoop: boolean) {
    vi.resetModules();

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
    // Recognition panel → recognizable marker so we can assert the clarity line
    // renders ABOVE it. An empty marker also models the graceful "no question"
    // day (decision 3B): the panel is present but yields nothing.
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({
        LedgerRecognitionPanel: () =>
            React.createElement('div', { 'data-testid': 'ledger-recognition-panel' }),
    }));
    vi.doMock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));

    // Bind the real DailyLoopClarity's copy without the async LanguageProvider.
    // Return the real Marathi template for the clarity key so we can assert on
    // the interleaved numerals + words; echo the key otherwise.
    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({
            language: 'mr',
            setLanguage: () => {},
            t: (k: string) => (k === 'dfes.dailyLoopClarity' ? CLARITY_TEMPLATE : k),
        }),
    }));

    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { dailyLoop, voiceContinuity: false },
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
    }));

    const mod = await import('../mainView');
    return mod.renderLogView;
}

function makeCtx(overrides: Partial<AppRouterContext> = {}): AppRouterContext {
    const today = {
        closurePercent: 40,
        isClosed: false,
        completedCount: 3,
        plannedCount: 5,
        pendingCount: 2,
        unverifiedCount: 0,
    };
    const yesterday = { ...today, isClosed: false, pendingCount: 2 };

    return {
        currentRoute: 'main',
        mainView: 'log',
        status: 'success',
        mode: 'voice',
        recordingSegment: null,
        weatherData: null,
        weatherStatus: 'idle',
        boundaryUnset: false,
        refetchWeather: () => {},
        setCurrentRoute: () => {},
        ownerDisplayName: 'Owner',
        todayDayState: today,
        yesterdayDayState: yesterday,
        showCloseDaySummary: false,
        setShowCloseDaySummary: () => {},
        showCloseYesterdaySummary: false,
        setShowCloseYesterdaySummary: () => {},
        setShowReviewInbox: () => {},
        setMainView: () => {},
        crops: [],
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: () => {},
        setMode: () => {},
        setStatus: () => {},
        hasActiveLogContext: false,
        isContextReady: false,
        error: null,
        errorTranscript: undefined,
        handleAudioReady: () => {},
        handleTextReady: () => {},
        handleManualSubmit: () => {},
        currentLogContext: null,
        ledgerDefaults: {},
        farmerProfile: { operators: [], activeOperatorId: '' },
        draftLog: null,
        setDraftLog: () => {},
        provenance: undefined,
        voiceStreamingPhase: 'idle',
        liveCaption: '',
        continuityLevel: null,
        savedPendingCaptureId: null,
        getTodayCounts: () => ({}),
        getContextColorIndicator: () => null,
        history: [],
        todayLogs: [],
        operatorNameById: new Map(),
        getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
        handleEditLog: () => {},
        costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0 },
        yesterdayCost: 0,
        setRecordingSegment: () => {},
        lastSavedLogSummary: [],
        lastSavedLogIds: [],
        mockHistory: [],
        handleReset: () => {},
        ...overrides,
    } as unknown as AppRouterContext;
}

afterEach(() => {
    cleanup();
    vi.resetModules();
});

describe('renderLogView — Daily Clarity Loop v1 REWARD line (success card)', () => {
    it('OFF: no clarity line; the success card + recognition panel are unchanged', async () => {
        const renderLogView = await loadRenderLogView(false);
        render(<>{renderLogView(makeCtx())}</>);

        expect(screen.getByTestId('saved-to-ledger')).toBeInTheDocument();
        expect(screen.queryByTestId('daily-loop-clarity')).toBeNull();
        // The question host (recognition panel) is still present, untouched.
        expect(screen.getByTestId('ledger-recognition-panel')).toBeInTheDocument();
        // Decision 3B: never any fact/insight fallback.
        expect(screen.queryByTestId('daily-loop-fact')).toBeNull();
    });

    it('ON: clarity line "{done} पूर्ण, {left} बाकी" shows, positioned ABOVE the recognition panel', async () => {
        const renderLogView = await loadRenderLogView(true);
        render(<>{renderLogView(makeCtx())}</>);

        const clarity = screen.getByTestId('daily-loop-clarity');
        expect(clarity).toBeInTheDocument();
        // completedCount=3 done, pendingCount=2 left — plain fact, no score.
        expect(clarity.textContent).toContain('3');
        expect(clarity.textContent).toContain('पूर्ण');
        expect(clarity.textContent).toContain('2');
        expect(clarity.textContent).toContain('बाकी');

        // The question slot (recognition panel) sits directly BELOW the reward line.
        const panel = screen.getByTestId('ledger-recognition-panel');
        expect(panel).toBeInTheDocument();
        const order = clarity.compareDocumentPosition(panel);
        expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        // Decision 3B: still no fact/insight fallback element — reward = clarity + question only.
        expect(screen.queryByTestId('daily-loop-fact')).toBeNull();
    });
});
