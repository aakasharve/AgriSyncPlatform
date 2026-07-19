// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11
//
// renderLogView — the Day Understanding Score leads the "Saved to Ledger" surface.
//
// Founder request 2026-07-19: the score + bar used to render deep inside the
// recognition panel, so the farmer saw it BELOW the crop summary, the clarity line
// and the fact line. It must now be the FIRST thing on the saved-to-ledger card,
// directly under the heading. This asserts real DOM ORDER on the real success card
// (not a stub of it):
//
//   "Saved to Ledger" heading  →  day-understanding  →  crop summary  →  recognition panel
//
// Only the heavy leaf children are stubbed (recorders, weather, ledger cards) plus
// the recognition panel, which becomes a marker so we can assert it comes AFTER.
// DayUnderstandingCard itself renders for real — only its server hook is mocked.
// Mirrors the mock-then-dynamic-import pattern in mainView.successClarity.test.tsx.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { t as translate } from '../../../i18n/translations';
import type { AppRouterContext } from '../routeContext';

const stub = (label: string) => ({
    default: () => React.createElement('div', { 'data-stub': label }),
});

/** Assert `first` precedes `second` in document order. */
function expectPrecedes(first: Element, second: Element) {
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/**
 * @param stubPanel  true  → LedgerRecognitionPanel is a marker (ordering assertions).
 *                   false → the REAL panel (and therefore the real MeterQuestionHost
 *                           + MeterDisplay) mounts, so a duplicate score block would
 *                           actually show up. Its engagement fetch is mocked so the
 *                           real panel needs no network.
 */
async function loadRenderLogView(understandingMeter: boolean, dayScore: number | null, stubPanel = true) {
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
    if (stubPanel) {
        // Recognition panel → marker only; we assert the score card renders ABOVE it.
        vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({
            LedgerRecognitionPanel: () =>
                React.createElement('div', { 'data-testid': 'ledger-recognition-panel' }),
        }));
    } else {
        // vi.doMock registrations survive vi.resetModules(), so a stub registered by
        // an EARLIER test in this file would silently leak in here and make the
        // "exactly once" count vacuous. Explicitly drop it.
        vi.doUnmock('../../../features/logs/components/LedgerRecognitionPanel');
        // Real panel — only its server engagement fetch is neutralised.
        vi.doMock('../../../features/logs/hooks/useFarmerEngagement', () => ({
            useFarmerEngagement: () => ({ engagement: null, isLoading: false, error: null, refresh: vi.fn() }),
        }));
    }
    vi.doMock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));

    // The ONLY thing mocked inside DayUnderstandingCard — its server fetch.
    vi.doMock('../../../features/logs/hooks/useDayUnderstanding', () => ({
        useDayUnderstanding: () => ({ score: dayScore, isLoading: false, error: null, refresh: vi.fn() }),
    }));

    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({
            language: 'mr',
            setLanguage: () => {},
            t: (k: string) => translate(k, 'mr'),
        }),
    }));

    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { understandingMeter, dailyLoop: false, voiceContinuity: false },
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
        activeFarmId: 'farm-1',
        // The just-saved log the success card summarises — drives BOTH the crop
        // summary block and the score card's farm/date/refetch-key derivation.
        history: [{ id: 'log-1', date: '2026-07-19' }],
        todayLogs: [],
        operatorNameById: new Map(),
        getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
        handleEditLog: () => {},
        costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0 },
        yesterdayCost: 0,
        setRecordingSegment: () => {},
        lastSavedLogSummary: [{ logId: 'log-1', cropId: null, cropName: 'द्राक्ष', plotName: 'प्लॉट १' }],
        lastSavedLogIds: ['log-1'],
        mockHistory: [],
        handleReset: () => {},
        ...overrides,
    } as unknown as AppRouterContext;
}

afterEach(() => {
    cleanup();
    vi.resetModules();
});

describe('renderLogView — Day Understanding Score leads the saved-to-ledger surface', () => {
    it('renders the score + bar ABOVE the crop summary and the recognition panel', async () => {
        const renderLogView = await loadRenderLogView(true, 8);
        render(<>{renderLogView(makeCtx())}</>);

        const heading = screen.getByText('Saved to Ledger');
        const understanding = screen.getByTestId('day-understanding');
        // The crop-summary block has no testid of its own; its "Stored In" label is
        // the stable, unique marker for it (see mainView's Dynamic Feedback Summary).
        const cropSummary = screen.getByText('Stored In');
        const panel = screen.getByTestId('ledger-recognition-panel');

        // The founder's actual requirement: score FIRST on the success surface.
        expectPrecedes(heading, understanding);
        expectPrecedes(understanding, cropSummary);
        expectPrecedes(understanding, panel);

        // ...and it is the real, founder-approved score block, not a placeholder.
        expect(screen.getByTestId('day-understanding-value').textContent).toBe('८ / १०');
        expect(screen.getByTestId('understanding-bar')).toBeInTheDocument();
    });

    it('renders the pending state in the same leading position when the score is null', async () => {
        const renderLogView = await loadRenderLogView(true, null);
        render(<>{renderLogView(makeCtx())}</>);

        const pending = screen.getByTestId('day-understanding-pending');
        expectPrecedes(pending, screen.getByText('Stored In'));
        expect(pending.textContent).toBe('अजून समजतंय…');
    });

    it('understandingMeter OFF → no score block anywhere on the success card', async () => {
        const renderLogView = await loadRenderLogView(false, 8);
        render(<>{renderLogView(makeCtx())}</>);

        expect(screen.getByTestId('saved-to-ledger')).toBeInTheDocument();
        expect(screen.queryByTestId('meter-score')).toBeNull();
        expect(screen.queryByTestId('day-understanding')).toBeNull();
        expect(screen.queryByTestId('day-understanding-pending')).toBeNull();
    });

    it('renders the score block EXACTLY ONCE with the REAL recognition panel mounted', async () => {
        // No panel stub here: the real LedgerRecognitionPanel → MeterQuestionHost →
        // MeterDisplay chain mounts, so a leftover score block inside it WOULD be
        // found by these queries. This is what proves the move, not a copy.
        const renderLogView = await loadRenderLogView(true, 8, false);
        render(<>{renderLogView(makeCtx())}</>);

        // Guard against a vacuous pass: the real panel AND the real MeterDisplay
        // must actually be on screen for the "exactly once" count to mean anything.
        expect(screen.getByTestId('ledger-recognition-panel')).toBeInTheDocument();
        expect(screen.getByTestId('meter-display')).toBeInTheDocument();

        expect(screen.getAllByTestId('meter-score')).toHaveLength(1);
        expect(screen.getAllByTestId('day-understanding')).toHaveLength(1);
        expect(screen.getAllByTestId('understanding-bar')).toHaveLength(1);
        // ...and the surviving one is the leading card, above the crop summary.
        expectPrecedes(screen.getByTestId('day-understanding'), screen.getByText('Stored In'));
    });
});
