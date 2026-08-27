// spec: 2026-07-13-labour-attendance-approval-design (Task 3.4)
//
// renderLabourRoute's onGoToLog is the single doorway from the labour mic
// into the canonical log page. It must tag the log-intent BEFORE navigating,
// so mainView can show the "why am I here" hint on arrival.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import { renderLabourRoute } from '../simpleRoutes';

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

describe('renderLabourRoute — onGoToLog carries the labour intent', () => {
    it('sets logIntent("labour") and navigates to main when the mic launcher fires', () => {
        const ctx = ctxWith('labour');
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
});
