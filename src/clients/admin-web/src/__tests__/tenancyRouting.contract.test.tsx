import type { ReactElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { QueryClient as QC } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App, { RequireScope } from '@/App';
import { ModuleKeys } from '@/lib/moduleKeys';
import { authStore } from '@/lib/auth';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
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
 * TENANCY, END TO END — through the real router, on real screens.
 *
 * `tenancy.contract.test.tsx` proves the org is in every query key and that a
 * cached answer for one organisation can never be served to another. Those are
 * hook-level facts. THIS file proves the other half, which no hook test can
 * see: that `?org=` — the parameter deciding whose data a link shows —
 * SURVIVES the router.
 *
 * ── The bug this exists for (Task 12 Step 2) ──────────────────────────────
 * `ActiveOrgProvider.syncUrl` wrote the org with a raw
 * `window.history.replaceState`, which React Router does not observe. The
 * router's `location.search` was therefore missing the org, and the next
 * `setSearchParams` on ANY screen rebuilt the query string from that stale
 * copy and stripped it back out. Task 7 proved the mechanism and wrote it into
 * `useListUrlState`'s header; closing it needs the real switcher, the real
 * router and a real screen in one tree, because the writer is not the bug.
 *
 * Separate file, not a separate describe: every test here mounts the whole
 * console against App.tsx's module-scoped QueryClient, and sharing a file with
 * fifty hook mounts made them race the harness rather than the code.
 */

/**
 * How long a waiter in this file gets. Deliberately BELOW the 20s test
 * timeout in `vitest.config.ts`, so a failure reports the element that never
 * appeared rather than the test running out of time — see the note at the top
 * of `deepLink.contract.test.tsx`.
 */
const WAIT = 15_000;

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ORG_A_NAME = 'Shivar Farmer Producer Company';
const ORG_B_NAME = 'Krishi Vikas FPO';

/** A body every screen in this file can read. `tenant` names who asked. */
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
  localStorage.clear();
});

const SESSION = {
  accessToken: 'token-123',
  refreshToken: null,
  userId: '00000000-0000-0000-0000-0000000000aa',
  expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
};

const MEMBERSHIPS = [
  { orgId: ORG_A, orgName: ORG_A_NAME, orgType: 'FPO', orgRole: 'Owner' },
  { orgId: ORG_B, orgName: ORG_B_NAME, orgType: 'FPO', orgRole: 'Owner' },
];

/** A whole console behind one transport: real router, real guards, real hooks. */
function consoleServer(modules: string[], outcome = 'Resolved') {
  return installAdapter(async (req: CapturedRequest) => {
    const org = (req.headers['X-Active-Org-Id'] as string | undefined) ?? ORG_A;
    if (req.url.includes('/admin/me/scope')) {
      return {
        status: 200,
        data: {
          outcome,
          scope:
            outcome === 'Resolved'
              ? {
                  userId: SESSION.userId, orgId: org, orgType: 'FPO', orgRole: 'Owner',
                  isPlatformAdmin: false,
                  modules: modules.map((key) => ({
                    key, canRead: true, canWrite: false, canExport: false,
                  })),
                }
              : null,
          memberships: MEMBERSHIPS,
        },
      };
    }
    return { status: 200, data: tagged(org) };
  });
}

function appQueryClient(): QC {
  const tree = App() as ReactElement;
  return (tree.props as { client: QC }).client;
}

function at(): string {
  return window.location.pathname + window.location.search;
}

describe('the org survives a filter change on a REAL list screen (A15, A20, Step 2)', () => {
  beforeEach(() => {
    authStore.set(SESSION);
  });

  afterEach(() => {
    appQueryClient().clear();
    authStore.clear();
  });

  it('switch org in the topbar, then filter the list — the url still says which org', async () => {
    /*
     * THE EXACT BUG STEP 2 CLOSES, END TO END.
     *
     * `syncUrl` wrote `?org=` with `window.history.replaceState`
     * (ActiveOrgProvider.tsx:102-108), which React Router does not observe. So
     * the router's `location.search` was missing the org, and the very next
     * `setSearchParams` on ANY screen — including a perfectly correct
     * functional one, which `FarmsListPage.tsx:27` is — rebuilt the query
     * string from that stale copy and stripped the org straight back out of the
     * shareable url.
     *
     * A unit test on the writer cannot see this: the writer is not the bug. It
     * needs the real switcher, the real router and a real screen, in one tree.
     */
    window.history.replaceState({}, '', '/farms');
    stub = consoleServer([ModuleKeys.FarmsList]);

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'All Farms' }, { timeout: WAIT }))
      .toBeInTheDocument();

    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: /Active organization/ },
        { timeout: WHOLE_CONSOLE_WAIT },
      ),
    );
    const menu = screen.getByRole('menu', { name: 'Switch organization' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: new RegExp(ORG_B_NAME) }));

    await waitFor(() => expect(at()).toContain(`org=${ORG_B}`));

    // Now the filter change that used to silently drop it.
    await userEvent.click(screen.getByRole('button', { name: 'Tier B' }));

    await waitFor(() => expect(at()).toContain('tier=B'));
    expect(at(), 'the filter change stripped ?org= out of the shareable url').toContain(
      `org=${ORG_B}`,
    );
    expect(at()).toContain('page=1');
    // And the rows on screen came from org B, not from org A.
    expect(stub.requests.filter((r) => r.url.includes('/admin/farms')).at(-1)
      ?.headers['X-Active-Org-Id']).toBe(ORG_B);
  });

  it('the same holds on a second screen with its own writer — Users', async () => {
    // Two screens, two hand-rolled `setSearchParams` call sites. One passing
    // screen is an accident; the point is that the org lives somewhere no
    // screen has to remember it.
    window.history.replaceState({}, '', `/users?org=${ORG_A}`);
    stub = consoleServer([ModuleKeys.AdminUsers]);

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Users' }, { timeout: WAIT }))
      .toBeInTheDocument();

    /* By ACCESSIBLE NAME, not by placeholder text. Task 17 reworded the
       placeholder to match the Farms convention ("Search by phone or name…")
       and this line went red — the org property being tested has nothing to do
       with the wording inside the box, and `aria-label` is the handle that
       does not move when the copy does. */
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search accounts' }),
      'arve{Enter}',
    );

    await waitFor(() => expect(at()).toContain('search=arve'));
    expect(at()).toContain(`org=${ORG_A}`);
  });
});

describe('NotInOrg clears the selection, and says so truthfully (D16, Step 5)', () => {
  /*
   * `clear()` was declared on ActiveOrgProvider and called from NOWHERE, so
   * "The previous selection has been cleared." was FALSE: the rejected org id
   * stayed in localStorage AND in the url, was sent again on the next request,
   * and came back rejected on every reload after that. A console that says it
   * has done something and has not is worse than one that says nothing.
   *
   * These three mount `RequireScope` — the real four-outcome gate — over a stub
   * child, rather than the whole `<App />` the two tests above use. That is not
   * a weaker test, it is a narrower one: the gate, the provider, the switcher
   * and the router are all real, and the shell and the lazy pages are not part
   * of the property. Mounting the whole console twice in one file also shares
   * App.tsx's MODULE-SCOPED QueryClient between tests, which made these three
   * race the harness instead of measuring the code.
   */
  function Where() {
    const location = useLocation();
    return <output data-testid="url">{location.pathname + location.search}</output>;
  }

  function url(): string {
    return screen.getByTestId('url').textContent ?? '';
  }

  /**
   * The resolver, answering the way the backend does: from the HEADER, not
   * from a call counter. `AdminScopeHelper` decides per request — org A is not
   * in this admin's memberships, no header at all is ambiguous because they
   * have two, and org B resolves. Counting calls instead made this suite
   * depend on whether an intermediate refetch happened to be cancelled, which
   * is a property of React Query's cache, not of the console.
   */
  function resolverServer() {
    return installAdapter(async (req: CapturedRequest) => {
      const org = req.headers['X-Active-Org-Id'] as string | undefined;
      if (org === ORG_A) {
        return { status: 200, data: { outcome: 'NotInOrg', scope: null, memberships: MEMBERSHIPS } };
      }
      if (!org) {
        return { status: 200, data: { outcome: 'Ambiguous', scope: null, memberships: MEMBERSHIPS } };
      }
      return {
        status: 200,
        data: {
          outcome: 'Resolved',
          scope: {
            userId: SESSION.userId, orgId: org, orgType: 'FPO', orgRole: 'Owner',
            isPlatformAdmin: false, modules: [],
          },
          memberships: MEMBERSHIPS,
        },
      };
    });
  }

  function gate(route: string) {
    return renderWithProviders(
      <>
        <Where />
        <RequireScope>
          <div>the console</div>
        </RequireScope>
      </>,
      { route, queryClient: makeTestQueryClient() },
    );
  }

  it('drops the rejected org from localStorage AND from the url', async () => {
    localStorage.setItem('admin.active-org.v1', ORG_A);
    stub = resolverServer();

    gate(`/farms?org=${ORG_A}&page=3`);

    expect(
      await screen.findByText('That organization is not in your memberships', undefined, {
        timeout: WAIT,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/The previous selection has been cleared/)).toBeInTheDocument();

    await waitFor(() => expect(localStorage.getItem('admin.active-org.v1')).toBeNull());
    // The url is the other half, and it is the half a shared link carries.
    await waitFor(() => expect(url()).not.toContain('org='));
    // Everything else in the query string is left exactly where it was.
    expect(url()).toContain('page=3');
  });

  it('keeps saying WHY after the cleared scope comes back Ambiguous', async () => {
    /*
     * Clearing has a consequence the copy has to survive. The scope is re-asked
     * with no org header, and a multi-membership admin's next answer is
     * `Ambiguous` — which would replace "that organization is not yours" with
     * the generic "choose one", leaving the sentence true and the reason gone.
     */
    localStorage.setItem('admin.active-org.v1', ORG_A);
    stub = resolverServer();

    gate(`/farms?org=${ORG_A}`);

    await screen.findByText('That organization is not in your memberships', undefined, {
      timeout: WAIT,
    });
    await waitFor(
      () =>
        expect(
          stub!.requests.some((r) => r.headers['X-Active-Org-Id'] === undefined),
        ).toBe(true),
      { timeout: WAIT },
    );

    expect(screen.getByText('That organization is not in your memberships')).toBeInTheDocument();
    expect(screen.queryByText('Choose your active organization')).not.toBeInTheDocument();
  });

  it('picking a real organization from that screen opens the console', async () => {
    // Clearing must not become a dead end, and a reload is no longer available
    // to escape one: the Continue button that called window.location.reload()
    // is gone with Step 3.
    localStorage.setItem('admin.active-org.v1', ORG_A);
    stub = resolverServer();

    gate(`/farms?org=${ORG_A}`);
    await screen.findByText('That organization is not in your memberships', undefined, {
      timeout: WAIT,
    });

    /*
     * WAIT FOR THE POST-CLEAR ANSWER BEFORE CLICKING, and this is not
     * ceremony. Clearing swaps the scope key, `RequireScope` shows its loading
     * fallback while the new key resolves, and the switcher therefore UNMOUNTS
     * and REMOUNTS. A node captured before that cycle is detached by the time
     * the click lands, and React delivers nothing from a detached node — the
     * click silently does not happen. Waiting for the second request, and then
     * re-querying, is what makes this test measure the console rather than the
     * scheduler.
     */
    await waitFor(() => expect(stub!.requests.length).toBeGreaterThan(1), { timeout: WAIT });
    await screen.findByText('That organization is not in your memberships', undefined, {
      timeout: WHOLE_CONSOLE_WAIT,
    });

    await userEvent.click(screen.getByRole('button', { name: new RegExp(ORG_B_NAME) }));
    await waitFor(() => expect(localStorage.getItem('admin.active-org.v1')).toBe(ORG_B));

    expect(await screen.findByText('the console', undefined, { timeout: WAIT }))
      .toBeInTheDocument();
    expect(url()).toContain(`org=${ORG_B}`);
  });
});
