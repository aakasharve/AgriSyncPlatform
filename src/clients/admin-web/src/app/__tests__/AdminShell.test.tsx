import { useQuery } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminShell } from '@/app/AdminShell';
import shellSource from '../AdminShell.tsx?raw';
// TASK 13 moved the destination list out of the shell and into `nav.ts`, so
// the palette could stop keeping a second, already-divergent copy of it. The
// A53 slot and its REASON moved with the list; the assertion below follows
// them rather than being deleted.
import navSource from '../nav.ts?raw';
import ForbiddenPage from '@/pages/ForbiddenPage';
import { adminApi } from '@/lib/api';
import { authStore } from '@/lib/auth';
import type { MeScopeResponse } from '@/hooks/useAdminScope';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * THE SHELL — the frame around every screen.
 *
 * Four of these tests exist because the thing they check is invisible in a
 * screenshot and would therefore be lost, or kept wrong, by a design-led port:
 *
 *  - D12 the avatar. The old shell called `initialsOf(null, null)` with
 *    literal nulls, so EVERY admin in EVERY org saw the same two letters. A
 *    test that asserts "some initials render" passes against that bug, which
 *    is why the test below renders TWO different people and asserts the two
 *    results differ.
 *  - A39 the active organization. It appeared in exactly one subtitle on one
 *    screen; the prototype has no org concept at all. The assertion is made
 *    from the SHELL, at three different routes, against a page stub that
 *    renders nothing — so it cannot pass by way of a screen that happens to
 *    print an org name.
 *  - D4 the shortcut badges. Cmd-1 / Cmd-2 / Cmd-F were advertised in the
 *    sidebar and bound nowhere.
 *  - B14 the freshness chip. It may only state an age it actually has.
 */

/**
 * The shell source with its comments removed. Every "must not contain"
 * assertion runs against THIS, never against the raw text — the file
 * documents the defects it removed by name, and an assertion over the raw
 * text would be failed by its own explanation.
 */
const shellCode = shellSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

it('read the real shell source, not an empty stub', () => {
  // `vitest.config.ts` sets `css: false`, which hands every CSS `?raw` import
  // an empty string. This one is a `.tsx`, so it is not stubbed — but the
  // source-text assertions below are only evidence if the text is really
  // there, and that is one line to prove rather than to assume.
  expect(shellSource.length).toBeGreaterThan(2000);
  expect(shellSource).toContain('export function AdminShell');
  expect(navSource.length).toBeGreaterThan(2000);
  expect(navSource).toContain('export const NAV');
});

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const ORG_A_NAME = 'Shivar Farmer Producer Company';
const ORG_B_NAME = 'Krishi Vikas FPO';

/** A JWT-shaped string carrying real claims. Only the payload is read. */
function tokenWith(claims: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(claims));
  const binary = String.fromCharCode(...bytes);
  const payload = btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${payload}.signature`;
}

function signIn(claims: Record<string, unknown>) {
  authStore.set({
    accessToken: tokenWith(claims),
    refreshToken: null,
    userId: String(claims.sub ?? 'user-1'),
    expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

function scopeResponse(memberships: Array<{ orgId: string; orgName: string }>): MeScopeResponse {
  return {
    outcome: 'Resolved',
    scope: {
      userId: 'user-1',
      orgId: ORG_A,
      orgType: 'FPO',
      orgRole: 'Owner',
      isPlatformAdmin: false,
      modules: [],
    },
    memberships: memberships.map((m) => ({ ...m, orgType: 'FPO', orgRole: 'Owner' })),
  };
}

const ONE_MEMBERSHIP = [{ orgId: ORG_A, orgName: ORG_A_NAME }];
const TWO_MEMBERSHIPS = [
  { orgId: ORG_A, orgName: ORG_A_NAME },
  { orgId: ORG_B, orgName: ORG_B_NAME },
];

/**
 * The shell rendered where it actually lives — as a layout route with a child
 * route below it. The child renders a fixed string and nothing else, so any
 * org name, avatar or control found in the output came from the shell.
 */
function renderShell({ route = '/', queryClient = makeTestQueryClient() } = {}) {
  return renderWithProviders(
    <Routes>
      <Route element={<AdminShell />}>
        <Route path="*" element={<div>page body</div>} />
      </Route>
    </Routes>,
    { route, queryClient }
  );
}

/** A screen with a data query keyed the way the console keys them today —
 *  page and filters, no org. That omission is what makes the switcher's
 *  cache handling a tenancy question rather than a performance one. */
function FarmsProbe() {
  const { data } = useQuery<{ rows: string[] }>({
    queryKey: ['farms', 'list', 1],
    queryFn: async () => (await adminApi.get<{ rows: string[] }>('/shramsafal/admin/farms')).data,
  });
  return <div>{data ? data.rows.join(', ') : 'loading farms'}</div>;
}

let stub: StubbedAdapter | undefined;

function serve(memberships = ONE_MEMBERSHIP) {
  stub = installAdapter(async () => ({ status: 200, data: scopeResponse(memberships) }));
  return stub;
}

afterEach(() => {
  stub?.restore();
  stub = undefined;
});

/* ═════════════════════════════════ the two watchlists behind the nav badge ══ */

const BADGE_MODULES = ['farms.suffering', 'farms.silent-churn'];

function scopeWithModules(keys: string[]): MeScopeResponse {
  const base = scopeResponse(ONE_MEMBERSHIP);
  return {
    ...base,
    scope: {
      ...base.scope!,
      modules: keys.map((key) => ({ key, canRead: true, canWrite: false, canExport: false })),
    },
  };
}

/** The REAL `SufferingItemDto` shape (`AdminMisRepository.cs:240-242`). */
function sufferingRow(farmId: string, name: string) {
  return {
    farmId,
    name,
    errorCount: 12,
    syncErrors: 4,
    logErrors: 0,
    voiceErrors: 3,
    lastErrorAt: '2026-09-01T06:20:00.0000000Z',
  };
}

/** The REAL `SilentChurnItemDto` shape (`AdminMisRepository.cs:209-215`). */
function churnRow(farmId: string, name: string, over: Record<string, unknown> = {}) {
  return {
    farmId,
    name,
    ownerPhone: '98******10',
    plan: 'trial',
    weeksSilent: 3,
    lastLogAt: '2026-08-10T04:00:00.0000000Z',
    ...over,
  };
}

/** The envelope these two endpoints really send (`AdminResponse<T>`). */
function envelope(data: unknown) {
  return {
    data,
    meta: {
      source: 'materialized',
      lastRefreshedUtc: '2026-09-01T08:30:00.0000000Z',
      ttlSeconds: 300,
    },
  };
}

/** The badge, by the attribute the shell writes it under. `null` when the
 *  slot rendered nothing, which is a state this file asserts four times. */
function homeBadge(): HTMLElement | null {
  return document.querySelector('[data-nav-badge="Home"]');
}

function serveWatchlists({
  suffering = [] as unknown[],
  churn = [] as unknown[],
  churnPending = false,
} = {}) {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/me/scope')) {
      return { status: 200, data: scopeWithModules(BADGE_MODULES) };
    }
    if (req.url.includes('/farms/suffering')) return { status: 200, data: envelope(suffering) };
    if (req.url.includes('/farms/silent-churn')) {
      if (churnPending) return neverSettles();
      return { status: 200, data: envelope(churn) };
    }
    return { status: 404, data: {} };
  });
  return stub;
}

describe('the avatar is the signed-in admin (D12)', () => {
  it('renders DIFFERENT initials for two different people', async () => {
    /*
     * THE BUG THIS CATCHES. `initialsOf(null, null)` returned the constant
     * 'AK' for everyone. Any test asking only "are there initials?" passes
     * against that. Two people must produce two answers, or the value is not
     * coming from the person.
     */
    serve();
    signIn({ display_name: 'Purvesh Chandrashkehar Arve', phone: '8888888888' });
    const first = renderShell();
    expect(await screen.findByText('PA')).toBeInTheDocument();
    first.unmount();

    signIn({ display_name: 'Nanda Gaikwad', phone: '9999999911' });
    renderShell();
    expect(await screen.findByText('NG')).toBeInTheDocument();
    expect(screen.queryByText('PA')).not.toBeInTheDocument();
  });

  it('never renders the old hardcoded constant for anybody', () => {
    serve();
    signIn({ display_name: 'Akash Kadam', phone: '7777777777' });
    renderShell();
    // 'AK' is a legitimate answer for THIS person and a lie for everyone else,
    // so the constant is proved gone by the person who does NOT own it.
    expect(screen.getByText('AK')).toBeInTheDocument();

    // A rule is what a file DECLARES, not what its prose mentions: the header
    // comment explains the old bug BY NAME, and an assertion over raw text
    // would fail on the explanation — which a hurried reader then deletes.
    expect(shellCode).not.toContain("return 'AK'");
    expect(shellCode).not.toContain('initialsOf(null, null)');
  });

  it('names the signed-in admin to a screen reader', async () => {
    serve();
    signIn({ display_name: 'Nanda Gaikwad', phone: '9999999911' });
    renderShell();
    expect(await screen.findByText('Signed in as Nanda Gaikwad')).toBeInTheDocument();
  });

  it('falls back to the last two digits of the phone when the token has no name', async () => {
    // The OTP path issues an identity-only token: no display_name, no phone
    // (JwtTokenIssuer.cs:74-80). The password path this console uses carries
    // both. A token with only a phone is the in-between case.
    serve();
    signIn({ phone: '9876543210' });
    renderShell();
    expect(await screen.findByText('10')).toBeInTheDocument();
  });

  it('shows a person glyph, NOT invented initials, when the token names nobody', async () => {
    serve();
    signIn({ sub: 'user-1' });
    renderShell();
    expect(
      await screen.findByText('Signed in; this account has no name on its token')
    ).toBeInTheDocument();
    expect(screen.queryByText('AK')).not.toBeInTheDocument();
  });

  it('renders Devanagari initials in the Devanagari face, not the Latin one', async () => {
    /*
     * The font rule is a project hard rule, and this is the one place in the
     * shell a person's name reaches the DOM. `decodeJwt` used to read the
     * payload one byte per character, so a Marathi display name arrived as
     * mojibake — the initials would have been wrong before the font could be.
     */
    serve();
    signIn({ display_name: 'पूर्वेश आर्वे', phone: '8888888888' });
    renderShell();
    const initials = await screen.findByText('पआ');
    expect(initials).toHaveAttribute('data-script', 'devanagari');
    expect(initials).toHaveStyle({ fontFamily: "'Noto Sans Devanagari', sans-serif" });
  });
});

describe('the active organization is named on EVERY screen (A39)', () => {
  it.each(['/', '/farms', '/ops/errors', '/farmer-health/farm-123'])(
    'names it on %s',
    async (route) => {
      serve();
      signIn({ display_name: 'Test Admin' });
      renderShell({ route });

      expect(await screen.findByText(ORG_A_NAME)).toBeInTheDocument();
      // Proof it came from the shell: the routed page renders this and only this.
      expect(screen.getByText('page body')).toBeInTheDocument();
    }
  );

  it('names the org the SERVER resolved, not only the one the user picked', async () => {
    /*
     * A single-membership admin never picks an org, so ActiveOrgProvider holds
     * null while the server has resolved them into their one organization.
     * Reading the selection alone — which FarmerHealthPage.tsx:33 does today —
     * prints "No active organization" to an admin who plainly has one.
     */
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();

    expect(await screen.findByText(ORG_A_NAME)).toBeInTheDocument();
    expect(screen.queryByText('No active organization')).not.toBeInTheDocument();
    expect(localStorage.getItem('admin.active-org.v1')).toBeNull();
  });

  it('says so plainly when there is no organization to name — never a blank', async () => {
    stub = installAdapter(async () => ({
      status: 200,
      data: { outcome: 'Resolved', scope: null, memberships: [] } as MeScopeResponse,
    }));
    signIn({ display_name: 'Test Admin' });
    renderShell();

    expect(await screen.findByText('No active organization')).toBeInTheDocument();
  });

  it('labels it for a screen reader as the active organization', async () => {
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();
    expect(await screen.findByText('Active organization:')).toBeInTheDocument();
  });
});

describe('the org switcher (B11 — the topbar half)', () => {
  it('is a plain label, not a control, for an admin with one membership', async () => {
    serve(ONE_MEMBERSHIP);
    signIn({ display_name: 'Test Admin' });
    renderShell();

    await screen.findByText(ORG_A_NAME);
    expect(screen.queryByRole('button', { name: /Active organization/ })).not.toBeInTheDocument();
  });

  it('opens a menu of the memberships the server returned', async () => {
    serve(TWO_MEMBERSHIPS);
    signIn({ display_name: 'Test Admin' });
    renderShell();

    const trigger = await screen.findByRole('button', { name: /Active organization/ });
    await userEvent.click(trigger);

    const menu = screen.getByRole('menu', { name: 'Switch organization' });
    expect(within(menu).getByText(ORG_A_NAME)).toBeInTheDocument();
    expect(within(menu).getByText(ORG_B_NAME)).toBeInTheDocument();
  });

  it('switching does not leave the previous org’s rows on screen', async () => {
    /*
     * THE CROSS-TENANT PROPERTY OF THE SWITCHER, AGAINST A REAL DATA QUERY.
     *
     * Every data query key in this console omits the org (all eleven hooks,
     * verified), so cached rows are shared between organizations. The three
     * candidate primitives are NOT interchangeable, and this was measured
     * rather than assumed:
     *
     *   removeQueries()     no refetch at all — the stale rows stay forever
     *   invalidateQueries() refetches, but shows the OLD org's rows meanwhile
     *   resetQueries()      refetches, and shows a loading state meanwhile
     *
     * The farms query below is keyed exactly the way the console keys it
     * today. Its SECOND response never arrives, which freezes the moment
     * after the switch and lets the test look at what an operator would be
     * looking at. Task 12 makes this cheap by putting the org in the key; it
     * does not make it unnecessary.
     */
    let call = 0;
    const adapter = installAdapter(async (req) => {
      if (req.url.includes('/farms')) {
        call += 1;
        if (call === 1) return { status: 200, data: { rows: ['org A farm'] } };
        return new Promise<{ status: number; data: unknown }>(() => {});
      }
      return { status: 200, data: scopeResponse(TWO_MEMBERSHIPS) };
    });
    stub = adapter;
    signIn({ display_name: 'Test Admin' });

    renderWithProviders(
      <Routes>
        <Route element={<AdminShell />}>
          <Route path="*" element={<FarmsProbe />} />
        </Route>
      </Routes>,
      { queryClient: makeTestQueryClient() }
    );

    expect(await screen.findByText('org A farm')).toBeInTheDocument();
    const farmCallsBefore = adapter.requests.filter((r) => r.url.includes('/farms')).length;

    await userEvent.click(await screen.findByRole('button', { name: /Active organization/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: new RegExp(ORG_B_NAME) }));

    const farmCalls = () => adapter.requests.filter((r) => r.url.includes('/farms'));
    await waitFor(() => expect(farmCalls().length).toBeGreaterThan(farmCallsBefore));

    // The refetch goes out as the NEW org...
    expect(farmCalls().at(-1)?.headers['X-Active-Org-Id']).toBe(ORG_B);
    // ...and org A's farm is off the screen while it is in flight.
    expect(screen.queryByText('org A farm')).not.toBeInTheDocument();
  });

  it('switching sends the NEXT request under the NEW org, not the previous one', async () => {
    /*
     * THE CROSS-TENANT PROPERTY, AND IT IS NOT THEORETICAL.
     *
     * The axios interceptor reads the org from a module-scoped snapshot that
     * ActiveOrgProvider refreshes in an effect. Purge the cache too early and
     * the refetch goes out with the PREVIOUS org's header while the query key
     * already says the new one — org A's answer filed under org B's name.
     */
    const adapter = serve(TWO_MEMBERSHIPS);
    signIn({ display_name: 'Test Admin' });
    renderShell();

    await screen.findByRole('button', { name: /Active organization/ });
    const before = adapter.requests.length;

    await userEvent.click(screen.getByRole('button', { name: /Active organization/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: new RegExp(ORG_B_NAME) }));

    expect(localStorage.getItem('admin.active-org.v1')).toBe(ORG_B);
    await waitFor(() => expect(adapter.requests.length).toBeGreaterThan(before));
    expect(adapter.requests[adapter.requests.length - 1].headers['X-Active-Org-Id']).toBe(ORG_B);
  });
});

describe('the shortcut badges are gone (D4, founder 2026-08-31)', () => {
  it('advertises no key binding that does not exist', async () => {
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();
    await screen.findByText(ORG_A_NAME);

    for (const lie of ['⌘1', '⌘2', '⌘F', 'Ctrl 1', 'Ctrl 2', 'Ctrl F']) {
      expect(screen.queryByText(lie)).not.toBeInTheDocument();
    }
    expect(shellCode).not.toContain('shortcut');
  });

  it('keeps the Cmd-K hint, because Cmd-K is real', async () => {
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();
    await screen.findByText(ORG_A_NAME);

    // CommandPalette.tsx:39-49 binds metaKey OR ctrlKey, so either label is
    // truthful; which one shows depends on the keyboard in front of the admin.
    expect(screen.getByText(/^(⌘K|Ctrl K)$/)).toBeInTheDocument();
  });
});

describe('the sidebar (A53, A58)', () => {
  it('renders six groups and twelve destinations', async () => {
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();
    await screen.findByText(ORG_A_NAME);

    const sidebar = screen.getByRole('complementary', { name: 'Sections' });
    for (const group of ['Overview', 'Operations', 'Product', 'Farms', 'Schedules', 'Admin']) {
      expect(within(sidebar).getByText(group)).toBeInTheDocument();
    }
    expect(within(sidebar).getAllByRole('link')).toHaveLength(12);
  });

  it('marks exactly one item current, and Home is not current on /farms (A58)', async () => {
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell({ route: '/farms' });
    await screen.findByText(ORG_A_NAME);

    // `end` on the Home link is what stops `/` matching every route. Without
    // it the sidebar claims two current screens at once.
    const current = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('All Farms');
  });

  /* ═══════════════════════════════════════ A53, WHICH IS NO LONGER EMPTY ══ */

  /**
   * THIS TEST USED TO ASSERT A STRING IN THE SOURCE, and that was the right
   * test while the slot rendered nothing: a capability that produces no DOM
   * can only be proved from the file. Task 26 populated it from the
   * should-call-today count, so the source assertion is retired in favour of
   * the behaviour it was standing in for. Both halves of the register line are
   * still proved — the slot renders, and it renders nothing when there is
   * nothing to report.
   */
  it('renders the should-call-today count on the Home item (A53)', async () => {
    serveWatchlists({
      suffering: [sufferingRow('11111111-1111-1111-1111-111111111111', 'Wagholi Grapes')],
      churn: [
        churnRow('22222222-2222-2222-2222-222222222222', 'Ozar Onion'),
        /* The SAME farm on both watchlists. One call, one row, one count —
           if the badge said 3 the union would be a concatenation. */
        churnRow('11111111-1111-1111-1111-111111111111', 'Wagholi Grapes'),
      ],
    });
    signIn({ display_name: 'Test Admin' });
    renderShell();
    await screen.findByText(ORG_A_NAME);

    await waitFor(() => expect(homeBadge()).not.toBeNull());
    const badge = homeBadge()!;
    expect(badge).toHaveTextContent('2');
    /* A coloured pill with a bare number beside "Home" is undecodable. */
    expect(badge).toHaveTextContent('2 farms need a person today');
  });

  it('renders no badge at all when both watchlists are empty (A53)', async () => {
    serveWatchlists({ suffering: [], churn: [] });
    signIn({ display_name: 'Test Admin' });
    renderShell();
    await screen.findByText(ORG_A_NAME);

    /* A measured zero is a finding and it belongs on the screen the badge
       points at, where there is room to say what was checked and when. A "0"
       pill in the sidebar would be that finding with its reasoning removed. */
    await waitFor(() => {
      expect(homeBadge()).toBeNull();
    });
  });

  it('renders no badge when the reader may not read either watchlist (A53)', async () => {
    /* `serve()` grants no modules at all. The two feeds are never requested,
       so there is no list to count — which is a different fact from an empty
       one, and the pill cannot tell them apart, so it shows neither. */
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();
    await screen.findByText(ORG_A_NAME);

    await waitFor(() => {
      expect(homeBadge()).toBeNull();
    });
    /* And it asked for nothing it was not entitled to. Home is the one screen
       with no route guard, so a denial here would invalidate the cached scope
       and re-ask in a loop (App.tsx's QueryCache.onError). */
    const asked = stub!.requests.map((r) => r.url);
    expect(asked.some((url) => url.includes('/farms/suffering'))).toBe(false);
    expect(asked.some((url) => url.includes('/farms/silent-churn'))).toBe(false);
  });

  it('renders no badge while a watchlist it is entitled to has not answered (A53)', async () => {
    /* A count that silently dropped a whole watchlist is worse than no count,
       and a pill has no room to say "at least". */
    serveWatchlists({ suffering: [], churn: [], churnPending: true });
    signIn({ display_name: 'Test Admin' });
    renderShell();
    await screen.findByText(ORG_A_NAME);

    await waitFor(() => {
      expect(homeBadge()).toBeNull();
    });
  });

  it('shows the breadcrumb for the current route (A58)', async () => {
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell({ route: '/ops/errors' });
    expect(await screen.findByText('Ops / Errors')).toBeInTheDocument();
  });
});

describe('sign out (B3, A13)', () => {
  it('is in the shell — an admin on a working screen can now leave', async () => {
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();

    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    await userEvent.click(signOut);

    expect(authStore.get()).toBeNull();
  });

  it('empties this tab of the previous admin, not just of their permissions', async () => {
    /*
     * `logout()` removes ONLY the scope query. Farm lists, users and farmer
     * names would sit in the cache of a shared browser for another 60 seconds
     * (App.tsx staleTime), where the next sign-in reads them before a refetch.
     */
    serve();
    signIn({ display_name: 'Test Admin' });
    const { queryClient } = renderShell();

    await screen.findByText(ORG_A_NAME);
    queryClient.setQueryData(['farms', 'list', 1], { rows: ['a previous admin’s farms'] });

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(queryClient.getQueryData(['farms', 'list', 1])).toBeUndefined();
  });

  it('leaves the /403 sign-out in place — a denied admin still needs one', () => {
    // A13. The shell's control is an ADDITION; the console had exactly one
    // sign-out anywhere and /403 is outside the shell by design.
    signIn({ display_name: 'Test Admin' });
    renderWithProviders(<ForbiddenPage />);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});

describe('manual refresh and the freshness chip (B14)', () => {
  it('refetches what THIS screen is subscribed to', async () => {
    const adapter = serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();

    await screen.findByText(ORG_A_NAME);
    expect(adapter.requests).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh this screen' }));

    await waitFor(() => expect(adapter.requests).toHaveLength(2));
  });

  it('states an age only when it has one', async () => {
    // A chip over a request that has never returned is the D5 defect: a
    // freshness claim with no reading behind it.
    stub = installAdapter(neverSettles);
    signIn({ display_name: 'Test Admin' });
    renderShell();

    expect(await screen.findByRole('button', { name: /Refresh/ })).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
  });

  it('states the age once real data has arrived', async () => {
    serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();

    expect(await screen.findByText(/^Live · \d+s ago$/)).toBeInTheDocument();
  });
});

describe('the toast host (B15 — slot only)', () => {
  it('is mounted, polite, and empty', async () => {
    serve();
    signIn({ display_name: 'Test Admin' });
    const { container } = renderShell();
    await screen.findByText(ORG_A_NAME);

    const host = container.querySelector('[data-toast-host]');
    expect(host).toBeInTheDocument();
    expect(host).toHaveAttribute('aria-live', 'polite');
    // An aria-live region has to be in the DOM BEFORE its first message, or
    // the message is not reliably announced. Empty is the correct state, and
    // it registers nothing: no write endpoint exists to announce yet.
    expect(host?.childElementCount).toBe(0);
  });
});
