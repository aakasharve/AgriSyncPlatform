// @vitest-environment jsdom
//
// spec: dfes-truthful-number-and-merge-readiness-2026-08-13 (task-10, BUG 2)
//
// renderLogView — a way back OUT of the post-save surface.
//
// Founder, verbatim: "there is no going back screen after this screen". The
// `saved-to-ledger` card had exits only at its very bottom, and Android's
// hardware back left the app because this SPA never pushed history.
//
// Pinned here:
//   • the back control renders on the success surface, and ONLY there;
//   • tapping it runs the same safe reset the bottom "आणखी नोंद करा" uses;
//   • a popstate (Android hardware back) runs that same reset;
//   • the control sits OUTSIDE the `overflow-hidden` card — inside it,
//     `position: sticky` silently stops working and the control scrolls away,
//     which is the exact failure the founder reported.
//
// Mirrors the mock-then-dynamic-import pattern in mainView.successClarity.test.tsx.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AppRouterContext } from '../routeContext';

const stub = (label: string) => ({
    default: () => React.createElement('div', { 'data-stub': label }),
});

async function loadRenderLogView() {
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
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({
        LedgerRecognitionPanel: () =>
            React.createElement('div', { 'data-testid': 'ledger-recognition-panel' }),
    }));
    vi.doMock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));

    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({
            language: 'mr',
            setLanguage: () => {},
            t: (k: string) => k,
        }),
    }));

    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { dailyLoop: false, voiceContinuity: false },
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
        yesterdayDayState: { ...today },
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

describe('renderLogView — going back from the post-save surface (BUG 2)', () => {
    it('renders an icon-led back control on the success surface', async () => {
        const renderLogView = await loadRenderLogView();
        render(<>{renderLogView(makeCtx())}</>);

        expect(screen.getByTestId('saved-to-ledger')).toBeInTheDocument();
        const back = screen.getByTestId('saved-back');
        expect(back).toBeInTheDocument();
        // >= 44px tap target (CHARTER).
        expect(back.className).toContain('min-h-[44px]');
        // Icon-led: an SVG arrow, not a bare text link.
        expect(back.querySelector('svg')).not.toBeNull();
    });

    it('the control sits OUTSIDE the overflow-hidden card, above it, and sticks', async () => {
        const renderLogView = await loadRenderLogView();
        render(<>{renderLogView(makeCtx())}</>);

        const bar = screen.getByTestId('saved-back-bar');
        const card = screen.getByTestId('saved-to-ledger');

        // `overflow-hidden` on the card would neutralise position: sticky.
        expect(card.contains(bar)).toBe(false);
        expect(bar.className).toContain('sticky');
        expect(bar.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('tapping back runs the same reset the bottom "log another" button uses', async () => {
        const renderLogView = await loadRenderLogView();
        const handleReset = vi.fn();
        render(<>{renderLogView(makeCtx({ handleReset }))}</>);

        fireEvent.click(screen.getByTestId('saved-back'));
        expect(handleReset).toHaveBeenCalledTimes(1);
    });

    it('Android hardware back (popstate) runs the same reset', async () => {
        const renderLogView = await loadRenderLogView();
        const handleReset = vi.fn();
        render(<>{renderLogView(makeCtx({ handleReset }))}</>);

        expect(handleReset).not.toHaveBeenCalled();
        fireEvent(window, new Event('popstate'));
        expect(handleReset).toHaveBeenCalledTimes(1);
    });

    it('no back control (and no history entry) before a log is saved', async () => {
        const renderLogView = await loadRenderLogView();
        render(<>{renderLogView(makeCtx({ status: 'idle' }))}</>);

        expect(screen.queryByTestId('saved-to-ledger')).toBeNull();
        expect(screen.queryByTestId('saved-back')).toBeNull();
    });
});
