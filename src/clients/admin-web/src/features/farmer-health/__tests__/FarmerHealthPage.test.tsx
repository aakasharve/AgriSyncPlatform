import { screen, waitFor } from '@testing-library/react';
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

/* ═══ 1. the prefix, the missing envelope, and the absent clock ═══════════ */

// B24 (founder, 2026-11-17): FH1, FH2, FH4 and FH5 are ideas shown as Not built yet (the landing reads no cohort feed). Retired: "asks /admin/farmer-health/cohort — never /shramsafal/admin/ — and rend".
// B24 (founder, 2026-11-17): FH1, FH2, FH4 and FH5 are ideas shown as Not built yet (the landing reads no cohort feed). Retired: "still renders when the server DOES send an envelope, and refuses to na".

/* ═══ 2. two lists, two sort contracts (A30, A31) ═════════════════════════ */

// B24 (founder, 2026-11-17): FH1, FH2, FH4 and FH5 are ideas shown as Not built yet (the landing reads no cohort feed). Retired: "opens score-ascending with the lastActiveAt tiebreak, and the tiebreak".
// B24 (founder, 2026-11-17): FH1, FH2, FH4 and FH5 are ideas shown as Not built yet (the landing reads no cohort feed). Retired: "gives the watchlist a FIXED order with no sort controls, and says why ".

/* ═══ 3. the charts v3 never draws (B8, A32, A33) ═════════════════════════ */

// B24 (founder, 2026-11-17): FH1, FH2, FH4 and FH5 are ideas shown as Not built yet (the landing reads no cohort feed). Retired: "keeps the donut data table — visible now, not sr-only — and tells a me".
// B24 (founder, 2026-11-17): FH1, FH2, FH4 and FH5 are ideas shown as Not built yet (the landing reads no cohort feed). Retired: "draws the Investment pillar as an absence, because the scorer has neve".

/* ═══ 4. the cross-surface emptiness sum (A35, A36) ═══════════════════════ */

// B24 (founder, 2026-11-17): FH1, FH2, FH4 and FH5 are ideas shown as Not built yet (the landing reads no cohort feed). Retired: "an unscored cohort gets the mandatory banner and makes NO claim about ".
// B24 (founder, 2026-11-17): FH1, FH2, FH4 and FH5 are ideas shown as Not built yet (the landing reads no cohort feed). Retired: "a SCORED cohort with an empty queue says the opposite — and it is the ".
// B24 (founder, 2026-11-17): FH1, FH2, FH4 and FH5 are ideas shown as Not built yet (the landing reads no cohort feed). Retired: "a broken request is a failure with a retry, never an empty cohort".

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
    // B24 (founder, 2026-11-17): FH1 (the intervention queue) is an idea shown as Not built yet, so its three rows are no longer asserted.
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
