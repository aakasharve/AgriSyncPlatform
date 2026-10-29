// spec: owner-oversight-loop
//
// Task 7 — home-screen reorder (design doc §4.2, §5). `renderLogView`'s IDLE
// branch used to open on a large weather card, a "Daily Log" heading + owner
// chip, and a Daily Closure card (ring, "Day Closed"/"Day Not Closed", the
// black Close Day button, task counts, "Pending approvals: N") — ~380px a
// farmer had to scroll past before reaching the plot selector, the only
// question this screen exists for.
//
// ======================================================================
// SUPERSEDED BY plr-d10 I12 (founder-approved redesign, PLR-D5/D6/D9 §6) — REWRITTEN.
// ======================================================================
// Task 7's locked order was "plot selector first, running cost below it". The founder's approved
// आजची कामे tab replaces that screen: it now OPENS ON A WORK HOME (the "झालेले काम सांगा" door, the
// "आजची हजेरी" door for owner/labour grant, and the running-cost card re-homed below them), and the
// crop -> plots -> mic steps sit behind the first door (`LogEntryFlow`). So "selector before cost"
// is no longer a property of this screen; what Task 7 was PROTECTING still is, and is asserted below:
// the Daily Closure surface stays gone, the weather chip stays in the header, the running cost is
// still on the tab (now as the flow's `cost`, rendered on the home), nothing dropped.
//
// Following the pattern `labour-log-banner.test.tsx` established: `renderLogView`
// is a plain function returning an (unrendered) React element tree. Walking
// `.props.children` never invokes any component's function body, so heavy
// children (CropSelector, InputMethodToggle, CompactWeatherChip's own
// WeatherWidget, ManualEntry, ...) stay inert and need no mocking.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import { renderLogView } from '../mainView';
import CompactWeatherChip from '../../../features/oversight/components/CompactWeatherChip';
import CropSelector from '../../../features/context/components/CropSelector';
import SathiGuideCard from '../../../features/oversight/components/SathiGuideCard';
import HelpBar from '../../../features/oversight/components/HelpBar';
import InputMethodToggle from '../../../shared/components/ui/InputMethodToggle';
import ManualEntry from '../../../features/logs/components/ManualEntry';
import SavedScreenBack from '../../../features/logs/components/shramsathi/SavedScreenBack';
import { LogEntryFlow, type LogEntryFlowProps } from '../../../features/logs/components/entry/LogEntryFlow';
import { ReviewBackBar } from '../../../features/logs/components/entry/ReviewBackBar';

/**
 * Pre-order DFS over an unrendered element tree, collecting every element in
 * the order React would mount it — i.e. document order. Used to assert
 * relative position without a full DOM render.
 */
function flattenElements(
    node: React.ReactNode,
    acc: React.ReactElement[] = [],
): React.ReactElement[] {
    if (node === null || node === undefined || typeof node === 'boolean') return acc;
    if (Array.isArray(node)) {
        node.forEach((child) => flattenElements(child, acc));
        return acc;
    }
    if (!React.isValidElement(node)) return acc;
    acc.push(node);
    flattenElements((node.props as { children?: React.ReactNode }).children, acc);
    return acc;
}

/**
 * Collects every plain string/number leaf anywhere in the unrendered tree —
 * i.e. every literal text a farmer would eventually see, without mounting
 * anything. Used to prove specific copy ("Close Day", "Pending approvals: N",
 * ...) is entirely absent, not merely reordered.
 */
function collectLiteralText(node: React.ReactNode, acc: string[] = []): string[] {
    if (node === null || node === undefined || typeof node === 'boolean') return acc;
    if (typeof node === 'string' || typeof node === 'number') {
        acc.push(String(node));
        return acc;
    }
    if (Array.isArray(node)) {
        node.forEach((child) => collectLiteralText(child, acc));
        return acc;
    }
    if (React.isValidElement(node)) {
        collectLiteralText((node.props as { children?: React.ReactNode }).children, acc);
    }
    return acc;
}

// Minimal-but-complete AppRouterContext for renderLogView's idle branch —
// same convention as labour-log-banner.test.tsx's makeLogViewCtx. mode:
// 'manual' + hasActiveLogContext: false selects the "Select a plot to
// continue..." leaf (skips ManualEntry/AudioRecorder entirely); status:
// 'idle' skips the processing/success blocks; recordingSegment: null skips
// the segment-recording block.
function makeLogViewCtx(overrides: Partial<AppRouterContext> = {}): AppRouterContext {
    const base = {
        currentRoute: 'main',
        mainView: 'log',
        status: 'idle',
        mode: 'manual',
        recordingSegment: null,
        weatherData: undefined,
        weatherStatus: 'loading',
        boundaryUnset: false,
        refetchWeather: vi.fn(),
        setCurrentRoute: vi.fn(),
        ownerDisplayName: 'Test Owner',
        setMainView: vi.fn(),
        crops: [],
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: vi.fn(),
        setMode: vi.fn(),
        setStatus: vi.fn(),
        hasActiveLogContext: false,
        isContextReady: false,
        error: null,
        errorTranscript: undefined,
        handleAudioReady: vi.fn(),
        handleTextReady: vi.fn(),
        handleManualSubmit: vi.fn(),
        currentLogContext: null,
        ledgerDefaults: undefined,
        farmerProfile: { operators: [] },
        draftLog: null,
        setDraftLog: vi.fn(),
        provenance: null,
        voiceStreamingPhase: 'idle',
        liveCaption: '',
        getTodayCounts: vi.fn(),
        getContextColorIndicator: () => null,
        history: [],
        todayLogs: [],
        operatorNameById: new Map(),
        getLogContextSnapshot: vi.fn(),
        handleEditLog: vi.fn(),
        costSnapshot: { today: 1200, cropSoFar: 45000, unverifiedToday: 3, scopeLabel: 'संपूर्ण शेत' },
        yesterdayCost: 900,
        setRecordingSegment: vi.fn(),
        lastSavedLogSummary: [],
        lastSavedLogIds: [],
        mockHistory: [],
        handleReset: vi.fn(),
        logIntent: null,
        setLogIntent: vi.fn(),
        lastLabourLogIds: [],
        // I12-V1-m6 — the running cost is shown only once the server has told the role (unknown stays
        // closed), so the default farmer here is the owner.
        farmRole: 'PrimaryOwner',
        // `todayDayState` is a REQUIRED AppRouterContext field. It was absent
        // here only because the blocks that read it left with the Task 7
        // reorder; the dfes-companion daily-loop hero reads it again, and
        // `.env.local` runs these tests with VITE_DAILY_LOOP=1, so an absent
        // value threw before any assertion in this file could run. Empty day —
        // the reorder assertions are about ORDER, not about counts.
        todayDayState: {
            closurePercent: 0, isClosed: false, hasStarted: false,
            completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0,
        },
        plannedTasks: [],
    };

    return { ...base, ...overrides } as unknown as AppRouterContext;
}

describe('renderLogView — the आजची कामे tab opens on the work home (plr-d10 I12, supersedes Task 7 order)', () => {
    const flowOf = (tree: React.ReactNode) =>
        flattenElements(tree).find((el) => el.type === LogEntryFlow) as React.ReactElement<LogEntryFlowProps> | undefined;

    it('the_entry_flow_replaces_the_legacy_screen — no guide card, no dead help bar, no carousel, no voice/manual toggle', () => {
        const tree = renderLogView(makeLogViewCtx());
        const elements = flattenElements(tree);
        expect(flowOf(tree)).toBeDefined();
        for (const legacy of [SathiGuideCard, HelpBar, CropSelector, InputMethodToggle]) {
            expect(elements.some((el) => el.type === legacy)).toBe(false);
        }
        const allText = collectLiteralText(tree).join(' | ');
        expect(allText).not.toContain('Select a plot to continue');
        expect(allText).not.toContain('Recording');
        expect(allText).not.toContain('Cancel & Go Back');
    });

    it('the_daily_closure_card_is_gone_from_the_log_view — and the running cost is re-homed, not dropped', () => {
        const ctx = makeLogViewCtx();
        const tree = renderLogView(ctx);
        const elements = flattenElements(tree);
        const allText = collectLiteralText(tree).join(' | ');

        // The owner chip + "Daily Log" heading — redundant now the header
        // shows the owner (spec §4.2).
        expect(elements.some((el) => (el.props as { ['data-testid']?: string })['data-testid'] === 'home-greeting')).toBe(false);
        expect(allText).not.toContain('Daily Log');
        expect(allText).not.toContain('Owner:');

        // The Daily Closure card itself — all moved to the oversight drawer.
        expect(allText).not.toContain('Daily Closure');
        expect(allText).not.toContain('Day Closed');
        expect(allText).not.toContain('Day Not Closed');
        expect(allText).not.toContain('Close Day');
        expect(allText).not.toContain('Pending approvals');
        expect(allText).not.toContain('Yesterday not fully closed');
        expect(allText).not.toContain('Close Yesterday');
        expect(allText).not.toContain('Cost may be inaccurate');

        // Running Cost's ambient numbers are NOT gone — the flow draws them on its work home.
        expect(flowOf(tree)!.props.cost).toEqual({ today: 1200, yesterday: 900, soFar: 45000, scopeLabel: 'संपूर्ण शेत' });
    });

    // PLR-D10 I20 / N7 (founder D-22, D-26): only the PRIMARY account holder (the farm's creator)
    // sees the farm's money on the home. A co-owner or family label, a मुकादम or an expert is
    // granted nothing by the label; a worker never; a role not yet known stays closed.
    it('only the primary account holder gets the running cost on the home (N7, D-26)', () => {
        expect(flowOf(renderLogView(makeLogViewCtx({ farmRole: 'PrimaryOwner' })))!.props.cost).toBeDefined();
        expect(flowOf(renderLogView(makeLogViewCtx({ farmRole: 'Worker' })))!.props.cost).toBeUndefined();
        expect(flowOf(renderLogView(makeLogViewCtx({ farmRole: null })))!.props.cost).toBeUndefined();
        expect(flowOf(renderLogView(makeLogViewCtx({ farmRole: undefined })))!.props.cost).toBeUndefined();
        expect(flowOf(renderLogView(makeLogViewCtx({ farmRole: 'Mukadam' })))!.props.cost).toBeUndefined();
        expect(flowOf(renderLogView(makeLogViewCtx({ farmRole: 'SecondaryOwner' })))!.props.cost).toBeUndefined();
        expect(flowOf(renderLogView(makeLogViewCtx({ farmRole: 'Agronomist' })))!.props.cost).toBeUndefined();
    });

    // merge-review m1 — the work home's door opens हजेरी as a PLACE over the home tabs (openPlace), so
    // its मागे lands on home, never on a hub the farmer opened in some earlier, abandoned round trip.
    it('the हजेरी door is wired only when the router says this person may manage labour, and opens हजेरी over home', () => {
        expect(flowOf(renderLogView(makeLogViewCtx({ canOpenAttendanceFromHome: false })))!.props.onOpenAttendance).toBeUndefined();
        const setCurrentRoute = vi.fn();
        const openPlace = vi.fn();
        const flow = flowOf(renderLogView(makeLogViewCtx({ canOpenAttendanceFromHome: true, setCurrentRoute, openPlace })))!;
        flow.props.onOpenAttendance!();
        expect(openPlace).toHaveBeenCalledWith('labour');
        expect(setCurrentRoute).not.toHaveBeenCalled();
    });

    it('the tab tap reaches the flow as a one-shot request it acknowledges', () => {
        const consumeLogHome = vi.fn();
        const flow = flowOf(renderLogView(makeLogViewCtx({ logHomePending: true, consumeLogHome })))!;
        expect(flow.props.homeRequested).toBe(true);
        expect(flow.props.onHomeRequestHandled).toBe(consumeLogHome);
    });

    it('the review of a parsed entry is NOT the flow: manual mode with a plot chosen still shows ManualEntry', () => {
        const tree = renderLogView(makeLogViewCtx({ mode: 'manual', hasActiveLogContext: true, isContextReady: true }));
        expect(flowOf(tree)).toBeUndefined();
        expect(flattenElements(tree).some((el) => el.type === ManualEntry)).toBe(true);
    });

    // I12-V1-M1 — the review used to be a dead end (no मागे; the tab tap ignores it; Save was the only exit).
    const backBarOf = (tree: React.ReactNode) =>
        flattenElements(tree).find((el) => el.type === ReviewBackBar) as React.ReactElement<{ onBack: () => void }> | undefined;

    it('the review has a visible way back: "मागे" ABOVE the form, one step to the mic of the SAME plots', () => {
        const setMode = vi.fn();
        const setDraftLog = vi.fn();
        const setLogScope = vi.fn();
        const tree = renderLogView(makeLogViewCtx({ mode: 'manual', hasActiveLogContext: true, isContextReady: true, setMode, setDraftLog, setLogScope }));
        const elements = flattenElements(tree);
        const bar = backBarOf(tree);
        expect(bar).toBeDefined();
        expect(elements.indexOf(bar!)).toBeLessThan(elements.findIndex((el) => el.type === ManualEntry));
        bar!.props.onBack();
        // back to the mic (voice mode) — the scope is NOT cleared, so the flow opens on that plot's mic
        expect(setMode).toHaveBeenCalledWith('voice');
        expect(setLogScope).not.toHaveBeenCalled();
        // the unsaved parse does not leak into the hand-filled form later
        expect(setDraftLog).toHaveBeenCalledWith(null);
    });

    it('the हजेरी door\'s result has the same "मागे" (logIntent labour)', () => {
        const setMode = vi.fn();
        const tree = renderLogView(makeLogViewCtx({ mode: 'manual', hasActiveLogContext: true, isContextReady: true, logIntent: 'labour', setMode }));
        backBarOf(tree)!.props.onBack();
        expect(setMode).toHaveBeenCalledWith('voice');
    });

    it('while one part is being said again, its own "रद्द करा" is the way back — no second मागे', () => {
        const tree = renderLogView(makeLogViewCtx({ mode: 'manual', hasActiveLogContext: true, isContextReady: true, recordingSegment: 'labour' }));
        expect(backBarOf(tree)).toBeUndefined();
    });

    it('after a save, "मागे" / "आणखी नोंद करा" reset the draft AND return to the mic (voice), not to an empty form', () => {
        const handleReset = vi.fn();
        const setMode = vi.fn();
        const tree = renderLogView(makeLogViewCtx({ status: 'success', handleReset, setMode }));
        const back = flattenElements(tree).find((el) => el.type === SavedScreenBack) as React.ReactElement<{ onBack: () => void }>;
        back.props.onBack();
        expect(handleReset).toHaveBeenCalledTimes(1);
        expect(setMode).toHaveBeenCalledWith('voice');
    });

    it('no_longer_renders_CompactWeatherChip — Task 11 moved it into AppHeader row 1, never rendered twice', () => {
        // Founder header restructure (task-11 brief): "The weather chip
        // moves into row 1 [of AppHeader] ... It must be removed from
        // mainView.tsx so it is not rendered twice." Even with real weather
        // props present on ctx (proving this is not just "no props, so
        // nothing to show"), `renderLogView` must not mount the chip.
        const ctx = makeLogViewCtx({
            weatherData: { locationName: 'Arve Farm' } as unknown as AppRouterContext['weatherData'],
            weatherStatus: 'ready',
            boundaryUnset: true,
        });
        const tree = renderLogView(ctx);
        const elements = flattenElements(tree);

        const chip = elements.find((el) => el.type === CompactWeatherChip);
        expect(chip).toBeUndefined();

        // The entry flow is still reachable and still real — this test
        // proves REMOVAL, not breakage of the rest of the idle view.
        expect(flowOf(tree)).toBeDefined();
    });
});
