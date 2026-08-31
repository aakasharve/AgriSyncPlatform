import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { CommandPalette } from '@/app/CommandPalette';
import { DRILLDOWN_MODULE, DRILLDOWN_PATH, NAV } from '@/app/nav';
import { EntitlementGuard } from '@/components/EntitlementGuard';
import { ModuleKeys } from '@/lib/moduleKeys';
import { authStore } from '@/lib/auth';
import type { FarmSummary } from '@/hooks/useFarms';
import type { UserSummary } from '@/hooks/useUsers';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type CapturedRequest, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * TASK 13 — the command palette, v2.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is the first one: the palette must not be
 * reachable before sign-in. Everything else here is about usefulness; that one
 * is about whether a farmer's name and phone number can be read by someone who
 * has not signed in. It is written so that MOVING THE COMPONENT BACK OUTSIDE
 * `RequireAuth` — where it lived until this task — turns it red while printing
 * the exposed name. Verified by doing exactly that (Task 13 verification 4).
 *
 * The stubbed server here is deliberately HOSTILE: it answers `/me/scope` with
 * a resolved scope and hands farm rows to anybody who asks. That models the
 * case a client-side gate is actually for — a stale or replayed token, or
 * simply a server that is not meant to be the last line of defence — and it is
 * what makes the mutation go red on the PII itself rather than only on a
 * dialog appearing.
 */

/**
 * COUNTED, NOT REPLACED.
 *
 * `searchKey` is the expensive half of the index. The mock DELEGATES to the
 * real implementation and only counts calls, so every romanisation assertion
 * below runs against the real algorithm while the memoisation assertion can
 * still see how often it ran. `vi.mock` is hoisted above the imports, so the
 * counter is hoisted with it.
 */
const { countSearchKey } = vi.hoisted(() => ({ countSearchKey: vi.fn() }));
vi.mock('@/lib/searchKey', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/searchKey')>();
  return {
    ...actual,
    searchKey: (s: string | null | undefined) => {
      countSearchKey(s);
      return actual.searchKey(s);
    },
  };
});

/* ═══════════════════════════════════════════════════════ the fixtures */

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
  meta: { source: 'live', window: '24h', lastRefreshed: '2026-08-31T06:00:00Z', ttlSeconds: 60 },
});

function farm(over: Partial<FarmSummary> & { farmId: string }): FarmSummary {
  return {
    name: 'A Farm',
    ownerPhone: '9800000000',
    plan: 'Pro',
    wvfd7d: 4,
    engagementTier: 'A',
    errors24h: 0,
    lastLogAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function person(over: Partial<UserSummary> & { userId: string }): UserSummary {
  return {
    phone: '9800000001',
    displayName: 'A Person',
    email: null,
    apps: [],
    createdAt: '2026-01-01T00:00:00Z',
    lastLoginAt: null,
    ...over,
  };
}

/** कांबळे — the surname a support person hears as "Kamble" on a phone call. */
const KAMBLE = farm({ farmId: 'farm-kamble', name: 'कांबळे', ownerPhone: '9812345678' });
const ANAND = farm({ farmId: 'farm-anand', name: 'Anand Farm', ownerPhone: '9899999999' });
/** The server withheld the name; the phone came back partly masked. */
const WITHHELD = farm({ farmId: 'farm-hidden', name: '**redacted**', ownerPhone: '98******12' });
/** Nothing on this row is visible to this reader at all. */
const INVISIBLE = farm({ farmId: 'farm-dark', name: '**redacted**', ownerPhone: '**redacted**' });

const SHINDE = person({ userId: 'user-shinde', displayName: 'शिंदे', phone: '9822222222' });

interface ServerOptions {
  modules?: Module[];
  farms?: FarmSummary[];
  /** The server's own total. Defaults to the number of rows handed back. */
  farmsTotal?: number;
  users?: UserSummary[];
  farmsStatus?: number;
}

/**
 * One transport for the whole console. Only the wire is stubbed — both axios
 * interceptors, both guards and every hook run for real.
 */
function server({
  modules = [],
  farms = [],
  farmsTotal,
  users = [],
  farmsStatus = 200,
}: ServerOptions = {}): StubbedAdapter {
  return installAdapter(async (req: CapturedRequest) => {
    if (req.url.includes('/admin/me/scope')) return { status: 200, data: scopeBody(modules) };
    if (req.url.includes('/user/auth/login')) {
      return { status: 200, data: { ...SESSION, refreshToken: 'refresh-1' } };
    }
    /* The drilldown lives on a DIFFERENT prefix (A26) and answering it 404
       lets that page reach its own not-found state instead of throwing. */
    if (req.url.includes('/admin/farmer-health/')) return { status: 404, data: {} };
    if (req.url.includes('/admin/users')) {
      return {
        status: 200,
        data: envelope({ items: users, totalCount: users.length, page: 1, pageSize: 50 }),
      };
    }
    if (req.url.includes('/admin/farms')) {
      return {
        status: farmsStatus,
        data: envelope({
          items: farms,
          totalCount: farmsTotal ?? farms.length,
          page: 1,
          pageSize: 40,
        }),
      };
    }
    if (req.url.includes('crop-schedule-templates')) return { status: 200, data: [] };
    return { status: 200, data: envelope({ items: [], totalCount: 0, page: 1, pageSize: 40 }) };
  });
}

/** App.tsx builds ONE QueryClient at module scope, so its cache outlives a test. */
function appQueryClient(): QueryClient {
  const tree = App() as ReactElement;
  return (tree.props as { client: QueryClient }).client;
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  countSearchKey.mockClear();
  appQueryClient().clear();
});

/* ═══════════════════════════════════════════════════════ the keyboard */

/** The handler is registered on `window`, so the event is dispatched there. */
function press(key: string, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  fireEvent.keyDown(window, { key, ...mods });
}

const cmdK = () => press('k', { ctrlKey: true });

/** Let the scope round trip and the two list round trips actually land. */
async function settle(ms = 100) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function go(url: string) {
  window.history.replaceState({}, '', url);
}

function at(): string {
  return window.location.pathname + window.location.search;
}

function palette(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Search the console' });
}

function noPalette() {
  return screen.queryByRole('dialog', { name: 'Search the console' });
}

function options(): HTMLElement[] {
  return within(palette()).queryAllByRole('option');
}

function optionText(): string[] {
  return options().map((o) => o.textContent ?? '');
}

function box(): HTMLElement {
  return within(palette()).getByRole('combobox');
}

/**
 * Signs in, renders the REAL console at `route`, and waits for the SHELL.
 *
 * Waiting for the sidebar rather than for a fixed number of milliseconds is
 * load-bearing: the palette is mounted inside `RequireScope`, so until the
 * scope round trip lands there is no keydown listener at all and Cmd-K does
 * nothing. A fixed wait passed alone and failed under the full suite, where
 * twenty-eight files compete for the same cores — the same lesson Task 12
 * wrote into `vitest.config.ts`.
 */
async function mountConsole(route: string, options_: ServerOptions) {
  stub = server(options_);
  authStore.set(SESSION);
  go(route);
  render(<App />);
  await screen.findByRole('complementary', { name: 'Sections' });
  await settle();
}

/** Opens the palette and waits for it, rather than assuming it opened. */
async function openPalette() {
  cmdK();
  await screen.findByRole('dialog', { name: 'Search the console' });
  await settle();
}

/** Waits for a row to be IN the index. The entity queries fly after the
 *  dialog mounts, so "the palette is open" and "the farms have arrived" are
 *  two different moments and only the second one can be asserted on. */
async function indexed(text: string) {
  await waitFor(() => expect(optionText().some((t) => t.includes(text))).toBe(true));
}

/* ═════════════════════════════ THE ONE THAT MATTERS: pre-auth exposure */

describe('the palette is not reachable before sign-in (A46, Task 13 Step 2)', () => {
  it('opens nothing on the sign-in screen, and puts no farm name, owner or phone one keystroke from it', async () => {
    stub = server({ modules: readOnly(ModuleKeys.FarmsList), farms: [KAMBLE] });
    authStore.clear();
    go('/login');
    render(<App />);
    await screen.findByLabelText('Phone number');

    cmdK();
    await settle();

    /* THE EXPOSURE FIRST, so the red message is the farmer's name rather than
       a structural fact about a dialog. Moving this component back outside
       RequireAuth makes the next two lines fail with कांबळे and 9812345678
       rendered on the sign-in screen. */
    expect(screen.queryByText('कांबळे')).not.toBeInTheDocument();
    expect(screen.queryByText('9812345678')).not.toBeInTheDocument();
    expect(noPalette()).not.toBeInTheDocument();
    /* And it asked the server NOTHING. An anonymous keystroke that fires
       `/admin/me/scope` is already the first half of the leak, even on a day
       when the server happens to refuse the second half. */
    expect(stub.requests.map((r) => r.url)).toEqual([]);
  });

  it('opens nothing on /403 either — the other route outside the shell', async () => {
    stub = server({ modules: readOnly(ModuleKeys.FarmsList), farms: [KAMBLE] });
    authStore.clear();
    go('/403');
    render(<App />);
    await settle();

    cmdK();
    await settle();

    expect(noPalette()).not.toBeInTheDocument();
    expect(screen.queryByText('कांबळे')).not.toBeInTheDocument();
  });

  it('opens on a signed-in screen, so it is the gate that closed it and not a broken shortcut', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [KAMBLE] });

    await openPalette();

    expect(palette()).toBeInTheDocument();
    await indexed('कांबळे');
  });
});

/* ═══════════════════════════════════════ the scope filter (A46, B16) */

describe('every entry is filtered through canRead (A46, B16)', () => {
  it('offers NOTHING that would bounce to /403 when the scope grants no module at all', async () => {
    await mountConsole('/', { modules: [], farms: [KAMBLE], users: [SHINDE] });

    await openPalette();

    /* What is left is exactly the three routes App.tsx leaves ungated on
       purpose (A4) — and they are ungated because no ModuleKey exists that
       would let anyone back in, so none of them can 403. */
    expect(options()).toHaveLength(3);
    for (const open of ['Home', 'Templates', 'Settings']) {
      expect(within(palette()).getByText(open)).toBeInTheDocument();
    }
    for (const gated of [
      'Live Health',
      'API Errors',
      'Voice Pipeline',
      'WVFD',
      'All Farms',
      'Silent Churn',
      'Suffering',
      'Farmer Health',
      'Users',
    ]) {
      expect(within(palette()).queryByText(gated)).not.toBeInTheDocument();
    }
  });

  it('never asks the server for names or phones the scope says the reader may not see', async () => {
    await mountConsole('/', { modules: [], farms: [KAMBLE], users: [SHINDE] });
    const before = stub!.requests.length;

    await openPalette();

    const asked = stub!.requests.slice(before).map((r) => r.url);
    expect(asked.some((u) => u.includes('/admin/farms'))).toBe(false);
    expect(asked.some((u) => u.includes('/admin/users'))).toBe(false);
  });

  it('adds a destination back as soon as its module is readable', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.OpsErrors) });

    await openPalette();

    expect(within(palette()).getByText('API Errors')).toBeInTheDocument();
    expect(within(palette()).queryByText('Live Health')).not.toBeInTheDocument();
  });

  it('lists no entity while the scope is still unresolved — canRead fails closed', async () => {
    /* A scope request that never answers. `canRead` returns false for every
       key until it lands (useAdminScope.ts:86) and the palette inherits
       that default rather than optimistically showing rows. */
    stub = installAdapter(async (req: CapturedRequest) => {
      if (req.url.includes('/admin/me/scope')) return new Promise(() => {});
      return {
        status: 200,
        data: envelope({ items: [KAMBLE], totalCount: 1, page: 1, pageSize: 40 }),
      };
    });
    renderWithProviders(<CommandPalette />);

    await openPalette();

    expect(screen.queryByText('कांबळे')).not.toBeInTheDocument();
    expect(stub.requests.some((r) => r.url.includes('/admin/farms'))).toBe(false);
  });
});

/* ═══════════════ the map the filter uses agrees with the real guards */

describe('the palette gates on the same map the router does (A3)', () => {
  interface P {
    children?: ReactNode;
    element?: ReactNode;
    path?: string;
    module?: string;
  }
  const propsOf = (e: ReactElement) => e.props as P;

  function flatten(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
    if (Array.isArray(node)) {
      for (const child of node) flatten(child, out);
      return out;
    }
    if (!isValidElement(node)) return out;
    const element = node as ReactElement;
    out.push(element);
    const props = propsOf(element);
    if (props.children !== undefined) flatten(props.children, out);
    if (props.element !== undefined) flatten(props.element, out);
    return out;
  }

  const routes = flatten(App() as ReactElement).filter((e) => e.type === Route);

  function guardFor(path: string): string | null {
    const route = routes.find((r) => propsOf(r).path === path);
    expect(route, `no route declared for ${path}`).toBeDefined();
    const guard = flatten(propsOf(route as ReactElement).element).find(
      (e) => e.type === EntitlementGuard,
    );
    return guard ? (propsOf(guard).module ?? null) : null;
  }

  it.each(NAV.map((n) => [n.to, n.label] as const))(
    'nav.ts gives %s (%s) the module key App.tsx actually guards it with',
    (to) => {
      /* This is what stops the palette's filter drifting away from the guard
         it mirrors. A key changed in one place and not the other would turn a
         palette entry into a /403 — silently, and only for the admins who
         lack it, which is the population least able to report it. */
      expect(NAV.find((n) => n.to === to)?.module ?? null).toBe(guardFor(to));
    },
  );

  it('gates the per-farm drilldown on the same key as its landing page', () => {
    expect(DRILLDOWN_MODULE).toBe(guardFor(`${DRILLDOWN_PATH}/:farmId`));
    expect(DRILLDOWN_MODULE).toBe(guardFor(DRILLDOWN_PATH));
  });
});

/* ══════════════════════════════ the destinations that were missing (Step 3) */

describe('the destinations the old palette did not have (Step 3)', () => {
  it('offers Farmer Health, which was absent from the palette entirely', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmerHealth), farms: [KAMBLE] });

    await openPalette();

    /* `getByText` would find two: the nav destination AND the group label on
       the drilldown rows below it. The nav entry is the one that was missing,
       so it is the one addressed by id. */
    const navEntry = options().find((o) => o.id === 'cmdk-nav:/farmer-health');
    expect(navEntry).toBeDefined();
    expect(navEntry).toHaveTextContent('Farmer Health');
  });

  it('offers the per-farm drilldown, addressed by farm id so the url carries no name', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmerHealth), farms: [KAMBLE] });

    await openPalette();
    await indexed('Farmer-health drilldown');
    await userEvent.type(box(), 'kamble');

    const drilldown = options().find((o) => o.textContent?.includes('Farmer-health drilldown'));
    expect(drilldown).toBeDefined();

    await userEvent.click(drilldown as HTMLElement);
    await settle();

    expect(at()).toBe('/farmer-health/farm-kamble');
  });
});

/* ═══════════════════════════ the phone call: romanised search (Step 5) */

describe('a Marathi surname is findable by its Latin spelling, through the real palette', () => {
  it('finds कांबळे when the operator types "kamble"', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [ANAND, KAMBLE] });

    await openPalette();
    await indexed('कांबळे');
    await userEvent.type(box(), 'kamble');

    expect(optionText().some((t) => t.includes('कांबळे'))).toBe(true);
    expect(optionText().some((t) => t.includes('Anand Farm'))).toBe(false);
  });

  it('finds a PERSON the same way — शिंदे typed as "shinde"', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.AdminUsers), users: [SHINDE] });

    await openPalette();
    await indexed('शिंदे');
    await userEvent.type(box(), 'shinde');

    expect(optionText().some((t) => t.includes('शिंदे'))).toBe(true);
  });

  it('finds a farm by its owner phone as well as by its name', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [ANAND, KAMBLE] });

    await openPalette();
    await indexed('कांबळे');
    await userEvent.type(box(), '98123');

    expect(optionText().some((t) => t.includes('कांबळे'))).toBe(true);
  });

  it('builds the romanised index ONCE across a burst of typing, not per keystroke', async () => {
    /*
     * THE MEASURED CONSTRAINT, carried from Task 8 rather than re-derived:
     * ~0.4 ms to scan the index, ~60-100 ms to BUILD it over 3,000 rows. A
     * rebuild inside a keystroke handler turns an instant search into a laggy
     * one, and a laggy box makes people retype.
     *
     * `searchKey` is COUNTED, not stubbed, so this measures the real thing.
     */
    await mountConsole('/', {
      modules: readOnly(ModuleKeys.FarmsList, ModuleKeys.AdminUsers),
      farms: [ANAND, KAMBLE, WITHHELD],
      users: [SHINDE],
    });

    await openPalette();
    await indexed('शिंदे');

    const afterBuild = countSearchKey.mock.calls.length;
    expect(afterBuild).toBeGreaterThan(0); // it really did build one

    await userEvent.type(box(), 'kambl');
    expect(countSearchKey.mock.calls.length).toBe(afterBuild);

    await userEvent.type(box(), 'e');
    expect(countSearchKey.mock.calls.length).toBe(afterBuild);
  });
});

/* ═══════════════════════════════ the deep link, ported not invented */

describe('the deep link seeds the destination and opens it on the row (Step 1)', () => {
  async function jumpToKamble() {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [KAMBLE] });
    await openPalette();
    await indexed('कांबळे');
    await userEvent.type(box(), 'kamble');
    await userEvent.click(options()[0]);
    await settle();
  }

  it('carries the farm name in ?search — the param the destination actually reads', async () => {
    await jumpToKamble();

    /* v3 writes `all-farms.html?q=<farm>` (app.js:723). `q` is read by nothing
       in this console; `search` is what `FarmsListPage.tsx:17` reads today and
       what `useListUrlState` commits its draft into. */
    expect(at()).toBe(`/farms?search=${encodeURIComponent('कांबळे')}`);
  });

  it('seeds the destination search box from the url, exactly as the prototype does', async () => {
    await jumpToKamble();

    /* `app.js:705-707` — `var seed = AS.param('q'); if (seed) input.value =
       seed;`. `FarmsListPage.tsx:19` already does the same with `search`,
       which is why that is the param this palette emits. */
    expect(screen.getByPlaceholderText(/Search by name/)).toHaveValue('कांबळे');
  });

  it('hands the term to the SERVER, so the destination lands on the row and not the summary', async () => {
    await jumpToKamble();

    const lastFarms = stub!.requests.filter((r) => r.url.includes('/admin/farms')).pop();
    expect(lastFarms?.url).toContain(`search=${encodeURIComponent('कांबळे')}`);
  });

  it('offers a way to ask the server when the first page is not enough', async () => {
    /* The palette holds ONE page. "Nothing matches" over a partial index with
       no way forward is the silent-failure shape this redesign exists to
       remove, so a typed query always also offers the server's own search —
       which sees every page. */
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [ANAND] });

    await openPalette();
    await indexed('Anand Farm');
    await userEvent.type(box(), '9876500000');
    await userEvent.click(within(palette()).getByText(/Search all farms for/));
    await settle();

    expect(at()).toBe('/farms?search=9876500000');
  });
});

/* ══════════════════════════════════ redaction: printed, and indexed */

describe('a withheld value is neither printed nor indexed (A14, B16)', () => {
  it('never prints the redaction marker, and falls back to the farm id', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [WITHHELD] });

    await openPalette();
    await indexed('farm-hidden');

    expect(palette().textContent).not.toContain('**redacted**');
    expect(within(palette()).getByText('farm-hidden')).toBeInTheDocument();
  });

  it('does not make a withheld name searchable — the marker is not in the haystack', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [ANAND, WITHHELD] });

    await openPalette();
    await indexed('farm-hidden');
    await userEvent.type(box(), 'redacted');

    /* Indexing the marker would turn "the server refused to tell you this
       person's name" into "type `redacted` to list everyone whose name you
       were denied". */
    expect(optionText().some((t) => t.includes('farm-hidden'))).toBe(false);
  });

  it('keeps a partly masked phone visible AND searchable — an operator can match the last digits', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [WITHHELD] });

    await openPalette();
    await indexed('farm-hidden');
    await userEvent.type(box(), '98**');

    expect(optionText().some((t) => t.includes('farm-hidden'))).toBe(true);
  });

  it('never sends a masked value to the server as a search term', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [WITHHELD] });

    await openPalette();
    await indexed('farm-hidden');
    await userEvent.click(options().at(-1) as HTMLElement);
    await settle();

    /* `98******12` matches nothing through a server LIKE, so the jump would
       look broken. The row still goes somewhere — the plain list. */
    expect(at()).toBe('/farms');
  });

  it('does not list a row with nothing visible on it at all', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.FarmsList), farms: [ANAND, INVISIBLE] });

    await openPalette();
    await indexed('Anand Farm');

    expect(optionText().some((t) => t.includes('farm-dark'))).toBe(false);
  });
});

/* ═════════════════════════════════════ honesty about what it searched */

describe('it says what it searched, and never reports a broken source as empty', () => {
  it('names the scope of the index with the server’s own total', async () => {
    await mountConsole('/', {
      modules: readOnly(ModuleKeys.FarmsList),
      farms: [ANAND, KAMBLE],
      farmsTotal: 900,
    });

    await openPalette();

    /* Two rows in hand out of nine hundred. A bare "2 farms" would tell an
       operator the console looked at everything. */
    await waitFor(() =>
      expect(palette().textContent).toContain('the first 2 of 900 farms'),
    );
  });

  it('says the farm index BROKE instead of listing no farms', async () => {
    await mountConsole('/', {
      modules: readOnly(ModuleKeys.FarmsList),
      farms: [KAMBLE],
      farmsStatus: 500,
    });

    cmdK();
    /* The app's own QueryClient retries once (App.tsx:34-42), so the failure
       is two round trips plus a back-off away — not one tick. */
    await waitFor(
      () => expect(within(palette()).getByText(/load the farm index/)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
  });

  it('says nothing matched, and names what it searched over, instead of an empty panel', async () => {
    await mountConsole('/', { modules: [] });

    await openPalette();
    await userEvent.type(box(), 'zzzz');

    expect(within(palette()).getByText(/Nothing matches/)).toBeInTheDocument();
    expect(palette().textContent).toContain('Searched 3 screens');
  });
});

/* ══════════════════════════════════════ D4 — the bindings that exist */

describe('the keyboard, and only the keys that are real (D4, founder 2026-08-31)', () => {
  it('opens on Cmd-K and on Ctrl-K, and closes on Escape', async () => {
    await mountConsole('/', { modules: [] });

    press('k', { metaKey: true });
    await settle();
    expect(palette()).toBeInTheDocument();

    press('Escape');
    await settle();
    expect(noPalette()).not.toBeInTheDocument();

    await openPalette();
    expect(palette()).toBeInTheDocument();
  });

  it('binds nothing to Cmd-1, Cmd-2 or Cmd-F — Task 10 removed the badges that advertised them', async () => {
    await mountConsole('/', { modules: readOnly(ModuleKeys.OpsLive, ModuleKeys.FarmsList) });

    for (const key of ['1', '2', 'f']) {
      press(key, { metaKey: true });
      press(key, { ctrlKey: true });
    }
    await settle();

    /* The sidebar advertised ⌘1 / ⌘2 / ⌘F and nothing bound them. The founder
       chose REMOVE over implement, so the answer to all six of these is that
       the console does not move. */
    expect(at()).toBe('/');
    expect(noPalette()).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════ the ordinary interactions */

describe('selecting a destination', () => {
  function Where() {
    const location = useLocation();
    return <div data-testid="where">{location.pathname + location.search}</div>;
  }

  function renderPalette(modules: Module[]) {
    stub = server({ modules });
    return renderWithProviders(
      <>
        <CommandPalette />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
      { queryClient: makeTestQueryClient() },
    );
  }

  it('navigates and closes on Enter', async () => {
    renderPalette(readOnly(ModuleKeys.OpsErrors));
    await openPalette();

    await userEvent.type(box(), 'API Errors');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await settle();

    expect(screen.getByTestId('where')).toHaveTextContent('/ops/errors');
    expect(noPalette()).not.toBeInTheDocument();
  });

  it('moves the selection with the arrow keys', async () => {
    renderPalette(readOnly(ModuleKeys.OpsErrors, ModuleKeys.OpsLive));
    await openPalette();

    const selected = () =>
      options().findIndex((o) => o.getAttribute('aria-selected') === 'true');

    expect(selected()).toBe(0);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(selected()).toBe(1);
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(selected()).toBe(0);
  });

  it('closes when the backdrop is clicked', async () => {
    renderPalette([]);
    await openPalette();

    await userEvent.click(palette().parentElement as HTMLElement);
    expect(noPalette()).not.toBeInTheDocument();
  });
});
