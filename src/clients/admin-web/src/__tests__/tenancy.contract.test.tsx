import { act, useEffect, useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { useActiveOrg } from '@/app/ActiveOrgProvider';
import { ORG_KEY_INDEX } from '@/lib/orgQuery';
import { useFarmsList, useSilentChurn, useSuffering } from '@/hooks/useFarms';
import { useUsersList } from '@/hooks/useUsers';
import { useOpsErrors } from '@/hooks/useOpsErrors';
import { useOpsHealth, useOpsHealthWrapped } from '@/hooks/useOpsHealth';
import { useOpsVoice } from '@/hooks/useOpsVoice';
import { useWvfd } from '@/hooks/useWvfd';
import { useCohortPatterns } from '@/features/farmer-health/hooks/useCohortPatterns';
import { useFarmerHealth } from '@/features/farmer-health/hooks/useFarmerHealth';
import ScheduleTemplatesPage from '@/pages/schedules/ScheduleTemplatesPage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type CapturedRequest, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * WHOLE_CONSOLE_WAIT - measured 2026-09-01, and it is not a tolerance for slow tests.
 *
 * These files mount the real <App />, whose routes are `lazy()`. Resolving a route
 * chunk is a genuine dynamic import, and under full-suite parallelism that import
 * competes with 35 other jsdom environments for the same cores.
 *
 * Several waiters here asked for an element that only exists AFTER such an import
 * while using Testing Library's 1000ms default. The line above them correctly
 * waited 15s for the URL to change; the line itself then gave the page one second
 * to arrive. On an idle machine that failed roughly two runs in three, always with
 * `Unable to find role="heading" and name "All Farms"` - the route had not finished
 * importing. Tasks 15, 16, 17, 18 and 19 each measured it and each routed it onward
 * as a "timing cliff"; it was a missing argument.
 *
 * This does NOT weaken anything. Every assertion is unchanged; a real regression
 * still fails, it just fails after waiting rather than before the page exists.
 */
const WHOLE_CONSOLE_WAIT = 15_000;

/**
 * TENANCY — the property this whole console is wrong without.
 *
 * A grep of the v3 prototype returns ZERO hits for org, tenant or scope. v3 is
 * implicitly single-tenant, so a design-led port produces a console where every
 * list silently returns the wrong organisation's rows. Nothing turns red.
 * Nothing looks wrong. The numbers are just somebody else's.
 *
 * Three mechanisms carry the whole of the defence, and not one of them is
 * visible in a screenshot:
 *
 *   1. `X-Active-Org-Id` on every request        (Preservation Register A1)
 *   2. the org in every query key                (A7)
 *   3. `?org=` surviving in the ROUTER's url     (A15, A20)
 *
 * ── HOW TO KNOW THESE TESTS HAVE TEETH ────────────────────────────────────
 * Every assertion below was written against a deliberate break and watched to
 * go red. Delete the org from any ONE of the twelve data keys and
 * "org A's rows are never served to org B" fails, by name, for that hook. Take
 * the org out of `useFarms.ts` alone and it is `useFarmsList` that reports it.
 * That is the point: a green test here that could not fail would license
 * exactly the bug this file exists to make impossible.
 */

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const AT_ORG_A = '/?org=' + ORG_A;

/** Cache that survives an org switch. The default harness client uses
 *  `gcTime: 0`, which collects a query the instant it loses its observer —
 *  correct for isolation, useless for asking "could org A's answer be served
 *  to org B?". */
function cacheRetainingClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 60_000 } },
  });
}

/* ───────────────────────── the twelve data queries ─────────────────────── */

interface QueryLike {
  data: unknown;
}

/**
 * ELEVEN HOOKS, TWELVE KEYS — counted from the source, not from the plan.
 *
 * Task 12's envelope names eleven: useFarmsList, useSilentChurn, useSuffering,
 * useUsersList, useOpsErrors, useOpsHealth, useOpsVoice, useWvfd,
 * useCohortPatterns, useFarmerHealth and useScheduleTemplates. Two corrections
 * from the repo:
 *
 *  - `useScheduleTemplates` DOES NOT EXIST. It is an inline `useQuery` in
 *    `ScheduleTemplatesPage.tsx`; Task 24 extracts it. It is covered by its own
 *    test below, through the page, because there is no hook to mount.
 *  - `useOpsHealthWrapped` is a TWELFTH data key the envelope does not name —
 *    a dead duplicate with zero callers, scheduled for deletion in Task 20.
 *    It is included: the one thing that must not survive this task is an
 *    org-less data key sitting in a file the next hook gets copied from.
 */
const DATA_HOOKS: ReadonlyArray<readonly [string, () => QueryLike]> = [
  ['useFarmsList', () => useFarmsList(1, 40)],
  ['useSilentChurn', () => useSilentChurn()],
  ['useSuffering', () => useSuffering()],
  ['useUsersList', () => useUsersList(1, 50)],
  ['useOpsErrors', () => useOpsErrors({ page: 1, pageSize: 50 })],
  ['useOpsHealth', () => useOpsHealth()],
  ['useOpsHealthWrapped', () => useOpsHealthWrapped()],
  ['useOpsVoice', () => useOpsVoice()],
  ['useWvfd', () => useWvfd()],
  ['useCohortPatterns', () => useCohortPatterns()],
  ['useFarmerHealth', () => useFarmerHealth('farm-1')],
];

/** What the mounted hook currently reports, plus the org setter. */
const captured: {
  data: unknown;
  setActiveOrgId: ((id: string | null) => void) | null;
} = { data: undefined, setActiveOrgId: null };

function Probe({ use }: { use: () => QueryLike }) {
  const q = use();
  const { setActiveOrgId } = useActiveOrg();
  useEffect(() => {
    captured.data = q.data;
    captured.setActiveOrgId = setActiveOrgId;
  });
  return null;
}

/** A response body every hook in the list can read, tagged with the org that
 *  asked for it. The envelope shape covers the ten wrapped surfaces; the two
 *  unwrapped ones (`/ops/health`, schedule templates) read the same object. */
function tagged(org: unknown) {
  return {
    tenant: org,
    items: [],
    totalCount: 0,
    page: 1,
    pageSize: 50,
    data: { tenant: org, items: [], totalCount: 0, page: 1, pageSize: 50 },
    meta: { source: 'live', window: '24h', lastRefreshedUtc: '2026-08-31T00:00:00Z', ttlSeconds: 60 },
  };
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  captured.data = undefined;
  captured.setActiveOrgId = null;
  localStorage.clear();
});

describe('every data query key carries the active org (A7, Step 3)', () => {
  it.each(DATA_HOOKS)('%s puts the org in its key', async (name, use) => {
    stub = installAdapter(async () => ({ status: 200, data: tagged(ORG_A) }));
    const queryClient = cacheRetainingClient();

    renderWithProviders(<Probe use={use} />, { queryClient, route: AT_ORG_A });
    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    const key = queryClient.getQueryCache().getAll()[0].queryKey;
    expect(key, `${name}'s query key does not contain the active org`).toContain(ORG_A);
    // Prefix, then org, then the variables — the convention `lib/orgQuery.ts`
    // depends on for its ORG_KEY_INDEX.
    expect(key[ORG_KEY_INDEX], `${name} put the org somewhere other than index ${ORG_KEY_INDEX}`)
      .toBe(ORG_A);
  });

  it('the schedule-templates query keys on the org too — it has no hook to mount', async () => {
    // The plan calls this `useScheduleTemplates`. There is no such hook: it is
    // an inline useQuery in the page (Task 24 extracts it), so the page is what
    // a test can mount.
    stub = installAdapter(async () => ({ status: 200, data: [] }));
    const queryClient = cacheRetainingClient();

    renderWithProviders(<ScheduleTemplatesPage />, { queryClient, route: AT_ORG_A });
    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    expect(queryClient.getQueryCache().getAll()[0].queryKey)
      .toEqual(['schedules', 'templates', ORG_A]);
  });

  it("spells an absent org 'none', the same way the scope key does", async () => {
    stub = installAdapter(async () => ({ status: 200, data: tagged(null) }));
    const queryClient = cacheRetainingClient();

    renderWithProviders(<Probe use={() => useSuffering()} />, { queryClient, route: '/' });
    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    expect(queryClient.getQueryCache().getAll()[0].queryKey).toEqual(['farms', 'suffering', 'none']);
  });
});

describe('THE CROSS-TENANT ASSERTION — org A rows are never served to org B', () => {
  /*
   * THE REGRESSION THIS GUARDS, in the plan's own words: switching orgs serves
   * cached rows from the previous tenant. It is silent, and it is a
   * data-leak-shaped bug.
   *
   * The shape of the proof: org A answers, org B never does. Freezing the
   * moment after the switch is what lets the test look at exactly what an
   * operator would be looking at while the new organisation's request is in
   * flight. If the org is missing from the key, the switch does not change the
   * key, the cache answers instantly out of org A's entry, and the assertion
   * below reports which hook leaked.
   */
  it.each(DATA_HOOKS)('%s: switching to org B never shows org A rows', async (name, use) => {
    const queryClient = cacheRetainingClient();
    stub = installAdapter(async (req: CapturedRequest) => {
      if (req.headers['X-Active-Org-Id'] === ORG_A) {
        return { status: 200, data: tagged(ORG_A) };
      }
      return new Promise<{ status: number; data: unknown }>(() => {});
    });

    renderWithProviders(<Probe use={use} />, { queryClient, route: AT_ORG_A });
    await waitFor(() => expect(captured.data).toBeDefined());

    await act(async () => {
      captured.setActiveOrgId?.(ORG_B);
    });

    expect(
      captured.data,
      `${name} SERVED ORG A'S ROWS TO ORG B — the org is missing from its query key ` +
        `or from its placeholderData. That is the silent cross-tenant leak Task 12 exists to close.`,
    ).toBeUndefined();
  });

  it('the same request, under the new org, goes out with the new header', async () => {
    // A key that changed while the header did not would file org A's answer
    // under org B's name — the worst of both.
    const queryClient = cacheRetainingClient();
    stub = installAdapter(async (req) => ({
      status: 200,
      data: tagged(req.headers['X-Active-Org-Id'] ?? null),
    }));

    renderWithProviders(<Probe use={() => useSuffering()} />, { queryClient, route: AT_ORG_A });
    await waitFor(() => expect(captured.data).toBeDefined());

    await act(async () => {
      captured.setActiveOrgId?.(ORG_B);
    });
    await waitFor(() => expect(captured.data).toBeDefined());

    expect(stub?.requests.map((r) => r.headers['X-Active-Org-Id'])).toEqual([ORG_A, ORG_B]);
    expect((captured.data as { data: { tenant: string } }).data.tenant).toBe(ORG_B);
  });

  it('a paginated list does NOT keep the previous ORGANISATION rows (A25 + orgQuery)', async () => {
    /*
     * THE HOLE THE KEY ALONE DOES NOT CLOSE.
     *
     * `placeholderData: keepPreviousData` on Farms, Users and API Errors exists
     * so page 2 does not flash empty on the way to page 3 (A25). Put the org in
     * the key and that same mechanism keeps the previous ORGANISATION's rows on
     * screen for the whole flight of the next organisation's request — under
     * the new organisation's name, with "Refreshing…" beside it.
     *
     * `lib/orgQuery.ts` narrows it: keep across a page change, never across an
     * org change. This test is the measurement that made it necessary.
     */
    const queryClient = cacheRetainingClient();
    stub = installAdapter(async (req) => {
      if (req.headers['X-Active-Org-Id'] === ORG_A) return { status: 200, data: tagged(ORG_A) };
      return new Promise<{ status: number; data: unknown }>(() => {});
    });

    renderWithProviders(<Probe use={() => useFarmsList(1, 40)} />, {
      queryClient,
      route: AT_ORG_A,
    });
    await waitFor(() => expect(captured.data).toBeDefined());

    await act(async () => {
      captured.setActiveOrgId?.(ORG_B);
    });

    expect(captured.data).toBeUndefined();
  });

  it('a paginated list DOES still keep the previous page within one org (A25)', async () => {
    // The negative half. Without this, "never keep previous data" would pass
    // the test above and quietly delete a capability the register protects.
    //
    // The page is component state rather than a prop, because RTL's `rerender`
    // replaces the ROOT element and would drop the providers this hook needs.
    const queryClient = cacheRetainingClient();
    let call = 0;
    stub = installAdapter(async () => {
      call += 1;
      if (call === 1) return { status: 200, data: tagged(ORG_A) };
      return new Promise<{ status: number; data: unknown }>(() => {});
    });

    function Pager() {
      const [page, setPage] = useState(1);
      const q = useFarmsList(page, 40);
      useEffect(() => {
        captured.data = q.data;
      });
      return <button onClick={() => setPage(2)}>next page</button>;
    }

    renderWithProviders(<Pager />, { queryClient, route: AT_ORG_A });
    await waitFor(() => expect(captured.data).toBeDefined());

    await userEvent.click(screen.getByRole('button', { name: 'next page' }));

    await waitFor(() => expect(stub?.requests.length).toBe(2));
    expect(captured.data, 'page 2 threw away page 1 rows — A25 is gone').toBeDefined();
  });

  it('the templates screen drops the previous org’s templates from the DOM', async () => {
    stub = installAdapter(async (req) => {
      if (req.headers['X-Active-Org-Id'] === ORG_A) {
        return {
          status: 200,
          data: [
            {
              templateId: 't1', name: 'Org A Grape Schedule', cropType: 'GRAPES', version: '1',
              isPublished: true, taskCount: 3, estimatedDurationDays: 90,
            },
          ],
        };
      }
      return new Promise<{ status: number; data: unknown }>(() => {});
    });

    function Screen() {
      const { setActiveOrgId } = useActiveOrg();
      useEffect(() => {
        captured.setActiveOrgId = setActiveOrgId;
      });
      return <ScheduleTemplatesPage />;
    }

    renderWithProviders(<Screen />, { queryClient: cacheRetainingClient(), route: AT_ORG_A });
    expect(
      await screen.findByText('Org A Grape Schedule', undefined, { timeout: WHOLE_CONSOLE_WAIT }),
    ).toBeInTheDocument();

    await act(async () => {
      captured.setActiveOrgId?.(ORG_B);
    });

    expect(screen.queryByText('Org A Grape Schedule')).not.toBeInTheDocument();
  });
});

describe('what the key does, and what resetQueries() adds (measured, T10 vs T12)', () => {
  /*
   * Task 10 chose `resetQueries()` over `invalidateQueries()` BY MEASUREMENT,
   * because invalidate refetches while leaving the previous organisation's rows
   * on screen. Task 12's envelope asks whether the org-in-key makes that reset
   * redundant. Measured, it does not — it changes what it is FOR:
   *
   *   the key      stops the previous org's rows being SHOWN
   *   resetQueries stops the previous org's rows being HELD
   *
   * The second is a memory property, not a rendering one, and it is the same
   * reason `qc.clear()` runs on sign-out (AdminShell.tsx). Both tests below
   * exist so neither half can be deleted as "already covered".
   */
  it('a switch alone already clears the screen — no cache primitive involved', async () => {
    const queryClient = cacheRetainingClient();
    stub = installAdapter(async (req) => {
      if (req.headers['X-Active-Org-Id'] === ORG_A) return { status: 200, data: tagged(ORG_A) };
      return new Promise<{ status: number; data: unknown }>(() => {});
    });

    renderWithProviders(<Probe use={() => useSuffering()} />, { queryClient, route: AT_ORG_A });
    await waitFor(() => expect(captured.data).toBeDefined());

    await act(async () => {
      captured.setActiveOrgId?.(ORG_B);
    });

    expect(captured.data).toBeUndefined();
    expect(stub?.requests.at(-1)?.headers['X-Active-Org-Id']).toBe(ORG_B);
  });

  it('but org A rows are STILL HELD in this tab until something resets them', async () => {
    const queryClient = cacheRetainingClient();
    stub = installAdapter(async (req) => {
      if (req.headers['X-Active-Org-Id'] === ORG_A) return { status: 200, data: tagged(ORG_A) };
      return new Promise<{ status: number; data: unknown }>(() => {});
    });

    renderWithProviders(<Probe use={() => useSuffering()} />, { queryClient, route: AT_ORG_A });
    await waitFor(() => expect(captured.data).toBeDefined());

    await act(async () => {
      captured.setActiveOrgId?.(ORG_B);
    });

    // Unreachable by key, and still in memory. This is why the topbar switcher
    // keeps its resetQueries() rather than dropping it as redundant.
    expect(queryClient.getQueryData(['farms', 'suffering', ORG_A])).toBeDefined();

    act(() => {
      queryClient.resetQueries();
    });

    expect(queryClient.getQueryData(['farms', 'suffering', ORG_A])).toBeUndefined();
  });
});

describe('the org header is on every admin request (A1, Step 1)', () => {
  it.each(DATA_HOOKS)('%s sends X-Active-Org-Id', async (_name, use) => {
    stub = installAdapter(async () => ({ status: 200, data: tagged(ORG_A) }));

    renderWithProviders(<Probe use={use} />, {
      queryClient: cacheRetainingClient(),
      route: AT_ORG_A,
    });

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    for (const request of stub!.requests) {
      expect(request.headers['X-Active-Org-Id']).toBe(ORG_A);
    }
  });
});

describe('a junk org is not an org (A15)', () => {
  it.each([
    ['not-a-uuid', 'not-a-uuid'],
    ['an empty string', ''],
    ['a sql-shaped string', "1' OR '1'='1"],
    ['a uuid missing a block', 'aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa'],
  ])('rejects %s in the url and sends no header', async (_label, value) => {
    stub = installAdapter(async () => ({ status: 200, data: tagged(null) }));

    renderWithProviders(<Probe use={() => useSuffering()} />, {
      queryClient: cacheRetainingClient(),
      route: '/?org=' + encodeURIComponent(value),
    });

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(Object.keys(stub!.requests[0].headers)).not.toContain('X-Active-Org-Id');
  });

  it('rejects a non-UUID value that is already in localStorage', async () => {
    // The storage read is validated as well as the url read. A value written by
    // an older build, or by hand, must not become a header.
    localStorage.setItem('admin.active-org.v1', 'whatever-was-here-before');
    stub = installAdapter(async () => ({ status: 200, data: tagged(null) }));

    renderWithProviders(<Probe use={() => useSuffering()} />, {
      queryClient: cacheRetainingClient(),
      route: '/',
    });

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(Object.keys(stub!.requests[0].headers)).not.toContain('X-Active-Org-Id');
  });

  it('falls back to a VALID stored org when the url carries junk (url → storage → null)', async () => {
    localStorage.setItem('admin.active-org.v1', ORG_B);
    stub = installAdapter(async () => ({ status: 200, data: tagged(ORG_B) }));

    renderWithProviders(<Probe use={() => useSuffering()} />, {
      queryClient: cacheRetainingClient(),
      route: '/?org=nonsense',
    });

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(stub!.requests[0].headers['X-Active-Org-Id']).toBe(ORG_B);
  });

  it('the url outranks storage when both are valid', async () => {
    localStorage.setItem('admin.active-org.v1', ORG_B);
    stub = installAdapter(async () => ({ status: 200, data: tagged(ORG_A) }));

    renderWithProviders(<Probe use={() => useSuffering()} />, {
      queryClient: cacheRetainingClient(),
      route: AT_ORG_A,
    });

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(stub!.requests[0].headers['X-Active-Org-Id']).toBe(ORG_A);
  });
});
