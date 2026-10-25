import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import { renderConsentRoute, renderExportRequestRoute, renderErasureRequestRoute, renderProfileRoute } from '../simpleRoutes';

function ctxWith(currentRoute: string, setCurrentRoute = vi.fn(), goBackOr = vi.fn()): AppRouterContext {
    return { currentRoute, setCurrentRoute, goBackOr } as unknown as AppRouterContext;
}

// spec: plr-d10-redesign-real-integration-2026-10-25 (WP-6) — Back goes where he came
// from; the Hub is only the fallback when there is no such place.
describe('privacy routes Back falls back to the Hub after migration', () => {
    it.each([
        ['consent', renderConsentRoute],
        ['dataRights/export', renderExportRequestRoute],
        ['dataRights/erasure', renderErasureRequestRoute],
    ] as const)('%s onBack goes back, with profile as the fallback', (route, render) => {
        const goBackOr = vi.fn();
        const node = render(ctxWith(route, vi.fn(), goBackOr)) as React.ReactElement<{ children: React.ReactElement<{ onBack: () => void }> }>;
        expect(node).not.toBeNull();
        // The screen is the single child of the animation wrapper; call its onBack.
        const screen = node.props.children;
        screen.props.onBack();
        expect(goBackOr).toHaveBeenCalledWith('profile');
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
