import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles } from '@/test/stubAdapter';
import type { CapturedRequest, StubbedAdapter } from '@/test/stubAdapter';
import type { FarmSummary } from '@/hooks/useFarms';
import FarmsListPage from '../FarmsListPage';

/**
 * ALL FARMS — the first screen on `DataList`.
 *
 * Everything asserted here is behaviour a screenshot cannot show: a click that
 * does nothing, a header that names the wrong thing, a count with no scope, a
 * 500 rendered as good news, and a page-2 request that must reach the server.
 *
 * Each test drives the REAL page through the REAL axios interceptor chain
 * (`stubAdapter` swaps the transport, not the module), so the request the
 * server would receive is the request these assertions read.
 */

const ORG = '11111111-1111-1111-1111-111111111111';

/** The four values the plan's defects live on, and nothing else invented. */
function farm(over: Partial<FarmSummary> = {}): FarmSummary {
  return {
    farmId: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: 'भोसले मळा',
    ownerPhone: '9876543210',
    plan: 'trial',
    wvfd7d: 4.2,
    engagementTier: 'A',
    errors24h: 0,
    lastLogAt: '2026-08-24T09:00:00Z',
    createdAt: '2024-03-12T09:00:00Z',
    ...over,
  };
}

const LAST_REFRESHED = '2026-09-01T08:30:00.000Z';

function envelope(items: FarmSummary[], totalCount = items.length) {
  return {
    data: { items, totalCount, page: 1, pageSize: 40 },
    meta: {
      source: 'live-aggregated',
      window: 'current',
      lastRefreshed: LAST_REFRESHED,
      ttlSeconds: 60,
    },
  };
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

/** The default transport: every request answered with the same page. */
function serve(items: FarmSummary[], totalCount = items.length) {
  stub = installAdapter(async () => ({ status: 200, data: envelope(items, totalCount) }));
  return stub;
}

/** Reads the ROUTER's location, so a url assertion is about what the router
 *  saw rather than about jsdom's address bar. A `<span>`, not an `<output>`:
 *  `output` carries an implicit `status` role and would collide with every
 *  honest-state block asserted below. */
function Probe() {
  const location = useLocation();
  return <span data-testid="url">{location.pathname + location.search}</span>;
}

function url(): string {
  return screen.getByTestId('url').textContent ?? '';
}

function param(key: string): string | null {
  return new URLSearchParams(url().split('?')[1] ?? '').get(key);
}

/** `route` is the ONLY way a test sets the org (Task 12 moved the read onto
 *  `useSearchParams`; `window.history.replaceState` sets one nothing reads). */
function renderFarms(route = `/farms?org=${ORG}`) {
  return renderWithProviders(
    <>
      <FarmsListPage />
      <Probe />
    </>,
    { route },
  );
}

function table() {
  return screen.getByRole('table', { name: 'All farms' });
}

/** The list's own subtree. The screen carries a second `role="status"` — the
 *  standing note about what this feed does not carry — so an unscoped
 *  `getByRole('status')` would be ambiguous rather than wrong. */
function list(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-list="farms"]')!;
}

/** Whichever of the four causes the list is currently showing. */
function stateBlock(role: 'status' | 'alert' = 'status'): HTMLElement {
  return within(list()).getByRole(role);
}

/** The visible data rows — the detail rows carry an id and are excluded. */
function dataRows(): HTMLTableRowElement[] {
  return [...table().querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter(
    (tr) => !tr.id.includes('detail'),
  );
}

function cellsOf(row: HTMLTableRowElement): HTMLTableCellElement[] {
  return [...row.querySelectorAll('td')];
}

async function rowsAppear() {
  await screen.findByRole('table', { name: 'All farms' });
}

function lastFarmsRequest(): CapturedRequest {
  const hits = (stub?.requests ?? []).filter((r) => r.url.includes('/admin/farms'));
  return hits[hits.length - 1];
}

/* ══════════════════════════════════════════════════ D11 — the dead click */

describe('the row-click that went nowhere (D11)', () => {
  it('opens the row IN PLACE and navigates nowhere, and the pointer means it', async () => {
    const user = userEvent.setup();
    serve([farm()]);
    renderFarms();
    await rowsAppear();

    /* The other half of D11: the affordance and the behaviour have to agree.
       `ExpandableRow` adds `cursor-pointer`, `tabIndex` and `aria-expanded`
       only when the row actually expands, so a pointer can no longer sit on a
       row that does nothing. */
    expect(dataRows()[0].className).toContain('cursor-pointer');
    expect(dataRows()[0]).toHaveAttribute('aria-expanded', 'false');
    expect(dataRows()[0]).toHaveAttribute('tabindex', '0');

    await user.click(dataRows()[0]);

    /*
     * ASSERTED FIRST, ON PURPOSE. The old code called
     * `navigate('/farms/' + f.farmId)` and `/farms/:farmId` IS NOT A
     * REGISTERED ROUTE (`App.tsx:293-299`), so every click fell through the
     * catch-all and bounced silently to Home — under a table styled
     * `cursor-pointer` on every row. If this line goes red the message names
     * the route, which is the defect; putting the expansion check first would
     * have reported a missing paragraph instead.
     */
    expect(url(), 'the row navigated instead of expanding — /farms/:farmId is not registered, so this lands on Home').toBe(
      `/farms?org=${ORG}`,
    );
    expect(dataRows()[0]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Farm id')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════ the Owner column, and masking */

describe('the Owner column tells the truth about what is in it', () => {
  it('is headed for the value it holds, and renders all three phone shapes', async () => {
    /* Three rows, one mount: the three shapes are asserted side by side and
       the suite pays one page render instead of three. */
    serve([
      farm({ farmId: 'p1', ownerPhone: '9876543210' }),
      farm({ farmId: 'p2', ownerPhone: '98******10' }),
      farm({ farmId: 'p3', ownerPhone: '—' }),
    ]);
    renderFarms();
    await rowsAppear();

    /*
     * `FarmSummaryDto` (`FarmsAdminDto.cs:9-18`) carries the FARM's name and
     * the owner's PHONE. There is no owner name to render, and widening the
     * DTO is a backend change this plan does not make — so the header is what
     * changed. A header reading "Owner" over a phone number is the lie
     * CONTRACT.md Appendix 6 files against this screen.
     */
    expect(screen.getByRole('columnheader', { name: /Owner phone/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Owner$/ })).toBeNull();

    const owner = (i: number) => cellsOf(dataRows()[i])[1];

    /* Nothing withheld — shown as sent. */
    expect(within(owner(0)).getByText('9876543210')).toHaveAttribute('data-masked', 'none');
    /* Partly withheld and still usable — an operator can match the last two
       digits on a call — so it is shown, not swallowed, and the DOM says so. */
    expect(within(owner(1)).getByText('98******10')).toHaveAttribute('data-masked', 'partial');
    /* `COALESCE(u.phone, '—')` (`AdminMisRepository.cs:107`) and
       `r.IsDBNull(2) ? "—"` (`:136`) both send a literal em dash. A bare dash
       is the one thing `NotMeasured` exists to forbid: the reader supplies the
       reason, and the reason they supply is usually "zero". */
    expect(within(owner(2)).getByText('not measured')).toBeInTheDocument();
  });
});

describe('a withheld value is a permission fact, never a string (A14, B16)', () => {
  it('never prints the literal **redacted** marker into a cell', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-00000000000f';
    serve([farm({ farmId: id, name: '**redacted**', ownerPhone: '**redacted**' })]);
    renderFarms();
    await rowsAppear();

    /* The whole screen, not just the cell: the marker must not reach the DOM
       anywhere, including a title or a sub-line. */
    expect(screen.queryByText('**redacted**')).toBeNull();

    const [farmCell, ownerCell] = cellsOf(dataRows()[0]);
    /* The fallback identifies the ROW without naming the person. */
    expect(within(farmCell).getByText(id)).toHaveAttribute('data-masked', 'redacted');
    expect(within(ownerCell).getByText('hidden')).toBeInTheDocument();
  });

  it('renders a Marathi farm name in Noto Sans Devanagari (A34)', async () => {
    serve([farm({ name: 'भोसले मळा' })]);
    renderFarms();
    await rowsAppear();

    const name = within(cellsOf(dataRows()[0])[0]).getByText('भोसले मळा');
    expect(name).toHaveAttribute('data-script', 'devanagari');
    expect(name.style.fontFamily).toContain('Noto Sans Devanagari');
  });
});

/* ═════════════════════════════════════════════ A17 / B4 server pagination */

describe('server-side pagination at 40 per page (A17, B4)', () => {
  it('asks the SERVER for page 2 — the client never slices a full set', async () => {
    const user = userEvent.setup();
    /* Three rows in hand, 1,284 on the server. A client-side port either loads
       all 1,284 (fatal on a 2-vCPU box) or quietly loses page 2. */
    serve([farm({ farmId: 'a' }), farm({ farmId: 'b' }), farm({ farmId: 'c' })], 1284);
    renderFarms();
    await rowsAppear();

    expect(dataRows()).toHaveLength(3);
    expect(lastFarmsRequest().url).toContain('page=1&pageSize=40');
    /* 1,284 / 40 = 32.1 → 33. Derived from the SERVER's total, never from the
       rows in hand. */
    expect(screen.getByText(/Page 1 of 33/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next/ }));

    expect(param('page')).toBe('2');
    await waitFor(() => expect(lastFarmsRequest().url).toContain('page=2&pageSize=40'));
    /* Still three rows. Nothing was sliced client-side to produce them. */
    expect(dataRows()).toHaveLength(3);
  });

  it('hides the pager entirely when there is one page', async () => {
    serve([farm()], 1);
    renderFarms();
    await rowsAppear();

    expect(screen.queryByRole('navigation', { name: /pagination/ })).toBeNull();
  });

  it('states the scope of every count it computes, and only the total is bare', async () => {
    serve([farm({ farmId: 'a' }), farm({ farmId: 'b' }), farm({ farmId: 'c' })], 1284);
    renderFarms();
    await rowsAppear();

    /* "3 of 1,284 farms" — the 3 is scoped by the "of", and 1,284 is the
       server's own exact total, which is the one count on this screen that may
       stand unqualified. Indian grouping, through `fmt`. */
    const total = screen.getByText('1,284', { selector: 'b' });
    expect(total.parentElement?.textContent).toBe('3 of 1,284 farms');
    expect(
      screen.getByText(/Sorting a column orders the 3 farms on this page, not all 1,284/),
    ).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════════ B9 — the tier filter */

describe('the tier A/B/C/D filter is server-side and survives (B9)', () => {
  it('sends the tier to the server and resets the page, keeping the org (A18, A20)', async () => {
    const user = userEvent.setup();
    serve([farm()], 1284);
    renderFarms(`/farms?org=${ORG}&page=3`);
    await rowsAppear();

    await user.click(screen.getByRole('button', { name: 'Tier B' }));

    expect(param('tier')).toBe('B');
    /* A filter change that leaves the reader on page 3 shows an empty list for
       a filter that matched. */
    expect(param('page')).toBe('1');
    /* The functional updater, not the object form: `?org=` is the active
       tenant and dropping it reads one organisation's data under another's. */
    expect(param('org')).toBe(ORG);
    await waitFor(() => expect(lastFarmsRequest().url).toContain('tier=B'));
  });

  it('presses off again, and the second press clears the filter', async () => {
    const user = userEvent.setup();
    serve([farm()], 1284);
    renderFarms(`/farms?org=${ORG}&tier=B`);
    await rowsAppear();

    const chip = screen.getByRole('button', { name: 'Tier B' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    await user.click(chip);
    expect(param('tier')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════ A21 — the search box */

describe('the search box', () => {
  it('writes nothing to the url until Enter, then writes it TRIMMED', async () => {
    const user = userEvent.setup();
    serve([farm()], 1284);
    renderFarms();
    await rowsAppear();

    const box = screen.getByRole('textbox', { name: 'Search farms' });
    await user.type(box, '  anand  ');
    /* A21 — a draft. Syncing per keystroke would push one history entry and
       one server round trip per character. */
    expect(param('search')).toBeNull();

    await user.type(box, '{Enter}');

    /*
     * TRIM, decided 2026-08-31. Untrimmed, the space reached the server's
     * `LIKE '%anand  %'` and a farm that exists came back as "no results".
     * The box still shows what was typed; only the applied filter is tidied.
     */
    expect(param('search')).toBe('anand');
    expect((box as HTMLInputElement).value).toBe('  anand  ');
    await waitFor(() => expect(lastFarmsRequest().url).toContain('search=anand'));
    expect(lastFarmsRequest().url).not.toContain('search=+');
  });

  it('says what the server actually searches when nothing matches', async () => {
    /* The endpoint's WHERE clause is `LOWER(f.name) LIKE LOWER(@s)` and
       nothing else (`AdminMisRepository.cs:95,103`). v3's copy promises owner
       and phone too; repeating that promise here would explain a miss with a
       reason that is not the reason. */
    serve([], 0);
    renderFarms(`/farms?org=${ORG}&search=zzz`);
    await screen.findByText(/Nothing matches/);

    /* A SERVER-side search that matched nothing is a fact about the box you
       typed in, not a measured zero about the farms. */
    expect(stateBlock()).toHaveAttribute('data-state', 'no-match');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    expect(screen.getByText(/the owner and the phone number are not searched/)).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════ D9 — four causes, not one */

describe('an absence names its cause (D9)', () => {
  it('renders a 500 as a failure with a retry — not as "No farms found"', async () => {
    const user = userEvent.setup();
    stub = installAdapter(async () => ({ status: 500, data: {} }));
    renderFarms();

    await screen.findByRole('alert');
    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    /* The string this screen used to render over a 500. */
    expect(screen.queryByText('No farms found')).toBeNull();

    const before = stub.requests.length;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(stub!.requests.length).toBeGreaterThan(before));
  });

  it('names the window AND the tier when a filtered page really is empty', async () => {
    serve([], 0);
    renderFarms(`/farms?org=${ORG}&tier=D`);

    // COPY CORRECTED 2026-09-01: this said "in this organisation", which was FALSE.
    // GetFarmsListAsync(page, pageSize, search, tier, ct) takes no org parameter —
    // verified in IAdminMisRepository.cs. Neither do GetSilentChurnAsync nor
    // GetSufferingAsync. The org is in the query KEY (T12), which separates the
    // client cache; it is not in the QUERY, so the server returns the same rows
    // whichever org is active. Claiming a scope the feed does not apply is the
    // exact defect class this redesign exists to remove.
    await screen.findByText('No farm this feed returns is in tier D');
    expect(stateBlock()).toHaveAttribute('data-state', 'measured-zero');
    /* The window is the SERVER's `meta.lastRefreshed`, never a `new Date()`
       computed at render — that is the D5 fabricated-freshness defect. */
    expect(screen.getByText(/The window was checked at 01 Sep 26/)).toBeInTheDocument();
  });

  it('shows a skeleton shaped like this table while the first page loads (B12)', async () => {
    stub = installAdapter(neverSettles);
    renderFarms();

    const loading = await screen.findByRole('status', { name: 'Loading All farms' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('tbody > tr')).toHaveLength(8);
    expect(loading.querySelectorAll('tbody > tr')[0].querySelectorAll('td')).toHaveLength(7);
  });
});

/* ══════════════════════════════════════════════════════════════ A25 / B13 */

describe('a background refetch says so instead of changing the table silently', () => {
  it('swaps the row count for "Refreshing…" on a filter change, not on the first load', async () => {
    const user = userEvent.setup();
    let call = 0;
    stub = installAdapter(async () => {
      call += 1;
      if (call === 1) return { status: 200, data: envelope([farm()], 1284) };
      return neverSettles();
    });
    renderFarms();
    await rowsAppear();

    /* First load showed the skeleton, not the indicator. */
    expect(screen.queryByText('Refreshing…')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Tier B' }));

    /* `keepPreviousData`, narrowed to the org by `lib/orgQuery.ts`, holds the
       previous rows while the next page loads — so the reader needs telling
       that what they are looking at is being replaced. */
    expect(await screen.findByText('Refreshing…')).toBeInTheDocument();
    expect(dataRows()).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════ the cells, one at a time */

describe('the cells', () => {
  it('prints a measured zero as 0 and an unmeasured value as a grey word', async () => {
    serve([
      farm({ farmId: 'a', errors24h: 0, engagementTier: null, wvfd7d: null, lastLogAt: null }),
    ]);
    renderFarms();
    await rowsAppear();

    const [, , tier, wvfd, errors, lastLog] = cellsOf(dataRows()[0]);

    /* `{f.errors24h || '—'}` used to print a dash over a measured zero — D18
       pointing the other way. Zero errors in 24 hours is a reading. */
    expect(errors.textContent).toBe('0');
    /* A tier and a WVFD that have no row in the latest weekly aggregate are
       not a D tier and not a zero. */
    expect(within(tier).getByText('not measured')).toBeInTheDocument();
    expect(within(wvfd).getByText('not measured')).toBeInTheDocument();
    /* "never logged" and "logged and stopped" are different facts. */
    expect(within(lastLog).getByText('never')).toBeInTheDocument();
  });

  it('keeps the two per-surface date formats that differ on purpose (A51)', async () => {
    serve([farm({ lastLogAt: '2026-08-24T09:00:00Z', createdAt: '2024-03-12T09:00:00Z' })]);
    renderFarms();
    await rowsAppear();

    const [, , , , , lastLog, created] = cellsOf(dataRows()[0]);
    /* Day + month — "did this farm log recently". */
    expect(lastLog.textContent).toBe('24 Aug');
    /* Two-digit year — farms predate this year. */
    expect(created.textContent).toBe('12 Mar 24');
  });
});
