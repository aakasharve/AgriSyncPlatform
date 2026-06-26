/**
 * spec: t-igh-01-vitest-feature-gate-spec
 *
 * AppRouter feature-gate regression coverage.
 *
 * Sub-plan 01 Task 4 gated the `TestE2EPage` behind the E2E-harness feature
 * flag. The gate is split across two modules:
 *
 *   featureFlags.ts   — `IS_E2E_HARNESS_ENABLED` = (VITE_E2E_HARNESS === '1')
 *   lazyComponents.ts — `TestE2EPage = IS_E2E_HARNESS_ENABLED ? React.lazy(...) : null`
 *   simpleRoutes.tsx  — `renderTestE2ERoute` returns null when `!TestE2EPage`
 *                       (even when the active route is 'test-e2e').
 *
 * This spec locks in that decision: when the flag is OFF, the `test-e2e`
 * route is unreachable; when it is ON, the route renders the harness page.
 *
 * The reference task's sketch used `require()` — wrong for this ESM/Vitest
 * project. We use `import` (dynamic, after `vi.doMock`) so the mocked
 * featureFlags module is picked up by `lazyComponents` / `simpleRoutes`.
 *
 * No DOM is needed: `renderTestE2ERoute` returns a React node, and the
 * gating decision is observable directly as `null` vs a rendered element.
 * We assert on the returned node, not on a source-text heuristic.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { AppRouterContext } from '../routeContext';

// Minimal AppRouterContext stub — `renderTestE2ERoute` only reads
// `currentRoute`. The cast keeps the test focused on the gate without
// constructing the (large) full context shape.
function makeCtx(currentRoute: string): AppRouterContext {
    return { currentRoute } as unknown as AppRouterContext;
}

// Load `simpleRoutes` with the E2E-harness flag forced to a known value.
// We mock featureFlags (the build-time gate source) BEFORE importing the
// route module so `lazyComponents` reads the mocked `IS_E2E_HARNESS_ENABLED`.
async function loadRoutesWithFlag(enabled: boolean) {
    vi.resetModules();
    vi.doMock('../../../app/featureFlags', () => ({
        IS_E2E_HARNESS_ENABLED: enabled,
        isE2EHarnessEnabled: () => enabled,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
        FEATURE_FLAGS: { DwcChip: false },
    }));
    return import('../simpleRoutes');
}

afterEach(() => {
    vi.doUnmock('../../../app/featureFlags');
    vi.resetModules();
});

describe('AppRouter — E2E-harness feature gate (TestE2EPage)', () => {
    it('does NOT render the test-e2e route when the harness flag is OFF', async () => {
        const { renderTestE2ERoute } = await loadRoutesWithFlag(false);
        // Even with the active route pointed straight at the harness, the
        // gate must keep it unreachable.
        const node = renderTestE2ERoute(makeCtx('test-e2e'));
        expect(node).toBeNull();
    });

    it('keeps the test-e2e route out of the composed route table when OFF', async () => {
        const { renderTestE2ERoute, SIMPLE_ROUTE_RENDERERS } = await loadRoutesWithFlag(false);
        // renderTestE2ERoute is still listed (it is a pure function), but it
        // resolves to null for the harness route — i.e. no renderer in the
        // table will ever produce the TestE2EPage when the flag is OFF.
        const rendered = SIMPLE_ROUTE_RENDERERS.map(render => render(makeCtx('test-e2e')));
        expect(rendered.every(node => node === null)).toBe(true);
        expect(renderTestE2ERoute(makeCtx('test-e2e'))).toBeNull();
    });

    it('renders the test-e2e route when the harness flag is ON', async () => {
        const { renderTestE2ERoute } = await loadRoutesWithFlag(true);
        const node = renderTestE2ERoute(makeCtx('test-e2e'));
        // With the flag ON, lazyComponents.TestE2EPage is a real lazy
        // component, so the route returns a rendered element (not null).
        expect(node).not.toBeNull();
        expect(React.isValidElement(node)).toBe(true);
    });

    it('returns null for a non-matching route regardless of flag state', async () => {
        const { renderTestE2ERoute } = await loadRoutesWithFlag(true);
        // The gate is route-scoped: a different active route never yields the
        // harness page even when the flag is ON.
        expect(renderTestE2ERoute(makeCtx('settings'))).toBeNull();
    });
});
