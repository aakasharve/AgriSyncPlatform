import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import type { MeScopeResponse } from '@/hooks/useAdminScope';
import FarmerHealthPage from '../FarmerHealthPage';
import { FarmerSearchBox } from '../components/FarmerSearchBox';
import type {
  CohortBucketDto,
  CohortPatternsDto,
  CohortPillarHeatmapDto,
  CohortScoreBinDto,
} from '../farmer-health.types';

/**
 * FARMER HEALTH — the landing. The claims here are the ones that are invisible
 * in a screenshot, and every central one is proved by breaking its source
 * rather than by asserting that some text is present.
 *
 * The five that would survive a careless rewrite unnoticed:
 *
 *  1. THE ENDPOINT PREFIX IS `/admin/farmer-health/`, NOT `/shramsafal/admin/`.
 *     Nothing on screen hints at it, so a tidy-up that centralises the admin
 *     prefix 404s both farmer-health screens. Asserted on the exact url the
 *     SCREEN produces, not only on the api module.
 *  2. THE RESPONSE HAS NO ENVELOPE. The old page read `data.data` off a bare
 *     DTO, got `undefined`, and drew an empty screen over a healthy 200. Both
 *     shapes are served here, and both must render rows.
 *  3. TWO LISTS, TWO SORT CONTRACTS. The queue sorts on four columns with a
 *     tiebreak and writes the url; the watchlist has a FIXED order and no sort
 *     controls at all. Proved by ordering, by the absence of the controls, and
 *     by sorting one list and re-reading the other.
 *  4. THE CROSS-SURFACE EMPTINESS SUM decides which of two empties the queue
 *     shows — and the term that decides it is the SCORE HISTOGRAM, not either
 *     list.
 *  5. THE SEARCH BOX DOES NOT QUERY ON A KEYSTROKE, and a miss does not take
 *     the page down with it.
 *
 * SETTLE_WAIT — measured 2026-09-01 by Task 19 and carried with its reason.
 * Under full-suite parallelism thirty-odd jsdom environments compete for the
 * same cores and a block has not always finished changing inside Testing
 * Library's 1000 ms default, so an assertion that a state is ABSENT can run
 * while the previous state is still on screen — a failure that reads like a
 * product defect and is not one. Nothing is weakened; a real regression still
 * fails, it just fails after waiting. `vitest.config.ts` is untouched.
 *
 * MOUNT BUDGET. Task 14 measured a timing cliff and Task 29 owns it; this file
 * is deliberately merged onto shared fixtures rather than split one claim per
 * test, and no assertion was dropped to do it.
 */

const SETTLE_WAIT = 15_000;

const ORG = '11111111-1111-1111-1111-111111111111';
const ORG_NAME = 'Nashik Grape FPO';

/* ═══════════════════════════════════════════════════════════ fixtures ════ */

function row(over: Partial<CohortBucketDto> & { farmId: string }): CohortBucketDto {
  return {
    farmerName: `Farmer ${over.farmId}`,
    score: 30,
    weeklyDelta: 0,
    lastActiveAt: '2026-08-25T09:00:00.0000000Z',
    ...over,
  };
}

/**
 * THE QUEUE FIXTURE IS BUILT TO KILL A MISSING TIEBREAK.
 *
 * `tie-old` is listed BEFORE `tie-new` and both score 12, so a sorter with no
 * tiebreak keeps them in that order (stable) and one with the product rule —
 * ties on `score` break by `lastActiveAt` DESCENDING — swaps them. The two
 * orders differ, which is what makes the assertion able to fail.
 */
const QUEUE: CohortBucketDto[] = [
  row({ farmId: 'tie-old', score: 12, lastActiveAt: '2026-08-20T09:00:00Z', weeklyDelta: -1 }),
  row({ farmId: 'tie-new', score: 12, lastActiveAt: '2026-08-30T09:00:00Z', weeklyDelta: -4 }),
  row({ farmId: 'worst', score: 5, lastActiveAt: '2026-08-25T09:00:00Z', weeklyDelta: -7 }),
];

/**
 * AND THE WATCHLIST FIXTURE IS BUILT TO KILL A MISSING FIXED SORT.
 *
 * Server order is `rising, falling-hard, falling-a-bit`. The fixed order is
 * `weeklyDelta` ASCENDING — biggest drop first — so the two differ.
 */
const WATCH: CohortBucketDto[] = [
  row({ farmId: 'w-rising', score: 55, weeklyDelta: 3 }),
  row({ farmId: 'w-falling-hard', score: 50, weeklyDelta: -9 }),
  row({ farmId: 'w-falling-bit', score: 45, weeklyDelta: -2 }),
];

function bins(counts: Partial<Record<string, number>>): CohortScoreBinDto[] {
  return [
    '0-10',
    '11-20',
    '21-30',
    '31-40',
    '41-50',
    '51-60',
    '61-70',
    '71-80',
    '81-90',
    '91-100',
  ].map((bucket) => ({ bucket, count: counts[bucket] ?? 0 }));
}

/** All six pillars, with `investment` carrying the placeholder 0 the server
 *  really sends. */
function pillars(): CohortPillarHeatmapDto[] {
  return [
    { pillar: 'triggerFit', avgScore: 6.4, failingFarmsCount: 1 },
    { pillar: 'actionSimplicity', avgScore: 14, failingFarmsCount: 0 },
    { pillar: 'proof', avgScore: 9.5, failingFarmsCount: 4 },
    { pillar: 'reward', avgScore: 3.2, failingFarmsCount: 2 },
    { pillar: 'investment', avgScore: 0, failingFarmsCount: 7 },
    { pillar: 'repeat', avgScore: 18, failingFarmsCount: 1 },
  ];
}

function cohort(over: Partial<CohortPatternsDto> = {}): CohortPatternsDto {
  return {
    scoreDistribution: bins({ '0-10': 2, '41-50': 1 }),
    interventionQueue: QUEUE,
    watchlist: WATCH,
    /* Tier C is deliberately ABSENT. The server always sends four today, and
       the client must still be able to draw the difference between a tier
       measured at zero and a tier with no reading at all. */
    engagementTierBreakdown: [
      { tier: 'A', count: 0 },
      { tier: 'B', count: 2 },
      { tier: 'D', count: 1 },
    ],
    pillarHeatmap: pillars(),
    /* 17 Aug is missing between two returned weeks — an interior hole, which
       is the only kind an axis with no clock can honestly show. */
    trendByWeek: [
      { weekStart: '2026-08-03', avgScore: 44, farmCount: 9 },
      { weekStart: '2026-08-10', avgScore: 51, farmCount: 9 },
      { weekStart: '2026-08-24', avgScore: 38, farmCount: 9 },
    ],
    farmerSufferingTop10: [],
    ...over,
  };
}

const EMPTY_COHORT: CohortPatternsDto = {
  scoreDistribution: bins({}),
  interventionQueue: [],
  watchlist: [],
  engagementTierBreakdown: [],
  pillarHeatmap: [],
  trendByWeek: [],
  farmerSufferingTop10: [],
};

function scopeBody(over: Partial<MeScopeResponse['scope']> = {}): MeScopeResponse {
  return {
    outcome: 'Resolved',
    scope: {
      userId: 'u1',
      orgId: ORG,
      orgType: 'FPO',
      orgRole: 'Owner',
      isPlatformAdmin: false,
      modules: [{ key: 'farmer.health', canRead: true, canWrite: false, canExport: false }],
      ...over,
    },
    memberships: [{ orgId: ORG, orgName: ORG_NAME, orgType: 'FPO', orgRole: 'Owner' }],
  };
}

/* ══════════════════════════════════════════════════════════ the harness ══ */

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

interface ServeOptions {
  /** The cohort body EXACTLY as the transport would deliver it. Bare by
   *  default, because bare is what the server actually sends. */
  body?: unknown;
  status?: number;
  scope?: MeScopeResponse;
  /** The drilldown answer the search box probes for. */
  drilldownStatus?: number;
  drilldownBody?: unknown;
}

function serve(options: ServeOptions = {}) {
  const {
    body = cohort(),
    status = 200,
    scope = scopeBody(),
    drilldownStatus = 200,
    drilldownBody = { farmId: 'server-resolved-id' },
  } = options;

  stub = installAdapter(async (req) => {
    if (req.url.includes('/me/scope')) return { status: 200, data: scope };
    if (req.url.includes('/admin/farmer-health/cohort')) return { status, data: body };
    if (req.url.includes('/admin/farmer-health/')) {
      return { status: drilldownStatus, data: drilldownBody };
    }
    return { status: 404, data: {} };
  });
  return stub;
}

/** Where the router is now — MemoryRouter has no `window.location` to read. */
function Where() {
  const location = useLocation();
  return (
    <span data-where="">
      {location.pathname}
      {location.search}
    </span>
  );
}

function where(): string {
  return document.querySelector('[data-where]')?.textContent ?? '';
}

function renderPage(route = `/farmer-health?org=${ORG}`) {
  return renderWithProviders(
    <>
      <FarmerHealthPage />
      <Where />
    </>,
    { route },
  );
}

async function settled() {
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /Loading/ })).toHaveLength(0), {
    timeout: SETTLE_WAIT,
  });
}

/* ── addressing the two lists and the four charts by their own hooks ────── */

function list(id: 'fh-queue' | 'fh-watch'): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-list="${id}"]`)!;
}

function rowsOf(id: 'fh-queue' | 'fh-watch'): HTMLTableRowElement[] {
  const table = within(list(id)).queryByRole('table');
  if (!table) return [];
  return [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter(
    (tr) => !tr.id.includes('detail'),
  );
}

/** ONE CELL, never the row (Task 17's lesson: a whole-row assertion passes on
 *  a string that happens to appear in a neighbouring cell). */
function cell(tr: HTMLTableRowElement, index: number): string {
  return tr.querySelectorAll('td')[index]?.textContent?.trim() ?? '';
}

/** The farmer column of every visible row, in DOM order. */
function order(id: 'fh-queue' | 'fh-watch'): string[] {
  return rowsOf(id).map((tr) => cell(tr, 0));
}

function chart(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-chart="${id}"]`)!;
}

function chartTable(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-chart-table="${id}"]`);
}

/** A chart's data-table row, by the label in its row header. */
function tableRow(id: string, label: string): HTMLTableRowElement {
  const table = chartTable(id)!.querySelector('table')!;
  return [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')].find(
    (tr) => tr.querySelector('th')?.textContent?.trim() === label,
  )!;
}

async function openWatchlist(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(list('fh-watch')).getByRole('button', { name: /Show all/ }));
}

/* ═══ 1. the prefix, the missing envelope, and the absent clock ═══════════ */

describe('the endpoint this screen actually calls (A26, and the envelope A27 missed)', () => {
  it('asks /admin/farmer-health/cohort — never /shramsafal/admin/ — and renders a BARE dto', async () => {
    serve();
    renderPage();
    await settled();

    /*
     * 1. THE PREFIX. This is the assertion that fails the day somebody
     *    centralises the admin prefix as a tidy-up. It reads the url the
     *    SCREEN produced, so it covers the hook and the api module together —
     *    `queryContracts.contract.test.tsx` covers the module on its own.
     */
    const cohortCalls = stub!.requests.filter((r) => r.url.includes('farmer-health'));
    expect(
      cohortCalls.map((r) => r.url),
      'the farmer-health cohort url changed — a prefix that becomes /shramsafal/admin/ 404s both farmer-health screens, and nothing on screen would show it',
    ).toEqual(['/admin/farmer-health/cohort']);
    for (const request of stub!.requests) {
      expect(request.url.startsWith('/shramsafal/admin/farmer-health')).toBe(false);
    }

    /*
     * 2. THE ENVELOPE. `GetCohortPatternsHandler` returns the DTO bare. The
     *    fixture above is bare, so if the client goes back to reading
     *    `data.data` unconditionally every one of these rows disappears and
     *    the screen renders empty over a 200 — which is exactly what shipped.
     */
    expect(rowsOf('fh-queue')).toHaveLength(3);
    expect(chartTable('fh-score-distribution')).not.toBeNull();

    /*
     * 3. NO CLOCK, THEREFORE NO CHIP. Every other screen renders a freshness
     *    chip here. This feed sends no `meta`, and a chip may only state an
     *    age it actually has.
     */
    expect(document.querySelector('.chip-fresh')).toBeNull();
    expect(document.querySelector('[data-no-clock]')?.textContent).toMatch(/sends no timestamp/);

    /*
     * 4. A39 — the org is named, and it may be, because THIS endpoint really
     *    is scoped: every query joins the org-to-farm projection.
     */
    expect(document.querySelector('[data-scope-line]')?.textContent).toContain(ORG_NAME);
  });

  it('still renders when the server DOES send an envelope, and refuses to name an org for a platform admin', async () => {
    /* Tolerance in both directions: the day the backend gives these two
       endpoints the envelope every other one has, this screen must not break —
       and it should start showing a chip rather than needing a second port. */
    serve({
      body: { data: cohort(), meta: { source: 'materialized', lastRefreshedUtc: '2026-09-01T08:00:00Z', ttlSeconds: 300 } },
      scope: scopeBody({ isPlatformAdmin: true }),
    });
    renderPage();
    await settled();

    expect(rowsOf('fh-queue')).toHaveLength(3);

    /*
     * THE SUBTITLE MAY NOT NAME AN ORGANISATION FOR A PLATFORM ADMIN.
     * `ScopeJoin` returns an empty fragment when `scope.IsPlatformAdmin`, so
     * the figures cover every organisation while the topbar still names one.
     * Three sentences of this shape were corrected in `74da3d3b`; this is the
     * assertion that stops a fourth.
     */
    const scopeLine = document.querySelector('[data-scope-line]')!.textContent!;
    expect(scopeLine).toContain('on the platform');
    expect(
      scopeLine,
      'the subtitle named one organisation to a platform admin, whose figures are platform-wide',
    ).not.toContain(ORG_NAME);
  });
});

/* ═══ 2. two lists, two sort contracts (A30, A31) ═════════════════════════ */

describe('the queue sorts and the watchlist does not (A30, A31)', () => {
  it('opens score-ascending with the lastActiveAt tiebreak, and the tiebreak is NOT flipped by direction', async () => {
    const user = userEvent.setup();
    serve();
    renderPage();
    await settled();

    /*
     * DEFAULT — score ASC. `worst` (5) first, then the two farms tied on 12,
     * and the tie is broken by MOST RECENTLY ACTIVE: the worst farms who are
     * still turning up come first. Remove the tiebreak and the two tied rows
     * keep their server order, `tie-old` then `tie-new`, and this fails.
     */
    expect(
      order('fh-queue'),
      'the intervention queue lost its default order or its lastActiveAt tiebreak',
    ).toEqual(['Farmer worst', 'Farmer tie-new', 'Farmer tie-old']);

    /*
     * FLIPPED — and the tiebreak is deliberately NOT flipped with it. The live
     * code keyed on `sortKey === 'score'` in either direction while its
     * comment said "score-asc"; Task 8 carried the code, not the comment.
     * `tie-new` must still precede `tie-old`.
     */
    await user.click(within(list('fh-queue')).getByRole('button', { name: /Score/ }));
    expect(order('fh-queue')).toEqual(['Farmer tie-new', 'Farmer tie-old', 'Farmer worst']);

    /*
     * URL-SYNCED (A30's other half). The sort was component-local state and
     * died on every refresh; it is in the url now, under this list's OWN
     * namespace, so a shared link restores the order it was shared in.
     */
    expect(where()).toContain('queue.sort=score');
    expect(where()).toContain('queue.dir=desc');
    /* The org survives the write — every url write goes through the
       functional updater (A20). */
    expect(where()).toContain(`org=${ORG}`);

    /* THE COLLISION (T20). Sorting one list must not touch the other. */
    expect(where()).not.toContain('watch.sort');
  });

  it('gives the watchlist a FIXED order with no sort controls, and says why on screen', async () => {
    const user = userEvent.setup();
    serve();
    renderPage();
    await settled();
    await openWatchlist(user);

    /*
     * FIXED AT `weeklyDelta` ASCENDING — biggest drop first. Server order is
     * rising-first, so a list that simply rendered `rows` fails here.
     */
    expect(
      order('fh-watch'),
      'the watchlist is no longer ordered biggest-drop-first',
    ).toEqual(['Farmer w-falling-hard', 'Farmer w-falling-bit', 'Farmer w-rising']);

    /*
     * AND IT IS NOT A PREFERENCE. v3 makes every table sortable; porting that
     * would silently convert a product decision into a user setting. The
     * queue's four sort controls prove the assertion can find one when it is
     * there.
     */
    const watchHeaders = within(list('fh-watch')).getAllByRole('columnheader');
    for (const header of watchHeaders) {
      expect(
        within(header).queryByRole('button'),
        'the watchlist grew a sort control — an order the product fixed became something a reader can change',
      ).toBeNull();
    }
    expect(
      within(list('fh-queue')).getAllByRole('columnheader').some((h) => within(h).queryByRole('button')),
    ).toBe(true);

    /* An order the reader cannot change and cannot explain is an order they
       assume is arbitrary. */
    expect(within(list('fh-watch')).getByText(/deliberately not sortable/i)).toBeInTheDocument();

    /* A31 — collapsed by default, with a real disclosure. */
    const showAll = within(list('fh-watch')).getByRole('button', { name: /Hide the list/ });
    expect(showAll).toHaveAttribute('aria-expanded', 'true');
    expect(showAll).toHaveAttribute('aria-controls');

    /* The edge marks the subset still falling — the rows worth a call. v3's
       rule, and here it earns its keep: on the intervention queue an edge on
       every row would be decoration, on this list it is a finding. Asserted on
       the style the way `DataList.test.tsx:936` does, because the edge is a
       box-shadow token and there is no attribute to read. */
    expect(rowsOf('fh-watch')[0].style.boxShadow).not.toBe('');
    expect(rowsOf('fh-watch')[1].style.boxShadow).not.toBe('');
    expect(
      rowsOf('fh-watch')[2].style.boxShadow,
      'the rising farm carried the still-falling edge, which makes the edge decoration',
    ).toBe('');
    /* And NOT on the queue, where every row already needs a person. */
    expect(rowsOf('fh-queue').every((tr) => tr.style.boxShadow === '')).toBe(true);
  });
});

/* ═══ 3. the charts v3 never draws (B8, A32, A33) ═════════════════════════ */

describe('the two charts v3 never draws, and the tables under all four (B8, A32, A33)', () => {
  it('keeps the donut data table — visible now, not sr-only — and tells a measured zero from a gap', async () => {
    serve();
    renderPage();
    await settled();

    /*
     * A32 — THE TABLE THAT NO SCREENSHOT REVIEW COULD SEE.
     * `EngagementTierBreakdown.tsx:95` was `<details className="sr-only">`,
     * which is precisely why `ChartShell` makes `dataTable` a REQUIRED prop.
     * It still exists, under the same chart, with the same figures — and it is
     * no longer hidden from the sighted operator who wanted an exact number.
     */
    const tiers = chartTable('fh-engagement-tiers');
    expect(tiers, 'the engagement-tier data table is gone').not.toBeNull();
    expect(chart('fh-engagement-tiers').contains(tiers!)).toBe(true);
    expect(
      tiers!.className,
      'the tier data table went back to sr-only — the one accessibility affordance on this page, invisible in every review',
    ).not.toContain('sr-only');

    /*
     * A33 — THE AXIS IS FIXED AT A/B/C/D, so a tier the server did not send
     * keeps its place. And the two absences are told apart: tier A was
     * measured at zero and prints 0; tier C was never sent and prints the
     * honest non-value, never a 0.
     */
    expect(tableRow('fh-engagement-tiers', 'A').querySelectorAll('td')[0].textContent).toBe('0');
    expect(
      tableRow('fh-engagement-tiers', 'C').textContent,
      'a tier with no reading was printed as a zero',
    ).toMatch(/not measured/);

    /* The same rule on the histogram: an empty bin is a measured 0, because
       the query really does count every bin. */
    expect(tableRow('fh-score-distribution', '11-20').querySelectorAll('td')[0].textContent).toBe(
      '0',
    );
    expect(tableRow('fh-score-distribution', '0-10').querySelectorAll('td')[0].textContent).toBe(
      '2',
    );

    /* And on the trend: an interior week with no row is a HOLE, not a trough,
       and the shell says how many in words. */
    expect(within(chart('fh-weekly-trend')).getByText(/never measured/)).toBeInTheDocument();
    expect(chart('fh-weekly-trend').querySelector('[data-state="gap"]')).not.toBeNull();
  });

  it('draws the Investment pillar as an absence, because the scorer has never computed it', async () => {
    serve();
    renderPage();
    await settled();

    /*
     * 🔴 THE FINDING THIS ASSERTION EXISTS FOR. The `investment` CTE in
     * `mis.dwc_score_per_farm_week` is a documented placeholder —
     * `SELECT DISTINCT farm_id, 0.0 AS reuse_ratio` — so the pillar scores 0
     * for every farm, every week, always. The old heatmap drew that as
     * `0.0 / 10` with a red bar and "7 failing", which is a measured finding
     * about farms presented in the same shape as the five real pillars. It is
     * not a finding; it is an unbuilt feature.
     */
    const investment = tableRow('fh-pillars', 'Investment');
    expect(
      investment.textContent,
      'the Investment pillar was drawn as a measured 0 — it is a placeholder that has never been computed',
    ).toMatch(/not measured/);
    expect(investment.textContent).not.toContain('7');

    /* A real pillar is unaffected — the rescue is keyed on the pillar, not on
       the value, so a genuine 0 elsewhere is still a genuine 0. */
    expect(tableRow('fh-pillars', 'Proof').querySelectorAll('td')[1].textContent).toBe('9.5');

    /* And it is counted honestly: five of six, not six of six. */
    expect(within(chart('fh-pillars')).getByText(/5 of 6 pillars measured/)).toBeInTheDocument();

    /* The consequence, stated where a reader can act on it: the reachable
       maximum is 90, not 100. */
    expect(screen.getByText(/highest score any farm can currently reach/)).toBeInTheDocument();
  });
});

/* ═══ 4. the cross-surface emptiness sum (A35, A36) ═══════════════════════ */

describe('two empties, decided by a sum that spans three surfaces (A35, A36)', () => {
  it('an unscored cohort gets the mandatory banner and makes NO claim about farms', async () => {
    serve({ body: EMPTY_COHORT });
    renderPage();
    await settled();

    /*
     * A35 — MANDATORY C5 COPY, ASSERTED BYTE FOR BYTE INCLUDING THE
     * SEMICOLON. It is a compliance sentence, not UI copy: rewording it, even
     * to something that reads better, changes what was said.
     */
    expect(screen.getByText(/Scoring active from/).closest('[role="status"]')!.textContent).toBe(
      'Scoring active from first deploy; data accumulating.',
    );

    /* A36, the understated half. No hint, because "all scored farms are above
       the threshold" over an unscored cohort is a claim about farms nobody has
       measured. */
    expect(within(list('fh-queue')).getByText('No farms in intervention bucket yet.')).toBeInTheDocument();
    expect(screen.queryByText(/above the 40-pt intervention threshold/)).toBeNull();

    /* And the banner is not allowed to be the whole story: in production the
       score view has never been populated (deployment task D3), and seven
       swallowed database failures look identical to this. */
    expect(screen.getByText(/cannot confirm that scoring has started/)).toBeInTheDocument();
  });

  it('a SCORED cohort with an empty queue says the opposite — and it is the histogram that decides', async () => {
    /*
     * THE TERM THAT CARRIES THE MEANING. Both lists are empty here, exactly as
     * above; the ONLY difference is that the score histogram is not zero. Drop
     * the third term from the sum and this test renders the understated copy
     * and the banner, which is the collapse A36 exists to prevent.
     */
    serve({
      body: {
        ...EMPTY_COHORT,
        scoreDistribution: bins({ '81-90': 6 }),
      },
    });
    renderPage();
    await settled();

    expect(
      screen.queryByText(/Scoring active from/),
      'the banner fired over a cohort that HAS been scored — the histogram term was dropped from the emptiness sum',
    ).toBeNull();
    expect(within(list('fh-queue')).getByText('No farms in intervention bucket.')).toBeInTheDocument();
    expect(screen.getByText(/above the 40-pt intervention threshold/)).toBeInTheDocument();
  });

  it('a broken request is a failure with a retry, never an empty cohort', async () => {
    /* D9. An absence names its cause: a 500 must not arrive as "nothing needs
       intervention", which on this screen is the best possible news. */
    serve({ status: 500, body: {} });
    renderPage();
    await settled();

    expect(await screen.findByRole('alert', undefined, { timeout: SETTLE_WAIT })).toBeInTheDocument();
    expect(screen.queryByText(/Scoring active from/)).toBeNull();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
});

/* ═══ 5. the search box (A29, B7, A28) ════════════════════════════════════ */

describe('the farmer search probes before it navigates (A29, B7)', () => {
  it('does not query on a keystroke, and a miss does not take the cohort down with it', async () => {
    const user = userEvent.setup();
    serve({ drilldownStatus: 404, drilldownBody: {} });
    renderPage();
    await settled();

    const before = stub!.requests.length;
    const search = screen.getByRole('button', { name: /Search/ });
    /* Disabled until the debounce lands — that IS what the debounce is for. */
    expect(search).toBeDisabled();

    await user.type(screen.getByLabelText('Search farmer'), '9876543210');

    /*
     * THE DEBOUNCE GATES THE BUTTON, NOT THE QUERY — AND THIS WAITS FOR IT TO
     * LAND BEFORE SAYING SO.
     *
     * 🛑 An earlier version of this test asserted "no request" the instant
     * after typing, and a mutation that wired the debounce straight to the
     * query SURVIVED it: `userEvent.type` finishes long before 300 ms, so
     * neither version had fired anything yet and the assertion was measuring
     * the clock rather than the contract.
     *
     * The button's `disabled` is driven by `debounced` and by nothing else, so
     * waiting for it to enable is a direct observation that the debounce HAS
     * fired. Only then is "and still not one request" a statement about where
     * the debounce reaches.
     */
    await waitFor(() => expect(search).toBeEnabled(), { timeout: SETTLE_WAIT });
    expect(
      stub!.requests.length,
      'the 300 ms debounce reaches the QUERY, not just the button — one deliberate lookup became one per pause in typing, against an endpoint that reads four matviews',
    ).toBe(before);

    /* Now submit — one request, and it is a PROBE for the drilldown, not a
       navigation. */
    await user.keyboard('{Enter}');
    await waitFor(() => expect(stub!.requests.length).toBe(before + 1), { timeout: SETTLE_WAIT });
    expect(stub!.requests[before].url).toBe('/admin/farmer-health/9876543210');

    /*
     * THE MISS IS NON-BLOCKING, AND IT FAILS FAST. `retry: 0` is why a 404
     * becomes not-found UX instead of a two-attempt hang; the register rows
     * behind the page keep rendering throughout.
     */
    const miss = await screen.findByText(/find that farmer in your scope/, undefined, {
      timeout: SETTLE_WAIT,
    });
    /*
     * THE REAL APOSTROPHE, CARRIED FROM THE SOURCE — AND THE SOURCE IS NOT
     * WHAT THE PLAN IMPLIES.
     *
     * The plan's Step 3 quotes this line with a typographic apostrophe. The
     * live component writes `&apos;`, which is U+0027 — a STRAIGHT quote — so
     * that is the character the console has always rendered, and the repo is
     * the source of truth. "Carry the real apostrophe" therefore means keep
     * `&apos;`, not upgrade it to `&rsquo;`: changing it here would change the
     * rendered character under cover of a port, which is the exact thing the
     * instruction is guarding against. Asserted byte for byte so neither
     * direction can drift.
     */
    expect(miss.textContent).toBe("Couldn't find that farmer in your scope.");
    /*
     * NON-BLOCKING, AND POLITE. `role="status"` and not `alert`: a miss is
     * information beside a control, not an interruption of the page behind it.
     * `alert` is assertive and cuts across whatever a screen-reader user was
     * reading — for a mistyped phone number. And the cohort keeps rendering
     * throughout, which is the sighted half of the same property.
     */
    expect(
      miss.getAttribute('role'),
      'the miss became an assertive alert — it now interrupts a screen-reader user for a typo',
    ).toBe('status');
    expect(rowsOf('fh-queue')).toHaveLength(3);
    expect(where()).toContain('/farmer-health?');

    /* One attempt, not two: `retry: 0` on `useFarmerHealth` (A28). */
    expect(
      stub!.requests.filter((r) => r.url === '/admin/farmer-health/9876543210'),
      'the not-found path retried — the global retry: 1 was inherited and a typo now costs two round trips',
    ).toHaveLength(1);
  });

  it('navigates to the SERVER-RESOLVED farm id, not the string the operator typed', async () => {
    const user = userEvent.setup();
    /* A phone number in, a farm id out. Routing the typed string would produce
       a url that only works for the person who typed it. */
    serve({ drilldownBody: { farmId: 'farm-resolved-by-server' } });

    const resolved: string[] = [];
    renderWithProviders(
      <>
        <FarmerSearchBox onResolved={(id) => resolved.push(id)} />
        <Where />
      </>,
      { route: `/farmer-health?org=${ORG}` },
    );

    await user.type(screen.getByLabelText('Search farmer'), '9876543210');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(where()).toContain('/farmer-health/farm-resolved-by-server'), {
      timeout: SETTLE_WAIT,
    });
    /* The extension point fires, and it fires with the resolved id. */
    expect(resolved).toEqual(['farm-resolved-by-server']);
    /* StrictMode double-invokes the effect in dev; `setSubmitted(null)` is
       what makes the second pass a no-op rather than a second navigation. */
    expect(where()).not.toContain('9876543210');
  });
});
