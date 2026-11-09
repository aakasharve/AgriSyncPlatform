// @vitest-environment jsdom
//
// spec: dfes-input-truth-and-mix-check-2026-11-06 (founder decision D-122, 2026-11-09)
//
// renderLogView - the saved-to-ledger surface carries NO farm-day understanding score.
//
// History: on 2026-07-19 the farm-day "X / १०" card (DayUnderstandingCard) was placed FIRST on this
// surface, and this file asserted that order. D-122 deleted that older whole-farm-day meter so the PLOT
// hero meter on the result screen (ResultHero) is the only understanding number. What is left to hold,
// on the real success card (not a stub of it), is:
//
//   Sathi's speech  ->  crop summary  ->  recognition panel
//
// and that no farm-day score block, bar, section or fetch appears, even with the flag ON.
//
// Only the heavy leaf children are stubbed (recorders, weather, ledger cards) plus the recognition
// panel, which becomes a marker so we can assert it comes AFTER the crop summary. The farm-day server
// hook is a spy: nothing on this surface may call it any more.
// Mirrors the mock-then-dynamic-import pattern in mainView.successClarity.test.tsx.
import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { t as translate } from '../../../i18n/translations';
import type { AppRouterContext } from '../routeContext';

/** Spy for the farm-day score fetch. The saved surface must never call it (D-122). */
const useDayUnderstandingSpy = vi.fn();

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
 *                           + MeterDisplay) mounts, so a score block hiding inside it
 *                           would actually show up. Its engagement fetch is mocked so
 *                           the real panel needs no network.
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
    if (stubPanel) {
        // Recognition panel → marker only; we assert it renders AFTER the crop summary.
        vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({
            LedgerRecognitionPanel: () =>
                React.createElement('div', { 'data-testid': 'ledger-recognition-panel' }),
        }));
    } else {
        // vi.doMock registrations survive vi.resetModules(), so a stub registered by
        // an EARLIER test in this file would silently leak in here and make the
        // "none" count vacuous. Explicitly drop it.
        vi.doUnmock('../../../features/logs/components/LedgerRecognitionPanel');
        // Real panel — only its server engagement fetch is neutralised.
        vi.doMock('../../../features/logs/hooks/useFarmerEngagement', () => ({
            useFarmerEngagement: () => ({ engagement: null, isLoading: false, error: null, refresh: vi.fn() }),
        }));
    }
    vi.doMock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));

    // The farm-day score's server fetch. Nothing on the saved surface calls it any more; the spy proves it.
    vi.doMock('../../../features/logs/hooks/useDayUnderstanding', () => ({
        useDayUnderstanding: (...args: unknown[]) => {
            useDayUnderstandingSpy(...args);
            return { score: dayScore, isLoading: false, error: null, refresh: vi.fn() };
        },
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
        // wave-2.4 follow-up: this day HAS begun (5 planned, 3 done) — the
        // not-started state is exercised in mainView.dailyLoop.test.tsx.
        hasStarted: true,
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
        // The just-saved log the success card summarises (drives the crop summary block).
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

beforeEach(() => {
    useDayUnderstandingSpy.mockClear();
});

afterEach(() => {
    cleanup();
    vi.resetModules();
});

/** Every test id the deleted farm-day card (or its blue "grasp" section) used to draw. */
const FARM_DAY_SCORE_IDS = [
    'day-understanding',
    'day-understanding-value',
    'day-understanding-pending',
    'understanding-bar',
    'section-grasp',
    'meter-score',
];

// Each test re-imports mainView after vi.resetModules (a cold module graph); in the full parallel run that can pass
// the 15 s default, so this suite gets the same budget as mainView.voiceResult.test.tsx.
describe('renderLogView - the saved-to-ledger surface has no farm-day understanding score (D-122)', { timeout: 60_000 }, () => {
    it('with the meter flag ON and a score of 8, no farm-day score block, bar or section is drawn', async () => {
        const renderLogView = await loadRenderLogView(true, 8);
        render(<>{renderLogView(makeCtx())}</>);

        expect(screen.getByTestId('saved-to-ledger')).toBeInTheDocument();
        for (const id of FARM_DAY_SCORE_IDS) expect(screen.queryByTestId(id), id).toBeNull();
        // The old farm-day number text is not on the surface either.
        expect(screen.queryByText(/८\s*\/\s*१०/)).toBeNull();
        expect(useDayUnderstandingSpy).not.toHaveBeenCalled();
    });

    it('with a null (pending) score, no pending placeholder stands in the old score position', async () => {
        const renderLogView = await loadRenderLogView(true, null);
        render(<>{renderLogView(makeCtx())}</>);

        for (const id of FARM_DAY_SCORE_IDS) expect(screen.queryByTestId(id), id).toBeNull();
        expect(screen.queryByText('अजून समजतंय…')).toBeNull();
        expect(useDayUnderstandingSpy).not.toHaveBeenCalled();
    });

    it('the rest of the order still holds: Sathi speaks, then the crop summary, then the recognition panel', async () => {
        const renderLogView = await loadRenderLogView(true, 8);
        render(<>{renderLogView(makeCtx())}</>);

        // REDESIGN 2026-08-13 - the surface opens with the character SPEAKING (SathiSaidCard).
        const heading = screen.getByTestId('sathi-said');
        // The crop-summary block has no testid of its own; its "Stored In" label is
        // the stable, unique marker for it (see the work section in savedView).
        const cropSummary = screen.getByText('कुठे');
        const panel = screen.getByTestId('ledger-recognition-panel');

        expectPrecedes(heading, cropSummary);
        expectPrecedes(cropSummary, panel);
        // The work section keeps its own wrapper.
        expect(screen.getByTestId('section-work')).toBeInTheDocument();
    });

    it('understandingMeter OFF -> still no score block anywhere on the success card', async () => {
        const renderLogView = await loadRenderLogView(false, 8);
        render(<>{renderLogView(makeCtx())}</>);

        expect(screen.getByTestId('saved-to-ledger')).toBeInTheDocument();
        for (const id of FARM_DAY_SCORE_IDS) expect(screen.queryByTestId(id), id).toBeNull();
        expect(useDayUnderstandingSpy).not.toHaveBeenCalled();
    });

    it('with the REAL recognition panel mounted there is still no score block of any kind', async () => {
        // No panel stub here: the real LedgerRecognitionPanel → MeterQuestionHost →
        // MeterDisplay chain mounts, so a score block hiding inside it WOULD be found
        // by these queries.
        const renderLogView = await loadRenderLogView(true, 8, false);
        render(<>{renderLogView(makeCtx())}</>);

        // Guard against a vacuous pass: the real panel AND the real MeterDisplay
        // must actually be on screen for the "none" count to mean anything.
        expect(screen.getByTestId('ledger-recognition-panel')).toBeInTheDocument();
        expect(screen.getByTestId('meter-display')).toBeInTheDocument();

        for (const id of FARM_DAY_SCORE_IDS) expect(screen.queryAllByTestId(id), id).toHaveLength(0);
        expect(useDayUnderstandingSpy).not.toHaveBeenCalled();
    });
});
