import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles } from '@/test/stubAdapter';
import type { StubbedAdapter } from '@/test/stubAdapter';
import type { SilentChurnItem } from '@/hooks/useFarms';
import SilentChurnPage from '../SilentChurnPage';

/**
 * SILENT CHURN — the watchlist, and the farms it is not allowed to count.
 *
 * The central assertion of this file is the HOLD-OUT, and it is the first
 * describe block for that reason. Everything else on this screen is a variant
 * of something Task 14 already proved; the hold-out is the one idea that is
 * new, and it is the one a screenshot cannot show — a farm that has never
 * logged looks identical to a farm that stopped, right up until the console
 * tells an operator to phone it about a silence that was never measured.
 */

const ORG = '11111111-1111-1111-1111-111111111111';

function row(over: Partial<SilentChurnItem> = {}): SilentChurnItem {
  return {
    farmId: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: 'भोसले मळा',
    ownerPhone: '9876543210',
    plan: 'trial',
    weeksSilent: 3,
    lastLogAt: '2026-08-04T09:00:00Z',
    ...over,
  };
}

const LAST_REFRESHED = '2026-09-01T08:30:00.000Z';

/** The real envelope: `AdminMetaDto("materialized", "current", …, 300)`
 *  (`GetSilentChurnHandler.cs:15-16`), over a RAW ARRAY — this endpoint has
 *  no items/totalCount wrapper and no pages. */
function envelope(items: SilentChurnItem[]) {
  return {
    data: items,
    meta: {
      source: 'materialized',
      window: 'current',
      lastRefreshedUtc: LAST_REFRESHED,
      ttlSeconds: 300,
    },
  };
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serve(items: SilentChurnItem[]) {
  stub = installAdapter(async () => ({ status: 200, data: envelope(items) }));
  return stub;
}

function renderChurn(route = `/farms/silent-churn?org=${ORG}`) {
  return renderWithProviders(<SilentChurnPage />, { route });
}

function table() {
  return screen.getByRole('table', { name: 'Silent churn watchlist' });
}

/** The list's own subtree. The screen carries two more `role="status"`
 *  blocks — the hold-out panel and the standing note — so an unscoped
 *  `getByRole('status')` would be ambiguous rather than wrong. */
function list(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-list="silent-churn"]')!;
}

function stateBlock(role: 'status' | 'alert' = 'status'): HTMLElement {
  return within(list()).getByRole(role);
}

/** The visible data rows — the detail rows carry an id and are excluded. */
function dataRows(): HTMLTableRowElement[] {
  return [...table().querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter(
    (tr) => !tr.id.includes('detail'),
  );
}

function cellsOf(tr: HTMLTableRowElement): HTMLTableCellElement[] {
  return [...tr.querySelectorAll('td')];
}

/** The farm-name cell of every visible row, in DOM order. */
function order(): string[] {
  return dataRows().map((tr) => cellsOf(tr)[0]?.textContent?.trim() ?? '');
}

/** The summary line the screen computes. `getNodeText` joins only DIRECT text
 *  nodes, so this matches the paragraph and not its ancestors. */
function summaryLine(): string {
  return screen.getByText(/Longest silence/).textContent ?? '';
}

/** The panel that holds farms out of the watchlist. */
function holdOut(): HTMLElement {
  return screen.getByText('Too new to judge').closest('[data-state]') as HTMLElement;
}

async function summaryAppears() {
  await screen.findByText(/Longest silence/);
}

/** Open the rows. The v3 summary-first gate STAYS on this screen. */
async function showAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Show all/ }));
}

/* ════════════════════════════════════ STEP 3 — the "too new to judge" hold-out */

describe('a farm with no last log is held OUT of the watchlist (Step 3)', () => {
  /**
   * Three farms. Two have a last log and can be measured. The third has none
   * and carries `weeksSilent: 99` — a number the server computed from
   * nothing, which is precisely why it must not be believed.
   *
   * Put that row back in the watchlist and this fixture produces three
   * separate lies at once: the worst silence on the platform becomes 99
   * weeks, the watchlist grows by one, and a farm that has never started
   * appears on a list headed "stopped recording work".
   */
  const FIXTURE = [
    row({ farmId: 'stopped-long', name: 'Long Silence', weeksSilent: 9, lastLogAt: '2026-06-28T09:00:00Z' }),
    row({ farmId: 'stopped-short', name: 'Short Silence', weeksSilent: 3, lastLogAt: '2026-08-04T09:00:00Z' }),
    row({ farmId: 'never-logged', name: 'Never Logged', weeksSilent: 99, lastLogAt: null }),
  ];

  it('does not count it as a long silence, does not list it, and names it separately', async () => {
    const user = userEvent.setup();
    serve(FIXTURE);
    renderChurn();
    await summaryAppears();

    /*
     * ASSERTED FIRST, ON PURPOSE. If the partition goes, this is the line that
     * goes red, and its message names the defect rather than a missing
     * paragraph: the console would be reporting the longest silence on the
     * platform as 99 weeks, taken from a farm that has never logged at all and
     * therefore has no silence to measure.
     */
    expect(
      summaryLine(),
      'a farm with NO LAST LOG was counted as a long silence — its weeksSilent was computed from nothing, and it is now the worst figure on the screen',
    ).toContain('Longest silence 9 weeks');

    /* Two measurable farms, not three. */
    expect(
      screen.getByText('2 farms'),
      'the watchlist count includes a farm that has never logged — "never started" and "logged and stopped" are different farmers',
    ).toBeInTheDocument();

    /* And it is not among the rows, in any sort order. */
    await showAll(user);
    expect(order()).toEqual(['Long Silence', 'Short Silence']);

    /* Held OUT is not the same as thrown away: it is named, with the two
       values it genuinely has, and with no week number beside it. */
    expect(within(holdOut()).getByText('Never Logged')).toBeInTheDocument();
    expect(within(holdOut()).getByText('never')).toBeInTheDocument();
    expect(within(holdOut()).queryByText(/99/)).toBeNull();
  });

  it('never prints the word "Never" into a watchlist cell, the way the old screen did', async () => {
    const user = userEvent.setup();
    serve(FIXTURE);
    renderChurn();
    await summaryAppears();
    await showAll(user);

    /*
     * The line this replaces:
     *   {f.lastLogAt ? format(new Date(f.lastLogAt),'dd MMM yyyy') : 'Never'}
     * One column, one list, one word covering two facts. "Never" in a Last Log
     * cell of a SILENCE watchlist reads as "silent for ever" — the strongest
     * possible version of exactly the wrong claim.
     */
    expect(screen.queryByText('Never')).toBeNull();
    expect(within(table()).queryByText('Never Logged')).toBeNull();
  });

  it('reports the number of held-out farms as NOT MEASURED, never as zero', async () => {
    /* No held-out rows in this fixture — and the panel still does not say 0.
       The feed cannot see never-logged farms at all: the matview INNER JOINs
       farms to their most recent log, so a farm with none is dropped before
       the list is built. "0 farms are too new to judge" would be a
       measurement this console has never taken. */
    serve([row()]);
    renderChurn();
    await summaryAppears();

    const panel = holdOut();
    /* ASSERTED FIRST — a printed zero is the defect, and a missing sentence
       is only the symptom. */
    expect(
      panel.textContent,
      'the hold-out panel printed a COUNT of never-logged farms. This feed cannot see them at all: the matview inner-joins farms to their most recent log, so a farm with no log is dropped before the list is built. A zero here is a measurement this console has never taken',
    ).not.toMatch(/\b0 farms\b/);
    expect(panel).toHaveAttribute('data-state', 'unmeasured');
    expect(within(panel).getByText(/not measured here/)).toBeInTheDocument();
    expect(within(panel).getByText(/it is not zero/)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════ STEP 4 — outreach, said plainly */

describe('every expanded row says outreach is not measured (Step 4)', () => {
  it('says "Last contacted — not measured" and does not soften it', async () => {
    const user = userEvent.setup();
    serve([row({ farmId: 'f1', name: 'Long Silence', weeksSilent: 9 })]);
    renderChurn();
    await summaryAppears();
    await showAll(user);

    await user.click(dataRows()[0]);

    /*
     * THE SOFTENINGS ARE ASSERTED FIRST, AND THEY ARE THE POINT. "No recent
     * contact" and "Not contacted" both claim we LOOKED. We do not record
     * outreach anywhere, so an operator reading either could ring a farmer
     * their colleague phoned an hour ago — misled by the console rather than
     * by the data. Checking the correct wording first would report a missing
     * string; checking these first names the sentence that replaced it.
     */
    expect(
      screen.queryByText(/no recent contact/i),
      'the outreach line was softened into "no recent contact" — that claims this product looked for a call, and it has never recorded one',
    ).toBeNull();
    expect(
      screen.queryByText(/not contacted/i),
      'the outreach line was softened into "not contacted" — an absent record is not a call that did not happen',
    ).toBeNull();

    const term = screen.getByText('Last contacted');
    const value = term.nextElementSibling as HTMLElement;
    expect(within(value).getByText('not measured')).toBeInTheDocument();
    expect(screen.getByText(/never as a call that did not happen/)).toBeInTheDocument();
  });
});

/* ════════════════════════════════ STEP 2 / D9 — four causes, not one */

describe('an absence names its cause (D9, Step 2)', () => {
  it('renders a 500 as a failure with a retry — and NOT as "0 farms" over a shut list', async () => {
    const user = userEvent.setup();
    stub = installAdapter(async () => ({ status: 500, data: {} }));
    renderChurn();

    await screen.findByRole('alert');

    /*
     * ASSERTED FIRST. This screen is summary-first, so every figure in the
     * summary is computed from `rows` — and `rows` is `[]` over a 500. A
     * collapsed watchlist therefore used to headline "0 farms" with the
     * `LoadFailed` block sealed inside a `hidden` container. On THIS screen
     * "0 farms silent" is the best possible news, which makes it the worst
     * possible thing to print over a broken endpoint.
     */
    expect(
      screen.queryByText('0 farms'),
      'a 500 rendered as "0 farms" — the summary reported a measurement it never took, and the failure block was hidden behind a collapsed list',
    ).toBeNull();

    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    expect(screen.getByText(/Request failed with status code 500/)).toBeInTheDocument();
    /* The string this screen used to render over a 500. */
    expect(screen.queryByText('No farms in silent churn')).toBeNull();

    const before = stub.requests.length;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(stub!.requests.length).toBeGreaterThan(before));
  });

  it('renders a TIMEOUT as its own failure, not as an empty watchlist', async () => {
    stub = installAdapter(async () => {
      throw Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' });
    });
    renderChurn();

    await screen.findByRole('alert');
    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    /* A timeout has no HTTP status, so it reaches `formatError` as a plain
       Error. It must still say what happened rather than fall through to the
       empty state. */
    expect(screen.getByText(/timeout of 20000ms exceeded/)).toBeInTheDocument();
    expect(screen.queryByText(/measured zero/)).toBeNull();
  });

  it('renders a 403 as a PERMISSION fact, distinct from both a 500 and an empty list', async () => {
    stub = installAdapter(async () => ({
      status: 403,
      data: { code: 'admin_module_forbidden', moduleKey: 'farms.silent-churn' },
    }));
    renderChurn();

    await screen.findByRole('alert');
    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    /* Typed by the response interceptor into `AdminModuleForbiddenError` and
       named by `describeAdminDenial` — never the raw code, and never "the
       system is healthy". */
    expect(screen.getByText('Your admin access does not include this screen.')).toBeInTheDocument();
    expect(screen.queryByText(/status code 403/)).toBeNull();
  });

  it('renders a GENUINE empty as a measured zero that names its window', async () => {
    serve([]);
    renderChurn();

    // COPY CORRECTED 2026-09-01 — see FarmsListPage.test.tsx. The endpoint takes
    // no org parameter, so "in this organisation" was a scope claim the feed
    // does not honour.
    await screen.findByText('No farm this feed returns has stopped logging');
    expect(stateBlock()).toHaveAttribute('data-state', 'measured-zero');
    /* The window is the SERVER's `meta.lastRefreshed`, never a `new Date()`
       computed at render — that is the D5 fabricated-freshness defect. */
    expect(screen.getByText(/The window was checked at 01 Sep 26/)).toBeInTheDocument();
    /* A measured zero is honest and IS shown as a figure: the summary may say
       zero here, because here the request succeeded. */
    expect(screen.getByText('0 farms')).toBeInTheDocument();
  });

  it('shows a skeleton shaped like this table while the first request is in flight (B12)', async () => {
    stub = installAdapter(neverSettles);
    renderChurn();

    const loading = await screen.findByRole('status', { name: 'Loading Silent churn watchlist' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('tbody > tr')).toHaveLength(8);
    expect(loading.querySelectorAll('tbody > tr')[0].querySelectorAll('td')).toHaveLength(5);
    /* Same rule as the 500: no summary figures before there is an answer. */
    expect(screen.queryByText('0 farms')).toBeNull();
  });
});

/* ═════════════════════ the summary-first gate, and what this endpoint is not */

describe('the v3 summary-first gate stays on this screen', () => {
  it('opens on the summary, opens the rows on Show all, and has no pager', async () => {
    const user = userEvent.setup();
    serve([
      row({ farmId: 'a', name: 'Long Silence', weeksSilent: 9, lastLogAt: '2026-06-28T09:00:00Z' }),
      row({ farmId: 'b', name: 'Short Silence', weeksSilent: 3 }),
    ]);
    renderChurn();
    await summaryAppears();

    /* Task 14 dropped this gate on All Farms because that screen has no
       facets to read first. Here the counts ARE the answer and the rows are
       the follow-up, so it stays. */
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('2 farms')).toBeInTheDocument();

    await showAll(user);
    /* Longest first, the server's own order — restored on the client because
       weeks are floored and the sort must not depend on that. */
    expect(order()).toEqual(['Long Silence', 'Short Silence']);

    /*
     * NO PAGINATION, and it is not an omission. `useSilentChurn` fetches the
     * whole list (`useFarms.ts`, no page argument) because the endpoint has no
     * page parameter — the server sends the 50 longest silences and stops
     * (`AdminMisRepository.cs`, `LIMIT 50`). A pager here would be a control
     * with nothing behind it.
     */
    expect(screen.queryByRole('navigation', { name: /pagination/ })).toBeNull();
    expect(stub!.requests.filter((r) => r.url.includes('silent-churn'))).toHaveLength(1);
    expect(stub!.requests[0].url).not.toContain('page=');
  });

  it('states the rule it applies, in the terms the query actually uses (A57)', async () => {
    serve([row()]);
    renderChurn();
    await summaryAppears();

    /*
     * The old subtitle: "Paid farms with WVFD = 0 for 2+ consecutive weeks."
     * Three of its four clauses are false against the matview — the status
     * filter is Trialing/Active/PastDue, the signal is a missing
     * `log.created` event and not WVFD, and the threshold is 14 days. A57
     * records this line as the ONLY place the rule is stated on screen, so it
     * is preserved — as a true sentence.
     */
    expect(screen.getByText(/no log for more than 14 days/)).toBeInTheDocument();
    expect(screen.getByText(/trialing, active or past-due subscription/)).toBeInTheDocument();
    expect(screen.queryByText(/WVFD/)).toBeNull();
    /* The cap, which the old screen never mentioned: a reader seeing 50 rows
       had no way to know 50 was a ceiling and not a count. */
    expect(screen.getByText(/50 longest and no more/)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════ STEP 5 — cross-filtered facet counts */

describe('the facets (Step 5)', () => {
  const FIXTURE = [
    row({ farmId: 'a', name: 'Nine', weeksSilent: 9, plan: 'trial' }),
    row({ farmId: 'b', name: 'Six', weeksSilent: 6, plan: 'trial' }),
    row({ farmId: 'c', name: 'Three', weeksSilent: 3, plan: 'pro' }),
    row({ farmId: 'd', name: 'Two', weeksSilent: 2, plan: 'pro' }),
  ];

  function optionsOf(group: string): string[] {
    return [...within(screen.getByRole('group', { name: group })).getAllByRole('button')].map(
      (b) => b.getAttribute('aria-label') ?? '',
    );
  }

  it('cross-filters every count, so a button says what pressing it would give', async () => {
    const user = userEvent.setup();
    serve(FIXTURE);
    renderChurn();
    await summaryAppears();

    expect(optionsOf('Filter by silence')[0]).toBe('8 weeks or more, 1 farm');

    await user.click(screen.getByRole('button', { name: /^pro,/ }));

    /*
     * CROSS-FILTERED (Step 5, and v3 does the same here — `pass(f, g.key)`,
     * `silent-churn.html:389`). With the pro plan applied, no farm is eight
     * weeks silent, so the button reads 0. Without cross-filtering it would
     * still read 1 and would hand the reader an empty list from a button that
     * promised a row.
     */
    expect(
      optionsOf('Filter by silence')[0],
      'the silence counts ignored the plan filter — a button promising 1 farm now yields none',
    ).toBe('8 weeks or more, 0 farms');
    expect(order()).toEqual(['Three', 'Two']);
  });

  it('fixes the silence bands longest-first, not in count order', async () => {
    serve(FIXTURE);
    renderChurn();
    await summaryAppears();

    /*
     * `facetOptionsFrom` orders by count, which here would put "2 to 4 weeks"
     * (2 farms) first. On a watchlist that is the wrong way round: an operator
     * reads longest-first, and options that reshuffle as counts move are
     * unusable. The band order is fixed in the screen for that reason (v3
     * `BAND_ORDER`), and this fixture is built so the two orders differ.
     */
    expect(optionsOf('Filter by silence')).toEqual([
      '8 weeks or more, 1 farm',
      '5 to 7 weeks, 1 farm',
      '2 to 4 weeks, 2 farms',
    ]);
    /* "Under 2 weeks" holds nothing and is not shipped — the matview's 14-day
       floor makes it unreachable, and a band with no rows is not a filter. */
    expect(optionsOf('Filter by silence')).toHaveLength(3);
  });

  it('drops the plan filter entirely when every farm is on the same plan', async () => {
    /* One option holding 100% of the rows is a control that filters nothing —
       the reason Task 14 shipped no facets at all on All Farms, where `plan`
       is the SQL literal `'trial'`. Here `plan_code` is a real column, so the
       filter ships when, and only when, the data has more than one value. */
    serve(FIXTURE.map((f) => ({ ...f, plan: 'trial' })));
    renderChurn();
    await summaryAppears();

    expect(screen.queryByRole('group', { name: 'Filter by plan' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Filter by silence' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════ the cells, and the search */

describe('the cells', () => {
  it('renders the three phone shapes, the Marathi font and the churn date format', async () => {
    const user = userEvent.setup();
    /* Three rows, one mount: the suite pays one page render instead of three. */
    serve([
      row({ farmId: 'p1', name: 'भोसले मळा', ownerPhone: '9876543210', weeksSilent: 9 }),
      row({ farmId: 'p2', name: 'Plain Farm', ownerPhone: '98******10', weeksSilent: 6 }),
      row({ farmId: 'p3', name: '**redacted**', ownerPhone: '—', weeksSilent: 3 }),
    ]);
    renderChurn();
    await summaryAppears();
    await showAll(user);

    /* A34 — the font is chosen per VALUE. `vitest.config.ts` sets
       `css: false`, so an inline fontFamily is the only assertable evidence. */
    const marathi = within(cellsOf(dataRows()[0])[0]).getByText('भोसले मळा');
    expect(marathi).toHaveAttribute('data-script', 'devanagari');
    expect(marathi.style.fontFamily).toContain('Noto Sans Devanagari');

    /* B16 — the frontend half. This endpoint does NOT redact today
       (`GetSilentChurnHandler` never calls `IResponseRedactor`), so these
       three shapes are what must already work the day the server switches
       masking on — and the literal marker must never reach the DOM. */
    const phone = (i: number) => cellsOf(dataRows()[i])[1];
    expect(within(phone(0)).getByText('9876543210')).toHaveAttribute('data-masked', 'none');
    expect(within(phone(1)).getByText('98******10')).toHaveAttribute('data-masked', 'partial');
    /* `COALESCE(u.phone, '—')` sends a literal em dash. A bare dash is the one
       thing `NotMeasured` exists to forbid. */
    expect(within(phone(2)).getByText('not measured')).toBeInTheDocument();
    expect(screen.queryByText('**redacted**')).toBeNull();
    expect(within(cellsOf(dataRows()[2])[0]).getByText('p3')).toHaveAttribute(
      'data-masked',
      'redacted',
    );

    /* A51 — `dd MMM yyyy` here, deliberately not the `dd MMM` on All Farms: a
       silence measured in weeks needs the year. */
    expect(cellsOf(dataRows()[0])[4].textContent).toBe('04 Aug 2026');
    expect(cellsOf(dataRows()[0])[3].textContent).toBe('9w');
  });

  it('finds a Devanagari farm from a romanised phone-call spelling', async () => {
    const user = userEvent.setup();
    serve([
      row({ farmId: 'a', name: 'भोसले मळा', weeksSilent: 9 }),
      row({ farmId: 'b', name: 'Zebra Farm', weeksSilent: 3 }),
    ]);
    renderChurn();
    await summaryAppears();

    /* A support person HEARS "Bhosale" on the call and types it in Latin
       letters. Without the romanised index the search compares Latin against
       Devanagari and the call ends in "I cannot find you." A typed search is
       also one of the three ways the list opens. */
    await user.type(screen.getByRole('textbox', { name: 'Search the watchlist' }), 'bhosale{Enter}');
    expect(order()).toEqual(['भोसले मळा']);

    expect(screen.getByText(/Showing/).textContent).toContain('1 of 2 farms');
  });

  it('says what the box actually searches when nothing matches', async () => {
    serve([row()]);
    renderChurn(`/farms/silent-churn?org=${ORG}&search=nagar`);
    await screen.findByText(/Nothing matches/);

    expect(stateBlock()).toHaveAttribute('data-state', 'no-match');
    /* v3's own copy on this screen promises village; village is not on this
       endpoint. Explaining a miss with a reason that is not the reason is the
       same defect as an unqualified empty. */
    expect(screen.getByText(/Village and crop are not in this feed/)).toBeInTheDocument();
  });
});
