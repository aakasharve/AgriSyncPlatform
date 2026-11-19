import { act, useEffect } from 'react';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useActiveOrg } from '@/app/ActiveOrgProvider';
import { useAdminScope, type AdminScopeView, type MeScopeResponse } from '@/hooks/useAdminScope';
import { ModuleKeys } from '@/lib/moduleKeys';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles, type StubbedAdapter } from '@/test/stubAdapter';
import { QueryClient } from '@tanstack/react-query';

/**
 * CHARACTERISATION TEST — Preservation Register A6, A7.
 *
 * Two properties, neither of which is visible on a screen:
 *
 *  A7 — the scope query key ends with the active org (useAdminScope.ts:72).
 *       Drop the org from the key and React Query happily serves org A's
 *       resolved permissions to org B from cache. Nothing goes red, nothing
 *       looks different, and someone sees data they should not.
 *
 *  A6 — canRead / canWrite / canExport FAIL CLOSED (useAdminScope.ts:97-99).
 *       While the scope is loading, after an error, and for any non-Resolved
 *       outcome, all three return false. Rewriting `has()` to return true on a
 *       missing scope would silently open every gate in the console.
 */

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

type Module = AdminScopeView['modules'][number];

function scopeResponse(modules: Module[], orgId = ORG_A): MeScopeResponse {
  return {
    outcome: 'Resolved',
    scope: {
      userId: 'user-1',
      orgId,
      orgType: 'FPO',
      orgRole: 'Owner',
      isPlatformAdmin: false,
      modules,
    },
    memberships: [],
  };
}

const readOnly: Module = { key: ModuleKeys.OpsLive, canRead: true, canWrite: false, canExport: false };
const fullAccess: Module = { key: ModuleKeys.OpsLive, canRead: true, canWrite: true, canExport: true };

/**
 * Last snapshot published by the hook, plus the org setter, for assertions.
 *
 * Published from an effect rather than assigned during render: writing to
 * module scope during render is a side effect, and the console's own react-hooks
 * lint rules say so. A probe that trips the rules it exists to protect is a poor
 * advertisement for the tests it carries. `render()` and `waitFor()` both flush
 * effects, so the value is always current by the time an assertion reads it.
 */
const captured: {
  scope: ReturnType<typeof useAdminScope> | null;
  setActiveOrgId: ((id: string | null) => void) | null;
} = { scope: null, setActiveOrgId: null };

function Probe() {
  const scope = useAdminScope();
  const { setActiveOrgId } = useActiveOrg();
  useEffect(() => {
    captured.scope = scope;
    captured.setActiveOrgId = setActiveOrgId;
  });
  return null;
}

/**
 * CHANGED IN TASK 12, WITH THE BEHAVIOUR IT DESCRIBES.
 *
 * These tests used to set the org by writing the REAL jsdom url
 * (`window.history.replaceState({}, '', '/?org=...')`) because
 * `ActiveOrgProvider` read `window.location.href` directly and could not see
 * the MemoryRouter at all. Task 12 Step 2 moved the read onto the router's own
 * search params, so the org now arrives the way `renderWithProviders`
 * documents: through `route`. The property under test — the key ends with the
 * active org — is unchanged; only how a test says "an org is selected".
 *
 * This is a strict improvement in what the harness can prove. `route` and the
 * app now agree, so a test can no longer set an org that the provider silently
 * ignores — which is exactly the trap Task 1 had to warn about in
 * renderWithProviders.tsx.
 */
function mount(queryClient: QueryClient = makeTestQueryClient(), route = '/') {
  renderWithProviders(<Probe />, { queryClient, route });
  return queryClient;
}

/** The url a test uses to say "this admin has org A selected". */
const AT_ORG_A = '/?org=' + ORG_A;

/**
 * The harness client uses `gcTime: 0`, which collects a query the instant it
 * loses its last observer — correct for isolation, useless for asking "could
 * org A's cached answer be served to org B?". These two tests need the cache to
 * survive an org switch, so they keep entries for the length of the test only.
 */
function cacheRetainingClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 60_000 } },
  });
}

function keysIn(queryClient: QueryClient) {
  return queryClient.getQueryCache().getAll().map((q) => q.queryKey);
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  captured.scope = null;
  captured.setActiveOrgId = null;
  localStorage.clear();
});

describe('scope query key carries the active org (A7)', () => {
  it('ends the key with the literal "none" when no org is selected', async () => {
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse([readOnly]) }));

    const queryClient = mount();

    await waitFor(() => expect(keysIn(queryClient)).toHaveLength(1));
    expect(keysIn(queryClient)[0]).toEqual(['admin', 'me', 'scope', 'none']);
  });

  it('ends the key with the active org id when one is selected', async () => {
    // The org arrives through the ROUTER now (Task 12 Step 2): `route` is what
    // the provider reads. See renderWithProviders.tsx.
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse([readOnly]) }));

    const queryClient = mount(makeTestQueryClient(), AT_ORG_A);

    await waitFor(() => expect(keysIn(queryClient)).toHaveLength(1));
    expect(keysIn(queryClient)[0]).toEqual(['admin', 'me', 'scope', ORG_A]);
  });

  it('sends the org header on the very FIRST scope request, not only on later ones', async () => {
    // The key and the header have to agree from the first request. A key that
    // says org A over a request that carried no org caches the WRONG answer
    // under the right name — the worst of both.
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse([readOnly]) }));

    mount(makeTestQueryClient(), AT_ORG_A);

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(stub.requests[0].url).toBe('/shramsafal/admin/me/scope');
    expect(stub.requests[0].headers['X-Active-Org-Id']).toBe(ORG_A);
  });

  it('switching org refetches under a new key — org A grants never answer for org B', async () => {
    // This is the whole reason the org is in the key. Org A grants ops.live;
    // org B grants nothing. If the key omitted the org, org B would read org A's
    // cached "yes" and the console would open a gate the server would refuse.
    stub = installAdapter(async (req) => ({
      status: 200,
      data:
        req.headers['X-Active-Org-Id'] === ORG_A
          ? scopeResponse([fullAccess], ORG_A)
          : scopeResponse([], ORG_B),
    }));

    const queryClient = cacheRetainingClient();
    mount(queryClient, AT_ORG_A);

    await waitFor(() => expect(captured.scope?.canRead(ModuleKeys.OpsLive)).toBe(true));

    await act(async () => {
      captured.setActiveOrgId?.(ORG_B);
    });

    await waitFor(() => expect(captured.scope?.scope?.orgId).toBe(ORG_B));
    expect(captured.scope?.canRead(ModuleKeys.OpsLive)).toBe(false);

    const keys = keysIn(queryClient);
    expect(keys).toContainEqual(['admin', 'me', 'scope', ORG_A]);
    expect(keys).toContainEqual(['admin', 'me', 'scope', ORG_B]);
    expect(stub.requests.map((r) => r.headers['X-Active-Org-Id'])).toEqual([ORG_A, ORG_B]);
  });

  it('a scope cached for org A cannot answer while org B is still resolving', async () => {
    // Same property from the other side, and deterministic: org A's answer is
    // already in the cache, org B's request never returns. The predicates must
    // fall back to false rather than reading the neighbour's entry.
    const queryClient = cacheRetainingClient();
    queryClient.setQueryData(['admin', 'me', 'scope', ORG_A], scopeResponse([fullAccess], ORG_A));
    stub = installAdapter(neverSettles);

    mount(queryClient, AT_ORG_A);

    // Served straight from cache — no answered request yet.
    await waitFor(() => expect(captured.scope?.canRead(ModuleKeys.OpsLive)).toBe(true));

    await act(async () => {
      captured.setActiveOrgId?.(ORG_B);
    });

    await waitFor(() => expect(captured.scope?.canRead(ModuleKeys.OpsLive)).toBe(false));
    expect(captured.scope?.isLoading).toBe(true);
    expect(captured.scope?.scope).toBeNull();
  });

  it('declares its own staleTime 60000 and retry 1, independent of the client defaults', async () => {
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse([readOnly]) }));

    const queryClient = mount();
    await waitFor(() => expect(keysIn(queryClient)).toHaveLength(1));

    const query = queryClient.getQueryCache().getAll()[0] as unknown as {
      observers: Array<{ options: { staleTime?: number; retry?: number | boolean } }>;
    };
    expect(query.observers[0].options.staleTime).toBe(60_000);
    expect(query.observers[0].options.retry).toBe(1);
  });
});

describe('permission predicates fail closed (A6)', () => {
  it.each(['canRead', 'canWrite', 'canExport'] as const)(
    '%s is false while the scope query is still in flight',
    async (predicate) => {
      stub = installAdapter(neverSettles);

      mount(makeTestQueryClient(), AT_ORG_A);

      await waitFor(() => expect(captured.scope?.isLoading).toBe(true));
      expect(captured.scope?.[predicate](ModuleKeys.OpsLive)).toBe(false);
    },
  );

  it.each(['canRead', 'canWrite', 'canExport'] as const)(
    '%s is false after the scope query fails',
    async (predicate) => {
      stub = installAdapter(async () => ({ status: 500, data: {} }));

      mount(makeTestQueryClient(), AT_ORG_A);

      // The hook declares `retry: 1` (useAdminScope.ts:78), so the failure is
      // only final after a second attempt and React Query's backoff — hence the
      // longer window than waitFor's 1s default.
      await waitFor(() => expect(captured.scope?.isError).toBe(true), { timeout: 5_000 });
      expect(stub?.requests).toHaveLength(2);
      expect(captured.scope?.[predicate](ModuleKeys.OpsLive)).toBe(false);
    },
  );

  it.each(['Unauthorized', 'Ambiguous', 'NotInOrg'] as const)(
    'all three predicates are false on the %s outcome',
    async (outcome) => {
      stub = installAdapter(async () => ({
        status: 200,
        data: { outcome, scope: null, memberships: [] },
      }));

      mount(makeTestQueryClient(), AT_ORG_A);

      await waitFor(() => expect(captured.scope?.outcome).toBe(outcome));
      expect(captured.scope?.isResolved).toBe(false);
      expect(captured.scope?.canRead(ModuleKeys.OpsLive)).toBe(false);
      expect(captured.scope?.canWrite(ModuleKeys.OpsLive)).toBe(false);
      expect(captured.scope?.canExport(ModuleKeys.OpsLive)).toBe(false);
    },
  );

  it('is false for a module the resolved scope does not list at all', async () => {
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse([fullAccess]) }));

    mount(makeTestQueryClient(), AT_ORG_A);

    await waitFor(() => expect(captured.scope?.isResolved).toBe(true));
    expect(captured.scope?.canRead(ModuleKeys.OpsErrors)).toBe(false);
    expect(captured.scope?.canWrite(ModuleKeys.OpsErrors)).toBe(false);
    expect(captured.scope?.canExport(ModuleKeys.OpsErrors)).toBe(false);
  });

  it('honours the three levels separately — read granted does not imply write or export', async () => {
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse([readOnly]) }));

    mount(makeTestQueryClient(), AT_ORG_A);

    await waitFor(() => expect(captured.scope?.isResolved).toBe(true));
    expect(captured.scope?.canRead(ModuleKeys.OpsLive)).toBe(true);
    expect(captured.scope?.canWrite(ModuleKeys.OpsLive)).toBe(false);
    expect(captured.scope?.canExport(ModuleKeys.OpsLive)).toBe(false);
  });

  it('returns true on every level when the module grants all three', async () => {
    // The positive case exists so the fail-closed assertions above cannot pass
    // by accident on a predicate that always returns false.
    stub = installAdapter(async () => ({ status: 200, data: scopeResponse([fullAccess]) }));

    mount(makeTestQueryClient(), AT_ORG_A);

    await waitFor(() => expect(captured.scope?.isResolved).toBe(true));
    expect(captured.scope?.canRead(ModuleKeys.OpsLive)).toBe(true);
    expect(captured.scope?.canWrite(ModuleKeys.OpsLive)).toBe(true);
    expect(captured.scope?.canExport(ModuleKeys.OpsLive)).toBe(true);
  });
});

describe('four-outcome surface (A2 support — pinned here because A6/A7 read it)', () => {
  it('exposes memberships as an empty array and outcome as null before any data arrives', async () => {
    stub = installAdapter(neverSettles);

    mount();

    await waitFor(() => expect(captured.scope?.isLoading).toBe(true));
    expect(captured.scope?.memberships).toEqual([]);
    expect(captured.scope?.outcome).toBeNull();
    expect(captured.scope?.scope).toBeNull();
    expect(captured.scope?.isResolved).toBe(false);
  });

  it('carries memberships through on an Ambiguous outcome', async () => {
    stub = installAdapter(async () => ({
      status: 200,
      data: {
        outcome: 'Ambiguous',
        scope: null,
        memberships: [{ orgId: ORG_A, orgName: 'Org A', orgType: 'FPO', orgRole: 'Owner' }],
      },
    }));

    mount();

    await waitFor(() => expect(captured.scope?.outcome).toBe('Ambiguous'));
    expect(captured.scope?.memberships).toHaveLength(1);
    expect(captured.scope?.memberships[0].orgName).toBe('Org A');
  });
});
