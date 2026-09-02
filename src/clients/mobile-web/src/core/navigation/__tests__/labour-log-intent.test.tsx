// spec: 2026-07-13-labour-attendance-approval-design (Task 3.4)
//
// renderLabourRoute's onGoToLog is the single doorway from the labour mic
// into the canonical log page. It must tag the log-intent BEFORE navigating,
// so mainView can show the "why am I here" hint on arrival.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import { renderLabourRoute } from '../simpleRoutes';
import { getDateKey } from '../../domain/services/DateKeyService';
import { LogVerificationStatus, type DailyLog } from '../../../domain/types/log.types';

function ctxWith(currentRoute: string): AppRouterContext & {
    setCurrentRoute: ReturnType<typeof vi.fn>;
    setLogIntent: ReturnType<typeof vi.fn>;
} {
    return {
        currentRoute,
        setCurrentRoute: vi.fn(),
        setLogIntent: vi.fn(),
    } as unknown as AppRouterContext & {
        setCurrentRoute: ReturnType<typeof vi.fn>;
        setLogIntent: ReturnType<typeof vi.fn>;
    };
}

// Labour V2 R1 Task 3.1 — the door now requires an anchor: a non-deleted log
// dated TODAY, accepted (not DRAFT/PENDING), with a stated headcount. One
// confirmed log with `count` is the minimum anchored history.
function anchoredHistory(): DailyLog[] {
    return [{
        id: 'log-anchor',
        date: getDateKey(),
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [], irrigation: [],
        labour: [{ id: 'l1', type: 'hired', count: 12 }],
        inputs: [], machinery: [],
        verification: { status: LogVerificationStatus.CONFIRMED, required: false },
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
    } as unknown as DailyLog];
}

describe('renderLabourRoute — onGoToLog carries the labour intent', () => {
    it('sets logIntent("labour") and navigates to main when the mic launcher fires', () => {
        const ctx = ctxWith('labour');
        // Task 3.1: the door refuses without an anchor — seed one so the
        // intent-tagging behaviour under test is reachable at all.
        (ctx as unknown as { history: DailyLog[] }).history = anchoredHistory();
        const node = renderLabourRoute(ctx) as React.ReactElement<{ children: React.ReactElement<{ onGoToLog: () => void }> }>;

        expect(node).not.toBeNull();
        const labourFeature = node.props.children;
        labourFeature.props.onGoToLog();

        expect(ctx.setLogIntent).toHaveBeenCalledWith('labour');
        expect(ctx.setCurrentRoute).toHaveBeenCalledWith('main');
        // Order matters: the intent must be tagged before the route flips,
        // so a consumer reading ctx after setCurrentRoute sees it already set.
        const intentCallOrder = ctx.setLogIntent.mock.invocationCallOrder[0];
        const routeCallOrder = ctx.setCurrentRoute.mock.invocationCallOrder[0];
        expect(intentCallOrder).toBeLessThan(routeCallOrder);
    });

    it('returns null for a non-matching route', () => {
        const ctx = ctxWith('profile');
        expect(renderLabourRoute(ctx)).toBeNull();
    });

    it('onGoToLog does nothing when today has no anchor (defence behind the disabled hero)', () => {
        const ctx = ctxWith('labour');
        (ctx as unknown as { history: unknown[] }).history = [];   // no logs today
        const node = renderLabourRoute(ctx) as React.ReactElement<{ children: React.ReactElement<{ onGoToLog: () => void }> }>;
        node.props.children.props.onGoToLog();
        expect(ctx.setLogIntent).not.toHaveBeenCalled();
        expect(ctx.setCurrentRoute).not.toHaveBeenCalled();
    });
});
