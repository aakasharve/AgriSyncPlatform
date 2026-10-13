import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import { renderConsentRoute, renderExportRequestRoute, renderErasureRequestRoute, renderProfileRoute } from '../simpleRoutes';

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

describe('Setup Hub opens Settings (the Voice Diary + retention-consent page)', () => {
    it('profile route wires onOpenSettings to the settings route', () => {
        const setCurrentRoute = vi.fn();
        const node = renderProfileRoute(ctxWith('profile', setCurrentRoute)) as React.ReactElement<{ children: React.ReactElement<{ onOpenSettings?: () => void }> }>;
        expect(node).not.toBeNull();
        const page = node.props.children;
        expect(typeof page.props.onOpenSettings).toBe('function');
        page.props.onOpenSettings!();
        expect(setCurrentRoute).toHaveBeenCalledWith('settings');
    });
});
