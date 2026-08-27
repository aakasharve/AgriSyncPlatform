// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11 (wave-1.7)
//
// "Hide the dead ends while nothing is waiting." For a solo farmer with an
// empty review queue, mainView must not offer a route into an empty
// ReviewInboxSheet. Originally covered 3 of the brief's 4 entry points, all
// of which lived in mainView.tsx (the 4th, the auto-open nudge, was covered
// in useNudgeRouteEffect.test.tsx):
//   - "Pending approvals: {count}"
//   - "Verify now" in the Close-Day summary
//   - "Verify now" in the Close-Yesterday summary
//   - "Verify now" in the Running Cost card
//
// EMPIRICAL FINDING (Step 1/2, recorded before any code change):
// The first three sites gated on todayDayState.unverifiedCount /
// yesterdayDayState.unverifiedCount, which (post Waves 1.1-1.4, LogFactory
// auto-approves the owner's own log) genuinely reaches zero for a solo
// farmer — those three were ALREADY correct. The Running Cost site gated on
// a DIFFERENT signal, costSnapshot.unverifiedToday — sourced from
// useAppRouterDerivations.ts's financeSelectors.getBreakdown, whose
// trustStatus is 'Unverified' unless a cost entry has been manually
// CORRECTED (financeService.ts, `entry.isCorrected ? 'Adjusted' :
// 'Unverified'`) — nothing to do with log/operator verification. So for an
// ordinary solo-farmer day with real expenses and zero mukadam activity,
// costSnapshot.unverifiedToday stayed > 0 even though there was genuinely
// nothing to review — the exact dead end the brief describes.
//
// ======================================================================
// SUPERSEDED BY `main`'s owner-oversight-loop — REWRITTEN IN THE MERGE.
// ======================================================================
//
// dfes hid these four sites CONDITIONALLY, while nothing was waiting.
// `main` went further and removed all four from the log view outright
// (`0e4ad118`, "feat(home-screen): move the plot selector above closure and
// cost", spec: owner-oversight-loop §4.2): the Daily Closure card, the
// yesterday-not-closed block and the "Cost may be inaccurate" line are gone
// from mainView, and what they said now reaches the owner as rows in the
// oversight drawer instead. The dfes brief's goal is therefore met
// unconditionally rather than by a gate.
//
// The consequence for THIS FILE is that its first test — "empty queue: none
// of them render" — now passes because the sites do not exist at all, which
// makes it true but no longer discriminating. So the second test is inverted
// rather than deleted: it feeds a genuinely pending mukadam log, the input
// that used to make all three appear, and asserts they STILL do not. That is
// the assertion that fails if anyone re-adds a dead end to the log view, and
// it is the only version of this file's question that is still live here.
//
// The other half of the original test — that a genuinely pending log DOES
// reach the owner — has NOT been dropped, it moved with the behaviour:
//   - oversightSelectors.ts emits `{ kind: 'approval', count }` only when
//     `unverifiedCount > 0`            -> oversightSelectors.test.ts
//   - WaitingDrawer renders that row with its count and no row at zero
//                                      -> WaitingDrawer.test.tsx
//   - tapping it becomes requestOpenReviewInbox()
//                                      -> AppHeader.oversight.test.tsx
//   - AppRouter hears it and opens ReviewInboxSheet
//                                      -> AppRouter.reviewInboxRequest.test.tsx
//
// `log-view-home-reorder.test.tsx` also asserts the removal, from the
// element tree rather than the DOM. This file is kept alongside it because
// it comes at the same question from the farmer's side — a rendered screen
// with a real pending count in the context — and because it is the record of
// what wave-1.7 asked for and how it was answered.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

describe('renderLogView — the log view offers no route into the review inbox, waiting or not', () => {
    it('empty review queue: no "Pending approvals", no "Verify now" (Close-Day/Close-Yesterday), and no Running Cost warning', async () => {
        const renderLogView = await loadRenderLogView();
        const ctx = makeCtx({
            // `showCloseDaySummary` / `showCloseYesterdaySummary` were REMOVED from
            // AppRouterContext (routeContext.ts FINDING F3): their only readers went
            // with the Daily Closure card when owner-oversight-loop moved it into the
            // waiting drawer, so setting them here was a write to nothing.
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

    // INVERTED IN THE MERGE. Was: "a genuinely pending mukadam log: all three
    // sites render and route to the review inbox" — it asserted
    // 'Pending approvals: 1', two 'Verify now' buttons, the
    // "Cost may be inaccurate" line, and that clicking one called
    // setShowReviewInbox(true).
    //
    // All four are gone from the log view by `0e4ad118`, deliberately, and
    // `setShowReviewInbox` went with them (finding F3 removed it from
    // AppRouterContext). The input is kept EXACTLY as it was — a real pending
    // count on both days, plus the finance signal — because that is what makes
    // this test discriminating: the previous test proves nothing renders when
    // nothing is waiting, and only this one proves nothing renders when
    // something IS. Without it, re-adding a count-gated dead end to the log
    // view would pass the whole file.
    it('a genuinely pending mukadam log: STILL none of them render — the log view is not where approvals live', async () => {
        const renderLogView = await loadRenderLogView();
        const setShowReviewInbox = vi.fn();
        const ctx = makeCtx({
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

        expect(screen.queryByText(/Pending approvals/)).toBeNull();
        expect(screen.queryAllByText('Verify now')).toHaveLength(0);
        expect(screen.queryByText(/Cost may be inaccurate/)).toBeNull();
        // Nothing on this screen can reach the review inbox any more. The
        // route in is the drawer's approval row (see this file's header for
        // the four tests that cover that path end to end).
        expect(setShowReviewInbox).not.toHaveBeenCalled();

        // ...but the log view did NOT go blank. Running Cost stayed; §4.2
        // moved it below the plot selector as ambient status rather than
        // deleting it. Asserted so "nothing renders" cannot be satisfied by a
        // render that failed outright.
        expect(screen.getByText(/Running Cost/)).toBeInTheDocument();
    });
});
