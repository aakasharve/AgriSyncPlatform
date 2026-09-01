import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import App from '@/App';
import { ModuleKeys } from '@/lib/moduleKeys';
import { authStore } from '@/lib/auth';
import { installAdapter, type CapturedRequest, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * TASK 11 — the whole gate, rendered.
 *
 * `routes.contract.test.ts` reads the route table as data and proves the map
 * is right. It cannot prove that a person can get through it. This file mounts
 * the REAL `<App />` — real BrowserRouter, real providers, real guards, real
 * lazy pages, real axios interceptors with only the transport stubbed — and
 * walks the three journeys that decide whether someone sees data they should
 * not, or is locked out of data they should:
 *
 *   1. a bookmarked, filtered url survives a sign-in (Steps 6 + 7);
 *   2. the three deliberately ungated routes really do open (Step 4);
 *   3. a guard still bites, and a server 403 still corrects a stale scope.
 *
 * None of it is visible in a screenshot, and the v3 prototype has no auth at
 * all, so a design-led port rebuilds every line of it from imagination.
 *
 * ── WAIT, and why it is not 5 seconds any more (Task 12) ──────────────────
 * Every waiter in this file asked for `{ timeout: 5_000 }` while the TEST it
 * ran inside also had five seconds — Vitest's default. A waiter that is
 * allowed exactly as long as the whole test can never be honoured: the test
 * dies first, reporting a timeout instead of the element it could not find.
 * It passed only because this machine was fast enough, and it stopped passing
 * the moment Task 12 added two more whole-console files to run alongside it.
 *
 * `vitest.config.ts` now allows a test twenty seconds and explains why; these
 * waiters take fifteen of them, so the waiter is the thing that reports.
 */
const WAIT = 15_000;

const SESSION = {
  accessToken: 'token-123',
  refreshToken: null,
  userId: '00000000-0000-0000-0000-0000000000aa',
  expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
};

type Module = { key: string; canRead: boolean; canWrite: boolean; canExport: boolean };

function readOnly(...keys: string[]): Module[] {
  return keys.map((key) => ({ key, canRead: true, canWrite: false, canExport: false }));
}

function scopeBody(modules: Module[]) {
  return {
    outcome: 'Resolved',
    scope: {
      userId: SESSION.userId,
      orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      orgType: 'FPO',
      orgRole: 'Owner',
      isPlatformAdmin: false,
      modules,
    },
    memberships: [],
  };
}

const envelope = (data: unknown) => ({
  data,
  meta: { source: 'live', window: '24h', lastRefreshedUtc: new Date().toISOString(), ttlSeconds: 60 },
});

const emptyList = envelope({ items: [], totalCount: 0, page: 1, pageSize: 40 });

interface ServerOptions {
  modules?: Module[];
  /** Status for every data endpoint that is not /me/scope or the login POST. */
  dataStatus?: number;
  dataBody?: unknown;
}

/**
 * One transport for the whole console. Only the wire is stubbed — both axios
 * interceptors, both guards and every hook run for real.
 */
function server({ modules = [], dataStatus = 200, dataBody = emptyList }: ServerOptions = {}) {
  return installAdapter(async (req: CapturedRequest) => {
    if (req.url.includes('/admin/me/scope')) return { status: 200, data: scopeBody(modules) };
    if (req.url.includes('/user/auth/login')) {
      return { status: 200, data: { ...SESSION, refreshToken: 'refresh-1' } };
    }
    /* The templates feed is a RAW array, not an envelope, and its path changed
       in Task 24 — `/reference/schedule-templates`, not the
       `/reference-data/crop-schedule-templates` the console used to 404 on. */
    if (req.url.includes('/reference/schedule-templates')) return { status: 200, data: [] };
    return { status: dataStatus, data: dataBody };
  });
}

/**
 * App.tsx builds ONE QueryClient at module scope, so its cache outlives a
 * test. Reading it off the element tree needs no production change: `App()`
 * calls no hooks (routes.contract.test.ts relies on the same fact) and
 * QueryClientProvider is the root.
 */
function appQueryClient(): QueryClient {
  const tree = App() as ReactElement;
  return (tree.props as { client: QueryClient }).client;
}

function at(): string {
  return window.location.pathname + window.location.search;
}

function go(url: string) {
  window.history.replaceState({}, '', url);
}

async function signIn() {
  await userEvent.type(
    await screen.findByLabelText('Phone number', undefined, { timeout: WAIT }),
    '8888888888',
  );
  await userEvent.type(screen.getByLabelText('Password'), 'Testuser@123');
  await userEvent.click(screen.getByRole('button', { name: /Sign in/ }));
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  appQueryClient().clear();
});

describe('a deep link survives the sign-in it triggered (A9, B2, Step 6)', () => {
  it('comes back to the FULL url — path AND query — after signing in', async () => {
    // `?page=7&tier=B` is not decoration. It is which page of which filtered
    // view. Storing location.pathname alone, which is what RequireAuth did
    // before this task, returns the user to page one of everything and looks
    // like it worked.
    stub = server({ modules: readOnly(ModuleKeys.FarmsList) });
    go('/farms?page=7&tier=B');

    render(<App />);

    // Signed out: the guard sent us to /login and kept where we were going.
    await screen.findByRole('button', { name: /Sign in/ }, { timeout: WAIT });
    expect(at()).toBe('/login');

    await signIn();

    await waitFor(() => expect(at()).toBe('/farms?page=7&tier=B'), { timeout: WAIT });
    expect(
      await screen.findByRole('heading', { name: 'All Farms' }, { timeout: WAIT }),
    ).toBeInTheDocument();
  });

  it('carries ?org= back too — the parameter that decides whose data it is', async () => {
    // ActiveOrgProvider writes the org with a raw history.replaceState the
    // router never sees (Task 12 closes that). Until it does, returning a
    // multi-org admin to a url without its org silently shows them a
    // DIFFERENT ORGANISATION'S rows and nothing on screen says so.
    const org = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    stub = server({ modules: readOnly(ModuleKeys.AdminUsers) });
    go(`/users?page=2&org=${org}`);

    render(<App />);
    await signIn();

    await waitFor(() => expect(at()).toBe(`/users?page=2&org=${org}`), { timeout: WAIT });
  });

  it('sends someone who asked for nothing in particular to the home page', async () => {
    stub = server();
    go('/login');

    render(<App />);
    await signIn();

    await waitFor(() => expect(at()).toBe('/'), { timeout: WAIT });
  });
});

describe('a token that expires mid-session keeps the deep link (A11, Step 7)', () => {
  it('routes to /login through the router and returns to the exact url afterwards', async () => {
    // The old code called window.location.assign('/login'): a full reload,
    // and a reload cannot carry router state, so the url died on the way to
    // the login form. The redirect-loop guard is kept — see the 401 tests in
    // api.contract.test.ts, which pin it and the hard fallback.
    authStore.set(SESSION);
    stub = server({ modules: readOnly(ModuleKeys.AdminUsers), dataStatus: 401, dataBody: {} });
    go('/users?page=4&search=ram');

    render(<App />);

    // The users query 401s; the interceptor clears the session and the bridge
    // navigates — no reload.
    await screen.findByRole('button', { name: /Sign in/ }, { timeout: WAIT });
    expect(at()).toBe('/login');
    expect(localStorage.getItem('admin.session.v1')).toBeNull();

    stub.restore();
    stub = server({ modules: readOnly(ModuleKeys.AdminUsers) });
    await signIn();

    await waitFor(() => expect(at()).toBe('/users?page=4&search=ram'), { timeout: WAIT });
  });
});

describe('the three deliberately ungated routes really do open (A4, Step 4)', () => {
  /*
   * A tidy-minded port adds a guard to these "for consistency" and locks every
   * user out of Schedules and Settings PERMANENTLY, because no ModuleKey
   * exists that would let anyone back in. routes.contract.test.ts proves no
   * guard is declared; this proves the console can actually be used.
   *
   * The scope below grants ZERO modules on purpose. If any of these three ever
   * acquires a gate, the scope that opens them here is exactly the scope that
   * would be turned away.
   */
  it.each([
    ['/', 'Ops Now'],
    ['/schedules/templates', 'Schedule Templates'],
    ['/settings/admins', 'Admin Users'],
  ])('%s opens for a resolved scope with no modules at all', async (route, heading) => {
    authStore.set(SESSION);
    stub = server({ modules: [] });
    go(route);

    render(<App />);

    expect(await screen.findByText(heading, { selector: 'h1, h3' }, { timeout: WAIT })).toBeInTheDocument();
    expect(at()).toBe(route);
  });

  it('and a GUARDED route still turns that same scope away', async () => {
    // Without this, the test above would also pass if every guard in the
    // console had been deleted.
    authStore.set(SESSION);
    stub = server({ modules: [] });
    go('/farms');

    render(<App />);

    expect(await screen.findByText('403 · Access denied', undefined, { timeout: WAIT })).toBeInTheDocument();
  });
});

describe('RequireScope tells a broken CHECK apart from a denial (Step 3)', () => {
  it('a 500 on /admin/me/scope lands on /403 saying the check failed, not that access was denied', async () => {
    // Three of RequireScope's outcomes have no url of their own and appear in
    // no screenshot. This is the one that used to lie: an unreachable resolver
    // produced a page headed "403 · Access denied", telling an admin their
    // access had been taken away while the server was merely down.
    authStore.set(SESSION);
    stub = installAdapter(async () => ({ status: 500, data: {} }));
    go('/farms');

    render(<App />);

    expect(
      await screen.findByRole(
        'heading',
        { name: 'We could not check your access' },
        { timeout: WAIT },
      ),
    ).toBeInTheDocument();
    expect(at()).toBe('/403');
  });
});

describe('a server 403 corrects a stale client scope (Step 8)', () => {
  it('re-asks /admin/me/scope when the server contradicts the cached grants', async () => {
    // The console gates on a scope cached for 60 seconds. If a grant is
    // revoked, the cache keeps saying yes. The typed denial is the signal that
    // the cache is wrong; re-asking closes the window from a minute to one
    // request.
    authStore.set(SESSION);
    stub = server({
      modules: readOnly(ModuleKeys.AdminUsers),
      dataStatus: 403,
      dataBody: { code: 'admin_module_forbidden', moduleKey: ModuleKeys.AdminUsers },
    });
    go('/users');

    render(<App />);

    const scopeCalls = () => stub!.requests.filter((r) => r.url.includes('/admin/me/scope')).length;

    await waitFor(() => expect(scopeCalls()).toBeGreaterThan(1), { timeout: WAIT });
  });

  it('does NOT re-ask when the failure is a plain 500 — that is not a denial', async () => {
    authStore.set(SESSION);
    stub = server({ modules: readOnly(ModuleKeys.AdminUsers), dataStatus: 500, dataBody: {} });
    go('/users');

    render(<App />);

    await screen.findByRole('heading', { name: 'Users' }, { timeout: WAIT });
    // Let the query's single retry land, so this is a real observation rather
    // than a race the assertion happened to win.
    await new Promise((r) => setTimeout(r, 1_500));

    expect(stub.requests.filter((r) => r.url.includes('/admin/me/scope'))).toHaveLength(1);
  });
});
