import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { MeScopeResponse } from '@/hooks/useAdminScope';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles, type StubbedAdapter } from '@/test/stubAdapter';
import FarmerHealthDrilldown from '../FarmerHealthDrilldown';
import type { FarmerHealthDto, FarmerHealthTimelineDayDto } from '../farmer-health.types';

/**
 * THE FARMER-HEALTH DRILLDOWN — the biggest single feature loss in the v3
 * design, and the one screen no screenshot diff can review, because v3 does
 * not contain it.
 *
 * Seven claims are proved here, and every one of them is invisible in a
 * picture:
 *
 *  1. A WITHHELD NAME RENDERS THE FARM ID, NEVER THE MARKER. The live title
 *     printed the literal `**redacted**` because its fallback fired only on an
 *     EMPTY name. Asserted on the heading's exact text and on the marker being
 *     absent from the whole document.
 *  2. SCOPE-STILL-LOADING DENIES ACCESS. Not "shows a spinner" — DENIES. The
 *     ops sub-blocks arrive null for a caller without the grant, so treating
 *     an unresolved scope as permission draws a server-redacted null as a
 *     measured empty for the width of a request.
 *  3. BAND 1 RENDERS IN ALL FOUR BRANCHES. One test per branch, on the same
 *     assertion, so collapsing the page into a single skeleton fails four
 *     times rather than passing quietly.
 *  4. THE WORKER DISCLAIMER IS BYTE-FOR-BYTE, and the red-line COMMENT is
 *     still in the component file.
 *  5. THE GATE IS TWO GRANTS. `ops.errors` and `ops.voice` are evaluated
 *     independently by the server, so one-of-two is a real state and it does
 *     not get the sentence that names both.
 *  6. A SCORE THE SERVER DID NOT MEASURE IS NOT DRAWN. `insufficient_data`
 *     arrives with a complete zero row attached; the 64px figure must not
 *     appear under it.
 *  7. `retry: 0` — a 404 costs ONE request, proved against a client whose
 *     default is `retry: 1`, which is what the console actually ships.
 *
 * SETTLE_WAIT — measured 2026-09-01 by Task 19 and carried with its reason.
 * Under full-suite parallelism thirty-odd jsdom environments compete for the
 * same cores, so an assertion that a state is ABSENT can run while the
 * previous state is still on screen — a failure that reads like a product
 * defect and is not one. Nothing is weakened; a real regression still fails,
 * it just fails after waiting. `vitest.config.ts` is untouched (Task 29 owns
 * the residual flake).
 */

const SETTLE_WAIT = 15_000;

const ORG = '11111111-1111-1111-1111-111111111111';
const FARM = '22222222-2222-2222-2222-222222222222';

/* ═══════════════════════════════════════════════════════════ fixtures ════ */

function day(date: string, over: Partial<FarmerHealthTimelineDayDto> = {}): FarmerHealthTimelineDayDto {
  return {
    date,
    closuresStarted: 0,
    closuresSubmitted: 0,
    proofAttached: 0,
    summariesViewed: 0,
    verifications: 0,
    errors: 0,
    ...over,
  };
}

/** Fourteen days, exactly as the server backfills them, with two live ones. */
function timeline(): FarmerHealthTimelineDayDto[] {
  const days: FarmerHealthTimelineDayDto[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.UTC(2026, 7, 31 - i)).toISOString().slice(0, 10);
    days.push(day(d));
  }
  days[12] = day(days[12].date, { closuresStarted: 4, closuresSubmitted: 3 });
  days[13] = day(days[13].date, { closuresStarted: 1, verifications: 1, errors: 2 });
  return days;
}

function farmer(over: Partial<FarmerHealthDto> = {}): FarmerHealthDto {
  return {
    farmId: FARM,
    farmerName: 'Purvesh Arve',
    farmName: 'Arve Mala',
    phone: '9812345612',
    score: null,
    timeline: timeline(),
    syncState: { lastSyncAt: '2026-08-30T09:05:00.0000000Z' },
    aiHealth: {
      voice: { finishedJobs14d: 20, savedJobs14d: 15, savedPct14d: 75, notMeasuredReason: null },
      receipt: { finishedJobs14d: 7, savedJobs14d: null, savedPct14d: null, notMeasuredReason: 'saved_not_recorded' },
      patti: { finishedJobs14d: 0, savedJobs14d: null, savedPct14d: null, notMeasuredReason: 'saved_not_recorded' },
    },
    verifications: { confirmed: 1, verified: 2, disputed: 0, pending: 1, selfChecked: 3 },
    workerSummary: [
      {
        workerId: 'w-1',
        name: 'रामू',
        assignmentCount: 7,
        firstSeenUtc: '2026-07-02T04:00:00.0000000Z',
      },
    ],
    ...over,
  };
}

const ALL_MODULES = ['farmer.health', 'ops.errors', 'ops.voice'];

function scopeBody(modules: string[] = ALL_MODULES): MeScopeResponse {
  return {
    outcome: 'Resolved',
    scope: {
      userId: 'u1',
      orgId: ORG,
      orgType: 'FPO',
      orgRole: 'Owner',
      isPlatformAdmin: false,
      modules: modules.map((key) => ({ key, canRead: true, canWrite: false, canExport: false })),
    },
    memberships: [{ orgId: ORG, orgName: 'Nashik Grape FPO', orgType: 'FPO', orgRole: 'Owner' }],
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
  /** The drilldown body EXACTLY as the transport would deliver it. BARE by
   *  default, because bare is what `GetFarmerHealthHandler` actually sends. */
  body?: unknown;
  status?: number;
  modules?: string[];
  /** A scope request that never answers — the "still loading" characterisation. */
  scopePending?: boolean;
}

function serve(options: ServeOptions = {}) {
  const { body = farmer(), status = 200, modules = ALL_MODULES, scopePending = false } = options;

  stub = installAdapter(async (req) => {
    if (req.url.includes('/me/scope')) {
      if (scopePending) return neverSettles();
      return { status: 200, data: scopeBody(modules) };
    }
    if (req.url.includes('/admin/farmer-health/')) return { status, data: body };
    return { status: 404, data: {} };
  });
  return stub;
}

function renderDrilldown(farmId: string = FARM, queryClient?: QueryClient) {
  return renderWithProviders(
    <Routes>
      <Route path="/farmer-health/:farmId" element={<FarmerHealthDrilldown />} />
    </Routes>,
    {
      route: `/farmer-health/${encodeURIComponent(farmId)}?org=${ORG}`,
      ...(queryClient ? { queryClient } : {}),
    }
  );
}

async function settled() {
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /^Loading/ })).toHaveLength(0), {
    timeout: SETTLE_WAIT,
  });
}

const band = (name: string) => document.querySelector<HTMLElement>(`[data-band="${name}"]`);
function drilldownRequests(): string[] {
  return (stub?.requests ?? [])
    .map((r) => r.url)
    .filter((u) => u.includes('/admin/farmer-health/'));
}

/* ═══ 1. the endpoint, and the envelope it does not send ═════════════════ */

describe('the endpoint this screen actually calls (A26, A27)', () => {
  it('asks /admin/farmer-health/{id} — never /shramsafal/admin/ — and renders a BARE dto', async () => {
    serve();
    renderDrilldown();
    await settled();

    expect(drilldownRequests()).toEqual([`/admin/farmer-health/${FARM}`]);
    for (const url of drilldownRequests()) expect(url).not.toContain('/shramsafal/admin');

    /* The bare DTO reached the bands. `GetFarmerHealthHandler.cs:45` returns
       `Result<FarmerHealthDto>`, not `Result<AdminResponseDto<T>>` — this is
       the second of the three unenveloped endpoints A27 counted as one. */
    // B24 (founder, 2026-11-17): P2 (farm score) is an idea shown as Not built yet; the bare dto is now seen through P3 (the timeline).
    expect(band('timeline')).not.toBeNull();
  });

  it('renders the ENVELOPED shape too, so a server that grows one changes nothing', async () => {
    serve({ body: { data: farmer(), meta: { lastRefreshedUtc: '2026-08-31T06:00:00Z' } } });
    renderDrilldown();
    await settled();

    // B24 (founder, 2026-11-17): P2 (farm score) is an idea shown as Not built yet; the enveloped dto is seen through P3 (the timeline).
    expect(band('timeline')).not.toBeNull();
  });

  it('encodes the path segment, so a typed id with a slash cannot become a route', async () => {
    serve({ status: 404, body: {} });
    renderDrilldown('a/b c');
    await settled();

    expect(drilldownRequests()).toEqual(['/admin/farmer-health/a%2Fb%20c']);
  });

  /* A28 — proved against a client whose default is `retry: 1`, which is what
     `App.tsx:34-42` ships. The suite's own client defaults to `retry: false`,
     so a test that used it would pass whether or not the hook set anything. */
  it('spends ONE request on a 404, because the hook overrides the global retry', async () => {
    serve({ status: 404, body: {} });
    renderDrilldown(
      FARM,
      new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 0, gcTime: 0 } } })
    );

    await screen.findByText('Farm not found in your scope.', undefined, { timeout: SETTLE_WAIT });
    expect(drilldownRequests()).toHaveLength(1);
  });
});

/* ═══ 2. the redaction bug this task inherited ═══════════════════════════ */

// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "prints the FARM ID when the name is the redaction marker".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "prints the FARM ID when the server sends its em-dash placeholder as th".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "renders a Marathi name in Noto Sans Devanagari, not in the Latin face".

/* ═══ 3. A40 — Band 1 in all four branches ══════════════════════════════ */

describe('Band 1 survives every branch (A40)', () => {
  /** The header's three constants: the back link, the title and the farm id. */
  function expectHeader() {
    const header = band('header');
    expect(header).not.toBeNull();
    expect(within(header!).getByRole('link', { name: /All farmers/ })).toHaveAttribute(
      'href',
      '/farmer-health'
    );
    expect(within(header!).getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(header!.textContent).toContain(FARM);
  }

  it('branch 1 — the request broke', async () => {
    serve({ status: 500, body: {} });
    renderDrilldown();
    await settled();

    expectHeader();
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn.t load this farmer.s health record/);
  });

  // B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "branch 2 — still loading, with one NAMED state per band (A32)".

  it('branch 3 — the farm is not in scope', async () => {
    serve({ status: 404, body: {} });
    renderDrilldown();
    await settled();

    expectHeader();
    /* A scope statement, not a 404 page — preserved verbatim. */
    expect(screen.getByText('Farm not found in your scope.')).toBeInTheDocument();
    // CR-2e C14 (catches removed): the old line naming the swallowed scope query (`catch { return false; }`) is retired with the catch itself.
    expect(document.body.textContent).not.toContain('catch {');
  });

  it('branch 4 — the data', async () => {
    serve();
    renderDrilldown();
    await settled();

    expectHeader();
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): P1, P4, P5, P6, P7, P10, P11 became real; the farm score (P2) stays Not built yet.
    expect(document.querySelector('[data-metric="fh-name-phone"]')).not.toBeNull();
    expect(document.querySelector('[data-metric="fh-workers"]')).not.toBeNull();
    expect(band('timeline')).not.toBeNull();
  });
});

describe('the failure is retryable (A41)', () => {
  it('Retry re-issues the request', async () => {
    const user = userEvent.setup();
    serve({ status: 500, body: {} });
    renderDrilldown();
    await settled();

    expect(drilldownRequests()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(drilldownRequests().length).toBeGreaterThan(1), {
      timeout: SETTLE_WAIT,
    });
  });
});

/* ═══ 4. A5 — the in-page gate ══════════════════════════════════════════ */

// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "SCOPE STILL LOADING DENIES ACCESS — it does not optimistically render".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "keeps the denial sentence byte-for-byte when BOTH grants are missing".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "renders both blocks when both grants are held, and no denial panel".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "grants sync alone — the AI block is hidden and the sentence does not c".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "grants ai alone — the sync block is hidden and the sentence does not c".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "never renders `ops.live` as the grant a reader is told to ask for".

/* ═══ 5. Band 2 — the score it refuses to draw ══════════════════════════ */

// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "does NOT draw a total for a farm the server did not score".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "draws the Investment pillar as a GAP, never as a failing 0 / 10".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "states the 30-point subtraction when a farm is flagged suspicious".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "says nothing was subtracted when the farm is not flagged".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "expands one pillar at a time, and the explanation matches the matview".

/* ═══ 6. Band 3 — the timeline ══════════════════════════════════════════ */

describe('the 14-day grid (Band 3)', () => {
  // B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "scales each row against its OWN maximum and says so".

  // B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "uses tokens for the two meanings it encodes, and no literals".

  it('refuses to call an all-zero grid a measured zero', async () => {
    // CR-2e C25 (main-session amendment): an all-zero timeline served beside a
    // non-zero P6 (`verifications`) never says the farm recorded nothing. It says
    // only that what these six rows count was zero in the last 14 India days.
    // Kept from before: a zero is not dressed up as a reading, so no cell is drawn.
    serve({
      body: farmer({
        timeline: timeline().map((d) => day(d.date)),
        verifications: { confirmed: 1, verified: 2, disputed: 0, pending: 1, selfChecked: 3 },
      }),
    });
    renderDrilldown();
    await settled();

    const grid = band('timeline')!;
    expect(grid.querySelector('[data-cell]')).toBeNull();
    const said = (grid.textContent ?? '').replace(/\s+/g, ' ');
    // a denial ("does not mean the farm recorded nothing") is allowed; a claim is not
    const claim = /(?<!not mean (?:that )?the farm )recorded nothing/i;
    expect(said).not.toMatch(claim);
    expect(said).not.toMatch(/nothing was recorded/i);
    expect(said).toMatch(/six rows/i);
    expect(said).toMatch(/14|fourteen/i);
    expect(said).toMatch(/India days?/i);
    expect(document.body.textContent ?? '').not.toMatch(claim);
    expect(document.querySelector('[data-metric="fh-verification-counts"]')).not.toBeNull();
    // CR-2e C14 (catches removed): a zero is now a served zero, so the old "backfilled with zero rows" caveat is retired.
    expect(grid.textContent).not.toContain('backfilled');
  });

  it('keeps the accessible figures table under the grid (A32)', async () => {
    serve();
    renderDrilldown();
    await settled();

    const table = document.querySelector('[data-timeline-table]')!;
    expect(table.querySelectorAll('tbody > tr')).toHaveLength(14);
  });
});

/* ═══ 7. Band 4 — the red line ══════════════════════════════════════════ */

describe('the worker list, and the line drawn around it (A35)', () => {
  // B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "carries the disclaimer byte-for-byte".

  it('keeps the red-line comment IN THE COMPONENT FILE', async () => {
    /* A comment is the only place this rule can live, so it is asserted like
       any other contract. Anyone adding a payout column has to delete a
       sentence that says not to, and this test, first. */
    const src = readFileSync(
      resolve(process.cwd(), 'src/features/farmer-health/components/WorkerSummaryList.tsx'),
      'utf-8'
    );
    expect(src.length).toBeGreaterThan(500);
    expect(src).toContain('DO NOT add fields here without a new task');
    expect(src).toContain('No reputation, no dispute,');
    expect(src).toContain('no payout, no skill, no score.');
  });

  // B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "renders a Marathi worker name through the one primitive (A34 — the LAS".

  // B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "shows only three facts per worker — no reputation, no payout, no score".
});

/* ═══ 8. Band 5 — the two figures that were never measurements ══════════ */

// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "never prints "pending pushes" as a number — it is hard-coded server-si".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "draws the AI rates when there are invocations to take a ratio of".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "refuses the 100% the server substitutes when nothing was invoked (A38,".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "clamps and em-dashes a rate that is not a number (A38, as registered)".
// B24 (founder, 2026-11-17): P1, P2, P4-P7 and P9-P11 are ideas shown as Not built yet (the page draws only P3 and P8). Retired: "carries the C8 slate inset edge on both ops panels, from the token".
