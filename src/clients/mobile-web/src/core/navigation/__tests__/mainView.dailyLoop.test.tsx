// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11
//
// renderLogView — Daily Clarity Loop v1 feature gate.
//
// Proves the loop's home-view contract:
//   • dailyLoop OFF → no hero, and the legacy "Yesterday not fully closed"
//     banner still renders (byte-equivalent no-op — home is unchanged).
//   • dailyLoop ON  → the "आज N कामं बाकी" hero renders at the top, and the
//     separate yesterday banner is suppressed (its signal is folded into the
//     hero).
//
// The heavy home children (weather, crop selector, recorders, ledger, etc.) are
// stubbed so the test isolates the gate + the (real) DailyLoopHero. featureFlags
// is mocked to force the loop flag either way. Mirrors the mock-then-dynamic-
// import pattern established in AppRouter.feature-gate.test.tsx.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AppRouterContext } from '../routeContext';

const stub = (label: string) => ({
    default: () => React.createElement('div', { 'data-stub': label }),
});

async function loadRenderLogView(dailyLoop: boolean) {
    vi.resetModules();

    // Heavy home children → trivial stubs (only their presence matters here).
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
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({
        LedgerRecognitionPanel: () => null,
    }));
    vi.doMock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));

    // Bind the real DailyLoopHero's copy without the async LanguageProvider.
    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => k }),
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
        completedCount: 1,
        plannedCount: 6,
        pendingCount: 5,
        unverifiedCount: 0,
    };
    const yesterday = { ...today, isClosed: false, pendingCount: 2 };

    return {
        currentRoute: 'main',
        mainView: 'log',
        status: 'idle',
        mode: 'manual',
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

describe('renderLogView — Daily Clarity Loop v1 gate', () => {
    it('OFF: no hero, and the legacy "Yesterday not fully closed" banner still shows', async () => {
        const renderLogView = await loadRenderLogView(false);
        render(<>{renderLogView(makeCtx())}</>);
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
        expect(screen.getByText('Yesterday not fully closed')).toBeInTheDocument();
    });

    it('ON: the "आज N कामं बाकी" hero shows and the separate yesterday banner is folded away', async () => {
        const renderLogView = await loadRenderLogView(true);
        render(<>{renderLogView(makeCtx())}</>);
        expect(screen.getByTestId('daily-loop-hero')).toBeInTheDocument();
        expect(screen.queryByText('Yesterday not fully closed')).toBeNull();
    });
});
