// spec: 2026-07-13-labour-attendance-approval-design (Task 3.5)
//
// Task 3.4 shipped a small dismissible emerald strip on the log page when
// `logIntent === 'labour'`. Task 3.5 promotes it to a full banner (founder
// ask #1) and replaces the ✕ dismiss with a "back to Labour Management"
// action (founder ask #2, no dismiss any more).
//
// Following the pattern already established by labour-log-intent.test.tsx:
// no DOM rendering is needed. `renderLogView` (and `LabourLogBanner`) are
// plain functions that return React element trees — we call them directly
// and inspect `.props`/`.type`, which is both faster and less brittle than
// mounting the whole log page (which would otherwise require mocking
// CropSelector/WeatherWidget/ManualEntry/etc.).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import { renderLogView, LabourLogBanner } from '../mainView';

/**
 * Depth-first search over an (unrendered) React element tree for the first
 * element matching `predicate`. Elements are plain `{ type, props }`
 * objects at this stage — walking `.props.children` never invokes any
 * component's function body, so heavy children (CropSelector, WeatherWidget,
 * ManualEntry, ...) are inert and never need mocking.
 */
function findElement(
    node: React.ReactNode,
    predicate: (el: React.ReactElement) => boolean,
): React.ReactElement | null {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findElement(child, predicate);
            if (found) return found;
        }
        return null;
    }
    if (!React.isValidElement(node)) return null;
    if (predicate(node)) return node;
    return findElement((node.props as { children?: React.ReactNode }).children, predicate);
}

// LabourLogBanner has no hooks — safe to invoke as a plain function (same
// convention as renderLabourRoute() in the sibling spec), which returns an
// (unrendered) element object we can inspect via .props without mounting.
type BannerElement = React.ReactElement<{
    onClick: () => void;
    'data-testid': string;
    'aria-label': string;
}>;

describe('LabourLogBanner (component)', () => {
    it('renders the Marathi copy and calls onBackToLabour when tapped', () => {
        const onBackToLabour = vi.fn();
        const el = LabourLogBanner({ onBackToLabour }) as BannerElement;

        expect(el.props['data-testid']).toBe('labour-log-banner');
        expect(el.props.onClick).toBeTypeOf('function');

        el.props.onClick();
        expect(onBackToLabour).toHaveBeenCalledTimes(1);
    });

    it('carries no ✕ dismiss affordance — aria-label describes navigation, not dismissal', () => {
        const el = LabourLogBanner({ onBackToLabour: vi.fn() }) as BannerElement;
        expect(el.props['aria-label']).toContain('कामगार व्यवस्थापन');
        expect(el.props['aria-label']).not.toMatch(/dismiss/i);
    });

    // Task 7 (labour-v2-release-1) — this banner's subtitle read
    // "मजूर · हजेरी · मजुरी बोला" ("Worker · Attendance · Wages — speak"),
    // live on the main log screen whenever logIntent is 'labour'. There is
    // no attendance capture anywhere in the Labour feature — this banner is
    // not `LabourMic.tsx` (deleted 2026-08-31 with the rebuilt Attendance mic)
    // but makes the same claim.
    it('does not promise हजेरी (attendance) capture anywhere in its text', () => {
        const el = LabourLogBanner({ onBackToLabour: vi.fn() }) as React.ReactElement;
        const collectText = (node: React.ReactNode): string => {
            if (node === null || node === undefined || typeof node === 'boolean') return '';
            if (typeof node === 'string' || typeof node === 'number') return String(node);
            if (Array.isArray(node)) return node.map(collectText).join('');
            if (React.isValidElement(node)) return collectText((node.props as { children?: React.ReactNode }).children);
            return '';
        };
        expect(collectText(el)).not.toContain('हजेरी');
    });
});

// Minimal-but-complete AppRouterContext for renderLogView's idle branch.
// mode: 'manual' + hasActiveLogContext: false selects the "Select a plot to
// continue..." leaf (skips ManualEntry/AudioRecorder entirely); status:
// 'idle' skips the processing/success blocks; recordingSegment: null skips
// the segment-recording block. Every other field is read but never
// dereferenced beyond being passed through, so safe defaults suffice.
function makeLogViewCtx(overrides: Partial<AppRouterContext> = {}): AppRouterContext {
    const base = {
        currentRoute: 'main',
        mainView: 'log',
        status: 'idle',
        mode: 'manual',
        recordingSegment: null,
        weatherData: undefined,
        weatherStatus: 'idle',
        boundaryUnset: false,
        refetchWeather: vi.fn(),
        setCurrentRoute: vi.fn(),
        ownerDisplayName: 'Test Owner',
        todayDayState: { closurePercent: 0, isClosed: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        yesterdayDayState: { closurePercent: 0, isClosed: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        setShowReviewInbox: vi.fn(),
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

describe('renderLogView — LabourLogBanner wiring', () => {
    it('shows the banner and routes to "labour" when tapped, when logIntent is "labour"', () => {
        const setCurrentRoute = vi.fn();
        const ctx = makeLogViewCtx({ logIntent: 'labour', setCurrentRoute });

        const tree = renderLogView(ctx);
        const banner = findElement(tree, (el) => el.type === LabourLogBanner);

        expect(banner).not.toBeNull();
        (banner!.props as { onBackToLabour: () => void }).onBackToLabour();
        expect(setCurrentRoute).toHaveBeenCalledWith('labour');
    });

    it('does not render the banner when logIntent is null', () => {
        const ctx = makeLogViewCtx({ logIntent: null });
        const tree = renderLogView(ctx);
        const banner = findElement(tree, (el) => el.type === LabourLogBanner);
        expect(banner).toBeNull();
    });
});
