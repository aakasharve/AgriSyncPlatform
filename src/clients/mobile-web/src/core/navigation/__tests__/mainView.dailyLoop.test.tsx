// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11
//
// renderLogView — Daily Clarity Loop v1 feature gate.
//
// Proves the loop's home-view contract:
//   • dailyLoop OFF → no hero.
//   • dailyLoop ON  → the "आज N कामं बाकी" hero renders at the top.
//
// The heavy home children (weather, crop selector, recorders, ledger, etc.) are
// stubbed so the test isolates the gate + the (real) DailyLoopHero. featureFlags
// is mocked to force the loop flag either way. Mirrors the mock-then-dynamic-
// import pattern established in AppRouter.feature-gate.test.tsx.
//
// ======================================================================
// THE "OFF" HALF OF THIS FILE WAS SUPERSEDED BY `main` AND IS REWRITTEN.
// Rewritten in the main -> feat/dfes-companion merge; assertions changed,
// scenarios and intent kept. Every change is annotated at its own test.
// ======================================================================
//
// dfes's OFF cases were written as byte-equivalent-no-op guards: with the
// flag off, home must still show exactly what it showed before the loop —
// the Daily Closure card's ring and state label, the buried English
// "Tasks: Done N / Planned M" line, and the "Yesterday not fully closed"
// banner. That premise held on `feat/dfes-companion`. It does not hold now.
//
// `main`'s owner-oversight-loop deleted that entire surface from the log
// view (`0e4ad118`, spec: owner-oversight-loop §4.2 — "Removes the Daily
// Closure card, the yesterday-not-closed block and the 'Daily Log' heading
// ... their content already lives in the oversight drawer / header"). So
// "OFF renders the legacy card" is not a claim about a feature flag any
// more; the card is gone in BOTH flag states.
//
// WHY THAT DOES NOT COST THIS FILE ITS POINT. The loop's actual contract is
// the interesting half and it is untouched: OFF must not render the hero, ON
// must, and ON must not produce a DUPLICATE of anything. The duplicate risk
// is what most of the OFF cases were really about — and it is now stronger,
// not weaker, because the thing the hero could have duplicated no longer
// exists. Each OFF case below therefore keeps its scenario and asserts the
// live outcome, with the superseded assertion named in place.
//
// WHERE THE DELETED SIGNALS WENT (none is unasserted; none is lost):
//   "Yesterday not fully closed"
//     -> appContentOversightInputs.ts computes
//        `yesterdayNotClosed = yesterday.hasStarted && !yesterday.isClosed`
//        — the same predicate, including the brand-new-farmer case where
//        `hasStarted` is false and nothing is raised
//        (appContentOversightInputs.test.ts), surfacing as the drawer's
//        `dayNotClosed` decision row (AppHeader.oversight.test.tsx).
//   ring / "Day Not Closed" / task counts / "Pending approvals"
//     -> the oversight drawer (WaitingDrawer.test.tsx), and their absence
//        from the log view is asserted in log-view-home-reorder.test.tsx.
//
// ONE THING GENUINELY HAS NO SURFACE ANY MORE, AND IT IS SAID HERE RATHER
// THAN QUIETLY DROPPED: wave-2.4's honest brand-new-farmer treatment on the
// OFF path — the "—" ring, the "Day Not Started" label and "Nothing recorded
// yet today." — went with the card. Nothing renders those strings now
// (grep: zero non-test hits). The DEFECT wave 2.4 existed to fix is fixed,
// and fixed more completely: a farmer on day one is no longer shown "0%" or
// "Day Not Closed" on the log view, because he is shown no closure surface
// at all. What is not replaced is the positive, encouraging third state. On
// the ON path the hero still carries it, and that case below is unchanged
// and still passing.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AppRouterContext } from '../routeContext';
import { getDateKey } from '../../domain/services/DateKeyService';
import { computeDayState } from '../../../shared/utils/dayState';

const stub = (label: string) => ({
    default: () => React.createElement('div', { 'data-stub': label }),
});

// Real "today" (IST) and helpers to make genuinely-carried past due-dates, so
// getCarriedTasks (NOT mocked — runs for real) treats them as overdue.
const TODAY_KEY = getDateKey();

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
        // 6 planned, 1 done — this day has plainly begun. The brand-new-farmer
        // (hasStarted: false) case has its own describe block at the bottom.
        hasStarted: true,
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
    // SUPERSEDED HALF: this asserted `getByText('Yesterday not fully closed')`
    // — the banner was the proof that OFF left home untouched. `0e4ad118`
    // deleted the banner from the log view in both flag states, so the
    // assertion is inverted. The flag-gate half (no hero when OFF) is the
    // original and is unchanged. The context still carries an unclosed
    // yesterday (`makeCtx`'s default), so this is the input that used to
    // raise the banner, not a case that avoids the question.
    it('OFF: no hero — and no yesterday banner either, in either flag state now', async () => {
        const renderLogView = await loadRenderLogView(false);
        render(<>{renderLogView(makeCtx())}</>);
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
        expect(screen.queryByText('Yesterday not fully closed')).toBeNull();
    });

    // FOUNDER RULING 2026-08-29 — this used to assert the hero RENDERS when the
    // flag is ON. `DailyLoopHero` is deleted, so the flag no longer has a hero to
    // gate and both states agree. Kept, inverted, rather than dropped: a re-added
    // hero is exactly the duplicate opener he has now had removed twice.
    it('ON: still no hero — the surface was deleted, not gated', async () => {
        const renderLogView = await loadRenderLogView(true);
        render(<>{renderLogView(makeCtx())}</>);
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
        expect(screen.queryByText('Yesterday not fully closed')).toBeNull();
    });

    // ---- Fix 2: one calm opener — hide the leftover duplicates when ON ----

    // SUPERSEDED: this asserted that BOTH the buried English
    // "Tasks: Done 1 / Planned 6" line and the card's own "40%" closure ring
    // render when the flag is OFF — the "leftover duplicates" Fix 2 existed
    // to hide when it was ON. Both belonged to the Daily Closure card, which
    // `0e4ad118` removed, so there are no leftovers to hide in either state.
    //
    // The context is unchanged (completedCount 1, plannedCount 6,
    // closurePercent 40) — the exact numbers that used to produce both — so
    // this now pins that the log view renders NO closure surface of its own.
    // That is what makes the ON case below meaningful: its "exactly one 40%"
    // can only be the hero's.
    it('OFF: neither the buried English "Tasks: Done/Planned" line nor any closure ring renders', async () => {
        const renderLogView = await loadRenderLogView(false);
        render(<>{renderLogView(makeCtx())}</>);
        expect(screen.queryByText(/Tasks: Done/)).toBeNull();
        // No hero and no card → the log view shows no closure percentage at all.
        expect(screen.queryAllByText('40%')).toHaveLength(0);
    });

    it('ON: no closure ring survives either — the hero that owned it is gone', async () => {
        const renderLogView = await loadRenderLogView(true);
        render(<>{renderLogView(makeCtx())}</>);
        expect(screen.queryByText(/Tasks: Done/)).toBeNull();
        // Was `toHaveLength(1)` — the hero's ring. That ring moved to the
        // oversight strip (carrying the strip's OWN waiting count, not this
        // closure percent) on 2026-08-27, and the hero itself went on
        // 2026-08-29. The log view now states no closure percentage at all.
        expect(screen.queryAllByText('40%')).toHaveLength(0);
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
    // SUPERSEDED STRING, NOT A SUPERSEDED SURFACE. The legacy spinner is
    // still there and still gated exactly as dfes left it — `mainView.tsx`
    // renders it whenever `status === 'processing'` and `dailyLoop` is OFF.
    // What changed is its heading: `main` moved the hardcoded English
    // "Your Shram sathi is trying to understand…" into the i18n table as
    // `shramSathi.understanding` (`mainViewComponents.tsx`;
    // `i18n/syncTranslations.ts` — mr 'मी आजचं काम समजून घेतोय…',
    // en 'Shram Sathi is understanding today's work…').
    //
    // `useLanguage` is mocked here with `t: (k) => k`, so the KEY is what
    // renders and the key is what this asserts. Pinning the key rather than
    // either translation is deliberate: this test is about which screen the
    // flag selects, and copy is ruled on elsewhere. The Marathi and English
    // values have their own coverage in the i18n suite.
    const SPINNER_HEADING_KEY = 'shramSathi.understanding';
    const BRAND = 'श्रम साथी';

    it('OFF: the legacy spinner shows and ShramSathiUnderstanding is absent', async () => {
        const renderLogView = await loadRenderLogView(false);
        render(<>{renderLogView(makeCtx({ status: 'processing' }))}</>);
        expect(screen.getByText(SPINNER_HEADING_KEY)).toBeInTheDocument();
        expect(screen.queryByText(BRAND)).toBeNull();
    });

    it('ON: ShramSathiUnderstanding shows (brand श्रम साथी) and the legacy spinner is gone', async () => {
        const renderLogView = await loadRenderLogView(true);
        render(<>{renderLogView(makeCtx({ status: 'processing' }))}</>);
        expect(screen.getByText(BRAND)).toBeInTheDocument();
        expect(screen.queryByText(SPINNER_HEADING_KEY)).toBeNull();
    });
});

// ---- wave-2.4 follow-up: day 1 of the pilot, BOTH flag states ----------------
//
// spec: dfes-companion-2026-07-11 (wave-2.4)
//
// The farmer this covers has no schedule template, no planned tasks and has not
// yet spoken to the app — the literal first morning of the pilot. Wave 2.4 gave
// that day the honest treatment inside DailyLoopHero only, and `dailyLoop`
// defaults OFF (featureFlags.ts), so the path PRODUCTION renders was left
// printing "0%" and "Day Not Closed" at him, and firing "Yesterday not fully
// closed" about a yesterday on which nothing was ever planned or recorded.
//
// The day-state here is not hand-written: it is what the real `computeDayState`
// returns for that farmer, so these tests fail if either the fact or its
// rendering regresses.
//
// SUPERSEDED ON THE OFF PATH — see this file's header for the full note.
// `main`'s `0e4ad118` removed the whole closure surface from the log view, so
// the defect wave 2.4 was fixing ("0%" and "Day Not Closed" at a farmer on day
// one) can no longer occur there in either flag state. The OFF cases below
// keep wave 2.4's exact scenario and assert that outcome directly. The ON case
// is where the honest third state still lives and is substantively unchanged.
describe('renderLogView — a brand-new farmer with no schedule (both flag states)', () => {
    /** No crops, no schedule, no tasks, no logs — literally nothing has happened. */
    const emptyDay = computeDayState({ logs: [], crops: [], tasks: [], date: TODAY_KEY });

    it('computeDayState reports the day as NOT STARTED (not 0%-and-failing, not closed)', () => {
        expect(emptyDay.hasStarted).toBe(false);
        expect(emptyDay.closurePercent).toBe(0);
        expect(emptyDay.isClosed).toBe(false);
    });

    // SUPERSEDED: this asserted the positive wave-2.4 treatment on the OFF
    // path — `daily-closure-ring` showing "—", `daily-closure-label` reading
    // "Day Not Started", and "Nothing recorded yet today." in the Close-Day
    // summary. All three test-ids and strings left the codebase with the
    // Daily Closure card (`0e4ad118`); grep finds zero non-test occurrences.
    //
    // What wave 2.4 was DEFENDING him from is what survives as an assertion,
    // and it is the part that mattered: on his first morning this screen must
    // not put a failing grade in front of him. It cannot now, because it
    // renders no closure verdict at all. Every string wave 2.4 named as the
    // harm is pinned absent below.
    it('OFF (production today): day one shows him no closure verdict at all — no 0%, no "Day Not Closed"', async () => {
        const renderLogView = await loadRenderLogView(false);
        const ctx = makeCtx({
            showCloseDaySummary: true,
            todayDayState: emptyDay,
            yesterdayDayState: emptyDay,
        } as unknown as Partial<AppRouterContext>);
        render(<>{renderLogView(ctx)}</>);

        // The harm wave 2.4 named, in its own words: "0%" beside a farmer who
        // has done nothing wrong reads as a failing grade on a day that has
        // not begun. It is not on this screen.
        expect(screen.queryByText('0%')).toBeNull();
        expect(screen.queryByText('Day Not Closed')).toBeNull();
        expect(screen.queryByText(/Day closure pending/)).toBeNull();

        // ...and neither is the surface that used to carry them.
        expect(screen.queryByTestId('daily-closure-ring')).toBeNull();
        expect(screen.queryByTestId('daily-closure-label')).toBeNull();

        // Yesterday never started either — there is no leftover to chase.
        expect(screen.queryByText('Yesterday not fully closed')).toBeNull();

        // The screen did render — this is an assertion about what is absent
        // from a working log view, not about a render that fell over.
        expect(screen.getByText(/Running Cost/)).toBeInTheDocument();
    });

    // SUPERSEDED: this was wave 2.4's discriminating case — proof that
    // silencing the banner for a never-started yesterday had NOT silenced it
    // for a real one. The banner is gone from the log view, so the log view
    // can no longer answer that question; the predicate moved intact to
    // `appContentOversightInputs.ts` as
    // `yesterdayNotClosed = yesterday.hasStarted && !yesterday.isClosed`,
    // which is the same distinction, and both sides of it are asserted in
    // `appContentOversightInputs.test.ts` (a started-and-unclosed yesterday
    // -> true; a never-started one -> false), reaching the owner as the
    // drawer's `dayNotClosed` row (`AppHeader.oversight.test.tsx`).
    //
    // Kept here, with its input untouched, as the log view's half: a yesterday
    // with genuinely open work must not resurrect the banner on this screen
    // either. That is the assertion that would fail if the card came back.
    it('OFF: a yesterday that GENUINELY has open work does not raise the banner here — it raises the drawer row', async () => {
        const renderLogView = await loadRenderLogView(false);
        const ctx = makeCtx({
            todayDayState: emptyDay,
            yesterdayDayState: {
                closurePercent: 40, isClosed: false, hasStarted: true,
                completedCount: 1, plannedCount: 3, pendingCount: 2, unverifiedCount: 0,
            },
        } as unknown as Partial<AppRouterContext>);
        render(<>{renderLogView(ctx)}</>);

        expect(screen.queryByText('Yesterday not fully closed')).toBeNull();
        expect(screen.queryByText('Close Yesterday')).toBeNull();
        expect(screen.getByText(/Running Cost/)).toBeInTheDocument();
    });

    it('ON: an empty day raises no closure verdict and no yesterday banner', async () => {
        const renderLogView = await loadRenderLogView(true);
        const ctx = makeCtx({
            todayDayState: emptyDay,
            yesterdayDayState: emptyDay,
        } as unknown as Partial<AppRouterContext>);
        render(<>{renderLogView(ctx)}</>);

        // The dash-ring and the 'dayFree' invite were the HERO's, and it is gone
        // (founder ruling 2026-08-29). What must still hold is the property those
        // assertions were protecting: day one shows him no verdict he did not earn.
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
        expect(screen.queryByText('0%')).toBeNull();
        expect(screen.queryByTestId('daily-closure-label')).toBeNull();
        expect(screen.queryByText('Day Not Closed')).toBeNull();
        expect(screen.queryByText('Yesterday not fully closed')).toBeNull();
    });
});
