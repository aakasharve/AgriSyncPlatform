// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11 (wave-1.7)
//
// "Hide the dead ends while nothing is waiting." For a solo farmer with an
// empty review queue, mainView must not offer a route into an empty
// ReviewInboxSheet. Covers 3 of the brief's 4 entry points that live in
// mainView.tsx (the 4th, the auto-open nudge, is covered in
// useNudgeRouteEffect.test.tsx):
//   - mainView.tsx:270-274  "Pending approvals: {count}"
//   - mainView.tsx:284-289  "Verify now" in the Close-Day summary
//   - mainView.tsx:325-330  "Verify now" in the Close-Yesterday summary
//   - mainView.tsx:354-359  "Verify now" in the Running Cost card
//
// EMPIRICAL FINDING (Step 1/2, recorded before any code change):
// The first three sites gate on todayDayState.unverifiedCount /
// yesterdayDayState.unverifiedCount, which (post Waves 1.1-1.4, LogFactory
// auto-approves the owner's own log) genuinely reaches zero for a solo
// farmer — those three were ALREADY correct. The Running Cost site
// (mainView.tsx:353) gates on a DIFFERENT signal, costSnapshot.unverifiedToday
// — sourced from useAppRouterDerivations.ts's financeSelectors.getBreakdown,
// whose trustStatus is 'Unverified' unless a cost entry has been manually
// CORRECTED (financeService.ts:158, `entry.isCorrected ? 'Adjusted' :
// 'Unverified'`) — nothing to do with log/operator verification. So for an
// ordinary solo-farmer day with real expenses and zero mukadam activity,
// costSnapshot.unverifiedToday stays > 0 even though there is genuinely
// nothing to review — the exact dead end the brief describes. The
// "empty review queue, non-zero costSnapshot.unverifiedToday" case below is
// the real, reproducible scenario, not a synthetic edge case.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
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
        LedgerRecognitionPanel: () => null,
    }));
    vi.doMock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));

    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => k }),
    }));

    // dailyLoop OFF — irrelevant to the 3 sites under test (none are gated by
    // it) and keeps this test isolated from the Daily Clarity Loop surface.
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
        todayDayState: {
            closurePercent: 100, isClosed: true, hasStarted: true,
            completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0,
        },
        yesterdayDayState: {
            closurePercent: 100, isClosed: true, hasStarted: true,
            completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0,
        },
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

describe('renderLogView — review-inbox dead ends stay hidden while nothing is waiting', () => {
    it('empty review queue: no "Pending approvals", no "Verify now" (Close-Day/Close-Yesterday), and no Running Cost warning', async () => {
        const renderLogView = await loadRenderLogView();
        const ctx = makeCtx({
            showCloseDaySummary: true,
            showCloseYesterdaySummary: true,
            // hasStarted true: the farmer DID record his day (that is why closure
            // reads 100) — the point under test is that nothing is awaiting
            // review, not that the day is empty.
            todayDayState: {
                closurePercent: 100, isClosed: true, hasStarted: true,
                completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0,
            },
            yesterdayDayState: {
                closurePercent: 100, isClosed: true, hasStarted: true,
                completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0,
            },
            // The real-world reproduction: an ordinary day with recorded
            // expenses (finance trustStatus 'Unverified' until manually
            // corrected) but NOTHING actually awaiting review.
            costSnapshot: { today: 500, cropSoFar: 5000, unverifiedToday: 4 },
        });
        render(<>{renderLogView(ctx)}</>);

        expect(screen.queryByText(/Pending approvals/)).toBeNull();
        expect(screen.queryAllByText('Verify now')).toHaveLength(0);
        // The defect this task fixed: the Running Cost card used to gate on
        // costSnapshot.unverifiedToday ALONE — a finance trust-status that is
        // 'Unverified' for any uncorrected entry — so this text rendered on an
        // ordinary solo-farmer day with nothing whatsoever awaiting review.
        // mainView.tsx now also requires todayDayState.unverifiedCount > 0.
        expect(screen.queryByText(/Cost may be inaccurate/)).toBeNull();
    });

    it('a genuinely pending mukadam log: all three sites render and route to the review inbox', async () => {
        const renderLogView = await loadRenderLogView();
        const setShowReviewInbox = vi.fn();
        const ctx = makeCtx({
            showCloseDaySummary: true,
            showCloseYesterdaySummary: true,
            setShowReviewInbox,
            todayDayState: {
                closurePercent: 70, isClosed: false, hasStarted: true,
                completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 1,
            },
            yesterdayDayState: {
                closurePercent: 70, isClosed: false, hasStarted: true,
                completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 1,
            },
            costSnapshot: { today: 500, cropSoFar: 5000, unverifiedToday: 1 },
        });
        render(<>{renderLogView(ctx)}</>);

        expect(screen.getByText('Pending approvals: 1')).toBeInTheDocument();
        // Close-Day summary + Close-Yesterday summary "Verify now" buttons.
        const verifyButtons = screen.getAllByText('Verify now');
        expect(verifyButtons).toHaveLength(2);
        expect(screen.getByText(/Cost may be inaccurate - 1 entries unverified\. Verify now\./)).toBeInTheDocument();

        fireEvent.click(verifyButtons[0]);
        expect(setShowReviewInbox).toHaveBeenCalledWith(true);
    });
});
