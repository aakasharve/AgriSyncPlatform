import type { ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EntitlementGuard } from '@/components/EntitlementGuard';
import { ModuleKeys } from '@/lib/moduleKeys';
import type { AdminScopeView, MeScopeResponse, ResolveOutcome } from '@/hooks/useAdminScope';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * CHARACTERISATION TEST — Preservation Register A8.
 *
 * `if (isLoading) return null;` (EntitlementGuard.tsx:33) is one line and it is
 * the difference between a working deep link and a console that throws its own
 * admin out. A hard refresh on /ops/errors mounts the guard before
 * /admin/me/scope has answered. Redirect on loading and every legitimate user
 * lands on /403 every time they refresh a guarded page.
 *
 * The second half matters just as much: it renders NOTHING, not a spinner. The
 * drilldown's in-page ops gate (FarmerHealthDrilldown.tsx:47-48) treats
 * "scope still loading" as "no access" for exactly this reason — a placeholder
 * that implies a decision has been made is how server-redacted nulls end up
 * rendered as data.
 */

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

type Module = AdminScopeView['modules'][number];

function scopeResponse(modules: Module[]): MeScopeResponse {
  return {
    outcome: 'Resolved',
    scope: {
      userId: 'user-1',
      orgId: ORG,
      orgType: 'FPO',
      orgRole: 'Owner',
      isPlatformAdmin: false,
      modules,
    },
    memberships: [],
  };
}

function unresolved(outcome: ResolveOutcome): MeScopeResponse {
  return { outcome, scope: null, memberships: [] };
}

/** Renders the router state the guard handed to /403, so it can be asserted. */
function ForbiddenProbe() {
  const location = useLocation();
  return <div data-testid="forbidden">{JSON.stringify(location.state ?? null)}</div>;
}

function renderGuard(guard: ReactNode) {
  return renderWithProviders(
    <Routes>
      <Route path="/guarded" element={guard} />
      <Route path="/403" element={<ForbiddenProbe />} />
    </Routes>,
    { route: '/guarded' },
  );
}

const child = <div data-testid="child">protected content</div>;

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

describe('EntitlementGuard while the scope is loading (A8)', () => {
  it('renders nothing — not the child, and not a redirect to /403', async () => {
    stub = installAdapter(neverSettles);

    const { container } = renderGuard(
      <EntitlementGuard module={ModuleKeys.OpsLive}>{child}</EntitlementGuard>,
    );

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    expect(screen.queryByTestId('child')).toBeNull();
    expect(screen.queryByTestId('forbidden')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('does not substitute a spinner or any other placeholder', async () => {
    stub = installAdapter(neverSettles);

    const { container } = renderGuard(
      <EntitlementGuard module={ModuleKeys.OpsLive}>{child}</EntitlementGuard>,
    );

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    expect(container.textContent).toBe('');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('renders nothing while loading even when a fallback is supplied', async () => {
    // The fallback belongs to the DENIED branch (EntitlementGuard.tsx:35,42),
    // not to the loading branch. A fallback that appeared during loading would
    // announce a denial that has not been decided.
    stub = installAdapter(neverSettles);

    const { container } = renderGuard(
      <EntitlementGuard module={ModuleKeys.OpsLive} fallback={<p>Ops data hidden</p>}>
        {child}
      </EntitlementGuard>,
    );

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    expect(container).toBeEmptyDOMElement();
  });
});

describe('EntitlementGuard once the scope resolves', () => {
  it('renders the children when the module grants read', async () => {
    stub = installAdapter(async () => ({
      status: 200,
      data: scopeResponse([
        { key: ModuleKeys.OpsLive, canRead: true, canWrite: false, canExport: false },
      ]),
    }));

    renderGuard(<EntitlementGuard module={ModuleKeys.OpsLive}>{child}</EntitlementGuard>);

    expect(await screen.findByTestId('child')).toBeInTheDocument();
    expect(screen.queryByTestId('forbidden')).toBeNull();
  });

  it('redirects to /403 with the pathname AND the module key when read is denied', async () => {
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse([]) }));

    renderGuard(<EntitlementGuard module={ModuleKeys.OpsLive}>{child}</EntitlementGuard>);

    const forbidden = await screen.findByTestId('forbidden');
    expect(JSON.parse(forbidden.textContent ?? 'null')).toEqual({
      from: '/guarded',
      module: ModuleKeys.OpsLive,
    });
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it.each(['Unauthorized', 'Ambiguous', 'NotInOrg'] as const)(
    'redirects to /403 WITHOUT a module key on the %s outcome',
    async (outcome) => {
      // EntitlementGuard.tsx:35 omits `module` on the unresolved branch — /403
      // shows the generic message, not "you lack ops.live", because the caller
      // did not lack a module; the scope never resolved at all.
      stub = installAdapter(async () => ({ status: 200, data: unresolved(outcome) }));

      renderGuard(<EntitlementGuard module={ModuleKeys.OpsLive}>{child}</EntitlementGuard>);

      const forbidden = await screen.findByTestId('forbidden');
      expect(JSON.parse(forbidden.textContent ?? 'null')).toEqual({ from: '/guarded' });
    },
  );

  it('redirects to /403 when the scope query errors', async () => {
    stub = installAdapter(async () => ({ status: 500, data: {} }));

    renderGuard(<EntitlementGuard module={ModuleKeys.OpsLive}>{child}</EntitlementGuard>);

    // useAdminScope retries once, so the decision is not final for ~1s.
    expect(await screen.findByTestId('forbidden', undefined, { timeout: 5_000 })).toBeInTheDocument();
  });

  it('renders the fallback instead of redirecting, on both denial branches', async () => {
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse([]) }));

    renderGuard(
      <EntitlementGuard module={ModuleKeys.OpsLive} fallback={<p>Ops data hidden</p>}>
        {child}
      </EntitlementGuard>,
    );

    expect(await screen.findByText('Ops data hidden')).toBeInTheDocument();
    expect(screen.queryByTestId('forbidden')).toBeNull();
  });
});

describe('EntitlementGuard access levels', () => {
  const readOnly = [
    { key: ModuleKeys.OpsLive, canRead: true, canWrite: false, canExport: false },
  ];

  it('defaults to the read level', async () => {
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse(readOnly) }));

    renderGuard(<EntitlementGuard module={ModuleKeys.OpsLive}>{child}</EntitlementGuard>);

    expect(await screen.findByTestId('child')).toBeInTheDocument();
  });

  it.each(['write', 'export'] as const)(
    'denies at the %s level when only read is granted',
    async (level) => {
      // No write or export call site exists in the console today. The levels are
      // kept anyway (A6) — deleting them as "unused" would mean the first write
      // surface ships with a read-level gate.
      stub = installAdapter(async () => ({ status: 200, data: scopeResponse(readOnly) }));

      renderGuard(
        <EntitlementGuard module={ModuleKeys.OpsLive} require={level}>
          {child}
        </EntitlementGuard>,
      );

      expect(await screen.findByTestId('forbidden')).toBeInTheDocument();
      expect(screen.queryByTestId('child')).toBeNull();
    },
  );

  it.each(['write', 'export'] as const)('allows at the %s level when granted', async (level) => {
    stub = installAdapter(async () => ({
      status: 200,
      data: scopeResponse([
        { key: ModuleKeys.OpsLive, canRead: true, canWrite: true, canExport: true },
      ]),
    }));

    renderGuard(
      <EntitlementGuard module={ModuleKeys.OpsLive} require={level}>
        {child}
      </EntitlementGuard>,
    );

    expect(await screen.findByTestId('child')).toBeInTheDocument();
  });
});
