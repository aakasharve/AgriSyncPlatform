import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import { renderConsentRoute, renderExportRequestRoute, renderErasureRequestRoute } from '../simpleRoutes';

function ctxWith(currentRoute: string, setCurrentRoute = vi.fn()): AppRouterContext {
    return { currentRoute, setCurrentRoute } as unknown as AppRouterContext;
}

describe('privacy routes Back returns to the Hub after migration', () => {
    it.each([
        ['consent', renderConsentRoute],
        ['dataRights/export', renderExportRequestRoute],
        ['dataRights/erasure', renderErasureRequestRoute],
    ] as const)('%s onBack navigates to profile', (route, render) => {
        const setCurrentRoute = vi.fn();
        const node = render(ctxWith(route, setCurrentRoute)) as React.ReactElement<{ children: React.ReactElement<{ onBack: () => void }> }>;
        expect(node).not.toBeNull();
        // The screen is the single child of the animation wrapper; call its onBack.
        const screen = node.props.children;
        screen.props.onBack();
        expect(setCurrentRoute).toHaveBeenCalledWith('profile');
    });
});
