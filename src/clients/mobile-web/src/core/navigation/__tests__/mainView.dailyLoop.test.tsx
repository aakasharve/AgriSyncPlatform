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
import type { PlannedTask } from '../../../types';
import { getDateKey } from '../../domain/services/DateKeyService';

const stub = (label: string) => ({
    default: () => React.createElement('div', { 'data-stub': label }),
});

// Real "today" (IST) and helpers to make genuinely-carried past due-dates, so
// getCarriedTasks (NOT mocked — runs for real) treats them as overdue.
const TODAY_KEY = getDateKey();
const daysAgoKey = (n: number): string => {
    const d = new Date(`${TODAY_KEY}T12:00:00`);
    d.setDate(d.getDate() - n);
    return getDateKey(d);
};
const makeTask = (id: string, dueDate: string, status: PlannedTask['status']): PlannedTask => ({
    id,
    title: `task-${id}`,
    plotId: 'plot-a',
    cropId: 'crop-a',
    priority: 'normal',
    status,
    sourceType: 'ai_extracted',
    createdAt: `${daysAgoKey(3)}T06:00:00.000Z`,
    dueDate,
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

    // ---- Fix 2: one calm opener — hide the leftover duplicates when ON ----

    it('OFF: the buried English "Tasks: Done/Planned" line and the closure ring both render', async () => {
        const renderLogView = await loadRenderLogView(false);
        render(<>{renderLogView(makeCtx())}</>);
        expect(screen.getByText(/Tasks: Done 1 \/ Planned 6/)).toBeInTheDocument();
        // No hero → the ONLY closure ring is the card's own (one "40%").
        expect(screen.getAllByText('40%')).toHaveLength(1);
    });

    it('ON: the old "Tasks: Done/Planned" line is hidden and the DUPLICATE ring is gone (only the hero ring)', async () => {
        const renderLogView = await loadRenderLogView(true);
        render(<>{renderLogView(makeCtx())}</>);
        // The buried English tasks line is suppressed — hero is the single opener.
        expect(screen.queryByText(/Tasks: Done/)).toBeNull();
        // Exactly one closure ring survives: the hero's. If the card ring were
        // still shown, "40%" would appear twice (hero + card).
        expect(screen.getAllByText('40%')).toHaveLength(1);
        // And that one ring belongs to the hero.
        expect(screen.getByTestId('daily-loop-hero')).toHaveTextContent('40%');
    });

    // ---- Fix 1: carry-forward coherence — carried k <= today's N, never divergent ----

    it('ON: hero shows today N=3 and the carried sub-line k=3 (drawn from today\'s pending), never yesterday\'s "5"', async () => {
        const renderLogView = await loadRenderLogView(true);
        // Yesterday had 5 pending; 2 have since been closed, 3 genuinely remain.
        // Old code showed a standalone "काल 5 …" from yesterdayDayState; new code
        // derives the carried element from TODAY's pending subset ⇒ shows 3.
        const plannedTasks: PlannedTask[] = [
            makeTask('t1', daysAgoKey(1), 'pending'),
            makeTask('t2', daysAgoKey(2), 'pending'),
            makeTask('t3', daysAgoKey(1), 'in_progress'),
            makeTask('t4', daysAgoKey(2), 'done'),
            makeTask('t5', daysAgoKey(1), 'done'),
        ];
        const ctx = makeCtx({
            plannedTasks,
            todayDayState: {
                closurePercent: 40, isClosed: false,
                completedCount: 2, plannedCount: 3, pendingCount: 3, unverifiedCount: 0,
            },
            // "Yesterday had 5 pending" — proves the hero does NOT surface this number.
            yesterdayDayState: {
                closurePercent: 0, isClosed: false,
                completedCount: 0, plannedCount: 5, pendingCount: 5, unverifiedCount: 0,
            },
        } as unknown as Partial<AppRouterContext>);
        render(<>{renderLogView(ctx)}</>);

        const heroLine = screen.getByTestId('daily-loop-hero-line');
        const carried = screen.getByTestId('daily-loop-hero-carried');
        // Today's number N = 3.
        expect(heroLine).toHaveTextContent('3');
        // Carried qualifier k = 3, drawn from the SAME pending set (k <= N).
        expect(carried).toHaveTextContent('3');
        // Crucially: the divergent standalone "5" never appears in the carried line.
        expect(carried).not.toHaveTextContent('5');
    });

    it('ON: a SINGLE carried task names itself (no bare count), staying within N', async () => {
        const renderLogView = await loadRenderLogView(true);
        const plannedTasks: PlannedTask[] = [makeTask('solo', daysAgoKey(1), 'pending')];
        const ctx = makeCtx({
            plannedTasks,
            todayDayState: {
                closurePercent: 20, isClosed: false,
                completedCount: 0, plannedCount: 1, pendingCount: 1, unverifiedCount: 0,
            },
        } as unknown as Partial<AppRouterContext>);
        render(<>{renderLogView(ctx)}</>);

        // The carried sub-line renders (names the one task via the "…One" key).
        const carried = screen.getByTestId('daily-loop-hero-carried');
        expect(carried).toHaveTextContent('dfes.dailyLoopCarriedOne');
        // Single carried task ⇒ no "(यातील k …)" many-count form.
        expect(carried).not.toHaveTextContent('dfes.dailyLoopCarriedMany');
    });
});

// ---- loop v1 Task 5: processing-screen gate ----
//
// While `status === 'processing'` the loop swaps the legacy English spinner
// ("Your Shram sathi is trying to understand…") for the founder-approved
// श्रम साथी video-character screen (ShramSathiUnderstanding). Flag OFF must
// keep the exact legacy spinner (byte-equivalent no-op). We assert on the
// brand title (श्रम साथी) vs the spinner's English heading.
describe('renderLogView — Daily Clarity Loop v1 processing screen gate', () => {
    const SPINNER_HEADING = /Your Shram sathi is trying to understand/;
    const BRAND = 'श्रम साथी';

    it('OFF: the legacy spinner shows and ShramSathiUnderstanding is absent', async () => {
        const renderLogView = await loadRenderLogView(false);
        render(<>{renderLogView(makeCtx({ status: 'processing' }))}</>);
        expect(screen.getByText(SPINNER_HEADING)).toBeInTheDocument();
        expect(screen.queryByText(BRAND)).toBeNull();
    });

    it('ON: ShramSathiUnderstanding shows (brand श्रम साथी) and the legacy spinner is gone', async () => {
        const renderLogView = await loadRenderLogView(true);
        render(<>{renderLogView(makeCtx({ status: 'processing' }))}</>);
        expect(screen.getByText(BRAND)).toBeInTheDocument();
        expect(screen.queryByText(SPINNER_HEADING)).toBeNull();
    });
});
