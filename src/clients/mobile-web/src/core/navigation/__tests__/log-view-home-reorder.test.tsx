// spec: owner-oversight-loop
//
// Task 7 — home-screen reorder (design doc §4.2, §5). `renderLogView`'s IDLE
// branch used to open on a large weather card, a "Daily Log" heading + owner
// chip, and a Daily Closure card (ring, "Day Closed"/"Day Not Closed", the
// black Close Day button, task counts, "Pending approvals: N") — ~380px a
// farmer had to scroll past before reaching the plot selector, the only
// question this screen exists for.
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
        costSnapshot: { today: 1200, cropSoFar: 45000, unverifiedToday: 3 },
        yesterdayCost: 900,
        setRecordingSegment: vi.fn(),
        lastSavedLogSummary: [],
        lastSavedLogIds: [],
        mockHistory: [],
        handleReset: vi.fn(),
        logIntent: null,
        setLogIntent: vi.fn(),
        lastLabourLogIds: [],
    };

    return { ...base, ...overrides } as unknown as AppRouterContext;
}

describe('renderLogView — home-screen reorder (Task 7)', () => {
    it('the_plot_selector_renders_before_any_cost_or_closure_block', () => {
        const ctx = makeLogViewCtx();
        const tree = renderLogView(ctx);
        const elements = flattenElements(tree);

        const cropSelectorContainerIdx = elements.findIndex(
            (el) => (el.props as { id?: string }).id === 'crop-selector-container',
        );
        const cropSelectorIdx = elements.findIndex((el) => el.type === CropSelector);
        const runningCostIdx = elements.findIndex(
            (el) => (el.props as { ['data-testid']?: string })['data-testid'] === 'running-cost-card',
        );

        expect(cropSelectorContainerIdx).toBeGreaterThan(-1);
        expect(cropSelectorIdx).toBeGreaterThan(-1);
        expect(runningCostIdx).toBeGreaterThan(-1);

        // The plot selector (both its wrapper and the CropSelector element
        // itself) renders strictly before the Running Cost card — spec §5's
        // locked order: "1. Header ... 2. The plot selector ... 3. Running
        // cost / day progress — ambient, below".
        expect(cropSelectorContainerIdx).toBeLessThan(runningCostIdx);
        expect(cropSelectorIdx).toBeLessThan(runningCostIdx);
    });

    it('the_daily_closure_card_is_gone_from_the_log_view', () => {
        const ctx = makeLogViewCtx();
        const tree = renderLogView(ctx);
        const elements = flattenElements(tree);
        const allText = collectLiteralText(tree).join(' | ');

        // The owner chip + "Daily Log" heading — redundant now the header
        // shows the owner (spec §4.2).
        expect(elements.some((el) => (el.props as { ['data-testid']?: string })['data-testid'] === 'home-greeting')).toBe(false);
        expect(allText).not.toContain('Daily Log');
        expect(allText).not.toContain('Owner:');

        // The Daily Closure card itself — ring, state line, Close Day
        // button, task counts, pending-approvals line, and the
        // yesterday-not-closed block. All moved to the oversight drawer.
        expect(allText).not.toContain('Daily Closure');
        expect(allText).not.toContain('Day Closed');
        expect(allText).not.toContain('Day Not Closed');
        expect(allText).not.toContain('Close Day');
        expect(allText).not.toContain('Pending approvals');
        expect(allText).not.toContain('Yesterday not fully closed');
        expect(allText).not.toContain('Close Yesterday');

        // The Running Cost card's "unreliable" line — spec §4.2: removed
        // entirely (not moved), because the same fact already lives in the
        // drawer and a third copy is what this reorder exists to remove.
        expect(allText).not.toContain('Cost may be inaccurate');

        // Running Cost's ambient numbers are NOT gone — they moved below the
        // selector (proven by the ordering test above); this test only
        // proves the closure/heading content, which really is deleted.
        expect(allText).toContain('Running Cost');
    });

    it('no_longer_renders_CompactWeatherChip — Task 11 moved it into AppHeader row 1, never rendered twice', () => {
        // Founder header restructure (task-11 brief): "The weather chip
        // moves into row 1 [of AppHeader] ... It must be removed from
        // mainView.tsx so it is not rendered twice." Even with real weather
        // props present on ctx (proving this isn't just "no props, so
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

        // The plot selector is still reachable and still real — this test
        // proves REMOVAL, not breakage of the rest of the idle view.
        const cropSelectorIdx = elements.findIndex((el) => el.type === CropSelector);
        expect(cropSelectorIdx).toBeGreaterThan(-1);
    });
});
