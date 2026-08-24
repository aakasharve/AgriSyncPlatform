// spec: owner-oversight-loop
//
// Task 8 — the §5.2 auto-scroll, at the point it is actually WIRED.
//
// `homeScreenScroll.test.ts` proves the arithmetic lands the tray clear of
// the pinned record bar. This proves the other half: that `renderLogView`
// calls it, and calls it on a CROP tap only.
//
// Why "crop tap only" is a real invariant and not a preference: `CropSelector`
// fires one `onSelectionChange` for both gestures. Firing the scroll on a PLOT
// tap too would move the page under the farmer's thumb at the exact moment he
// is tapping inside the tray — the second tap of a two-tap flow landing on
// whatever slid into that spot. §P-I ("the recording path stays sacred") is
// the same instinct one step earlier.
//
// Same harness as `log-view-home-reorder.test.tsx` / `labour-log-banner.test.tsx`:
// `renderLogView` returns an UNRENDERED element tree, so walking it never
// invokes `CropSelector`'s body and nothing heavy needs mocking.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const scrollPlotTrayIntoView = vi.fn();
vi.mock('../../../shared/utils/homeScreenScroll', () => ({
    scrollPlotTrayIntoView: () => scrollPlotTrayIntoView(),
    scrollRecorderIntoView: vi.fn(),
}));

import type { AppRouterContext } from '../routeContext';
import { renderLogView } from '../mainView';
import CropSelector from '../../../features/context/components/CropSelector';

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

type SelectionChange = (crops: string[], plots: Record<string, string[]>) => void;

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
        costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0 },
        yesterdayCost: 0,
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

function selectionChangeHandlerOf(ctx: AppRouterContext): SelectionChange {
    const selector = flattenElements(renderLogView(ctx)).find((el) => el.type === CropSelector);
    expect(selector).toBeDefined();
    return (selector!.props as { onSelectionChange: SelectionChange }).onSelectionChange;
}

beforeEach(() => {
    scrollPlotTrayIntoView.mockClear();
});

describe('renderLogView — plot-tray auto-scroll (Task 8, §5.2)', () => {
    it('selecting_a_crop_scrolls_the_plot_tray_into_view', () => {
        const ctx = makeLogViewCtx();

        selectionChangeHandlerOf(ctx)(['crop-grapes'], { 'crop-grapes': [] });

        expect(scrollPlotTrayIntoView).toHaveBeenCalledTimes(1);
    });

    it('deselecting_a_crop_also_settles_the_page_on_whatever_tray_is_left', () => {
        const ctx = makeLogViewCtx({
            logScope: {
                selectedCropIds: ['crop-grapes', 'crop-sugarcane'],
                selectedPlotIds: [],
                mode: 'single',
                applyPolicy: 'broadcast',
            },
        } as Partial<AppRouterContext>);

        selectionChangeHandlerOf(ctx)(['crop-grapes'], { 'crop-grapes': [] });

        expect(scrollPlotTrayIntoView).toHaveBeenCalledTimes(1);
    });

    it('tapping_a_plot_inside_the_tray_never_moves_the_page', () => {
        // THE invariant. The crop set is identical before and after — only
        // the plot selection changed — so nothing scrolls. Without this the
        // page slides while the farmer's finger is already in the tray.
        const ctx = makeLogViewCtx({
            logScope: {
                selectedCropIds: ['crop-grapes'],
                selectedPlotIds: [],
                mode: 'single',
                applyPolicy: 'broadcast',
            },
        } as Partial<AppRouterContext>);

        selectionChangeHandlerOf(ctx)(['crop-grapes'], { 'crop-grapes': ['plot-a'] });

        expect(scrollPlotTrayIntoView).not.toHaveBeenCalled();
    });

    it('the_scroll_never_replaces_the_scope_write_it_follows', () => {
        // The auto-scroll is BEHAVIOUR added beside the existing selection
        // handling, never in place of it (spec §8: `CropSelector` is not
        // being redesigned, and DoD #9 pins its output). Proven by the
        // scope write and the voice-mode switch still happening on the same
        // tap that scrolls.
        const setLogScope = vi.fn();
        const setMode = vi.fn();
        const ctx = makeLogViewCtx({ setLogScope, setMode } as Partial<AppRouterContext>);

        selectionChangeHandlerOf(ctx)(['crop-grapes'], { 'crop-grapes': ['plot-a'] });

        expect(setLogScope).toHaveBeenCalledWith({
            selectedCropIds: ['crop-grapes'],
            selectedPlotIds: ['plot-a'],
            mode: 'single',
            applyPolicy: 'broadcast',
        });
        expect(setMode).toHaveBeenCalledWith('voice');
        expect(scrollPlotTrayIntoView).toHaveBeenCalledTimes(1);
    });

    it('the_recorder_carries_the_id_the_pinned_record_bar_scrolls_to', () => {
        // The record bar's only action is `scrollRecorderIntoView()`, which
        // looks the recorder up by `#voice-recorder-container`. If that id
        // is ever dropped from `mainView`, the bar becomes a button that
        // does nothing — the exact "looks live, controls nothing" failure
        // `P5`/§P-E rule out — and no other test would notice.
        const ctx = makeLogViewCtx({ mode: 'voice' } as Partial<AppRouterContext>);
        const elements = flattenElements(renderLogView(ctx));

        const recorderContainer = elements.find(
            (el) => (el.props as { id?: string }).id === 'voice-recorder-container',
        );
        expect(recorderContainer).toBeDefined();
    });
});
