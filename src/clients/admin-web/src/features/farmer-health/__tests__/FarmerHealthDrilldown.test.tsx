import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { REDACTED } from '@/components/state';
import type { MeScopeResponse } from '@/hooks/useAdminScope';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles, type StubbedAdapter } from '@/test/stubAdapter';
import FarmerHealthDrilldown from '../FarmerHealthDrilldown';
import {
  OPS_DENIED_AI,
  OPS_DENIED_BOTH,
  OPS_DENIED_SYNC,
  SUSPICION_PENALTY,
  WORKER_DISCLAIMER,
} from '../drilldown';
import type {
  FarmerHealthDto,
  FarmerHealthScoreBreakdownDto,
  FarmerHealthTimelineDayDto,
} from '../farmer-health.types';

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

function score(over: Partial<FarmerHealthScoreBreakdownDto> = {}): FarmerHealthScoreBreakdownDto {
  return {
    total: 58,
    bucket: 'watchlist',
    flag: 'ok',
    pillars: {
      triggerFit: 6.4,
      actionSimplicity: 14,
      proof: 9.5,
      reward: 3.2,
      /* The placeholder the server really sends for every farm, every week. */
      investment: 0,
      repeat: 25,
    },
    weekStart: '2026-08-24',
    ...over,
  };
}

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
    phone: '98******12',
    score: score(),
    timeline: timeline(),
    syncState: {
      lastSyncAt: '2026-08-30T09:05:00.0000000Z',
      pendingPushes: 0,
      failedPushesLast7d: 2,
      lastErrors: [
        { ts: '2026-08-30T08:00:00Z', endpoint: '/sync/push', status: 500, message: 'boom' },
      ],
    },
    aiHealth: {
      voiceParseSuccessRate14d: 0.94,
      receiptParseSuccessRate14d: 0.71,
      invocationCount14d: 33,
    },
    verifications: { confirmed: 1, verified: 2, disputed: 0, pending: 1 },
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
const opsPanel = (grant: string) =>
  document.querySelector<HTMLElement>(`[data-ops-panel="${grant}"]`);
const denialCopy = () =>
  document.querySelector<HTMLElement>('[data-denial-copy]')?.textContent ?? null;

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
    expect(band('score')).not.toBeNull();
    expect(within(band('score')!).getByText('58')).toBeInTheDocument();
  });

  it('renders the ENVELOPED shape too, so a server that grows one changes nothing', async () => {
    serve({ body: { data: farmer(), meta: { lastRefreshedUtc: '2026-08-31T06:00:00Z' } } });
    renderDrilldown();
    await settled();

    expect(within(band('score')!).getByText('58')).toBeInTheDocument();
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

describe('a withheld name never reaches the page title (A14, the T5/T6/T13 hand-off)', () => {
  it('prints the FARM ID when the name is the redaction marker', async () => {
    serve({ body: farmer({ farmerName: REDACTED }) });
    renderDrilldown();
    await settled();

    const heading = screen.getByRole('heading', { level: 1 });
    /* The exact text, not a containment check: the old line printed
       `**redacted**` and a containment assertion on the farm id would have
       passed on a title that printed both. */
    expect(heading.textContent).toBe(FARM);
    expect(document.body.textContent).not.toContain(REDACTED);
    expect(heading.querySelector('[data-masked="redacted"]')).not.toBeNull();
  });

  it('prints the FARM ID when the server sends its em-dash placeholder as the name', async () => {
    /* `GetFarmIdentityAsync` answers its own catch with `FarmerName: "—"`,
       which is a VALUE, not an absence — `PersonName` would otherwise render
       a name made of one dash. */
    serve({ body: farmer({ farmerName: '—' }) });
    renderDrilldown();
    await settled();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(FARM);
  });

  it('renders a Marathi name in Noto Sans Devanagari, not in the Latin face', async () => {
    serve({ body: farmer({ farmerName: 'पूर्वेश आरवे' }) });
    renderDrilldown();
    await settled();

    const name = screen
      .getByRole('heading', { level: 1 })
      .querySelector<HTMLElement>('[data-script]');
    expect(name?.getAttribute('data-script')).toBe('devanagari');
    expect(name?.style.fontFamily).toContain('Noto Sans Devanagari');
  });
});

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

  it('branch 2 — still loading, with one NAMED state per band (A32)', async () => {
    stub = installAdapter(async (req) => {
      if (req.url.includes('/me/scope')) return { status: 200, data: scopeBody() };
      return neverSettles();
    });
    renderDrilldown();

    await screen.findByRole('status', { name: 'Loading DWC score' }, { timeout: SETTLE_WAIT });
    expectHeader();

    /* Three names, not three copies of "loading". A screen reader on a page
       of identical announcements has been told nothing. */
    for (const label of ['Loading DWC score', 'Loading 14-day timeline', 'Loading worker summary']) {
      const node = screen.getByRole('status', { name: label });
      expect(node).toHaveAttribute('aria-busy', 'true');
    }
  });

  it('branch 3 — the farm is not in scope', async () => {
    serve({ status: 404, body: {} });
    renderDrilldown();
    await settled();

    expectHeader();
    /* A scope statement, not a 404 page — preserved verbatim. */
    expect(screen.getByText('Farm not found in your scope.')).toBeInTheDocument();
    /* And the swallowed scope query is named, because `catch { return false }`
       makes a dropped connection look identical to a missing grant. */
    expect(document.body.textContent).toContain('catch { return false; }');
  });

  it('branch 4 — the data', async () => {
    serve();
    renderDrilldown();
    await settled();

    expectHeader();
    expect(band('score')).not.toBeNull();
    expect(band('timeline')).not.toBeNull();
    expect(band('workers')).not.toBeNull();
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

describe('the in-page ops gate, and the only honest partial denial in the app (A5)', () => {
  it('SCOPE STILL LOADING DENIES ACCESS — it does not optimistically render', async () => {
    /* The farm answers; the scope never does. `canRead` is false throughout,
       and that is the product: the ops sub-blocks are null for a caller
       without the grant, so rendering them while the answer is unknown draws
       a server-redacted null as a measured empty. */
    serve({ scopePending: true });
    renderDrilldown();
    await settled();

    expect(opsPanel('ops.errors')).toBeNull();
    expect(opsPanel('ops.voice')).toBeNull();
    expect(denialCopy()).toBe(OPS_DENIED_BOTH);

    /* Not a spinner. Nothing on this page is still announcing itself busy. */
    expect(screen.queryAllByRole('status', { name: /^Loading/ })).toHaveLength(0);
  });

  it('keeps the denial sentence byte-for-byte when BOTH grants are missing', async () => {
    serve({ modules: ['farmer.health'] });
    renderDrilldown();
    await settled();

    expect(denialCopy()).toBe(
      'Sync posture and AI invocation health for this farm exist but are not visible at your role.'
    );
    expect(OPS_DENIED_BOTH).toBe(denialCopy());
  });

  it('renders both blocks when both grants are held, and no denial panel', async () => {
    serve();
    renderDrilldown();
    await settled();

    expect(opsPanel('ops.errors')).not.toBeNull();
    expect(opsPanel('ops.voice')).not.toBeNull();
    expect(denialCopy()).toBeNull();
  });

  /*
   * THE MISMATCH THE PLAN CARRIED. The old gate was a single
   * `canRead(ModuleKeys.OpsLive)`; the server fills the two sub-blocks on
   * `ops.errors` and `ops.voice` INDEPENDENTLY
   * (`AdminFarmerHealthRepository.cs:80-85`). These two tests are what a
   * single-key gate cannot pass in either direction.
   */
  it('grants sync alone — the AI block is hidden and the sentence does not claim both', async () => {
    serve({ modules: ['farmer.health', 'ops.errors'] });
    renderDrilldown();
    await settled();

    expect(opsPanel('ops.errors')).not.toBeNull();
    expect(opsPanel('ops.voice')).toBeNull();
    expect(denialCopy()).toBe(OPS_DENIED_AI);
    expect(denialCopy()).not.toBe(OPS_DENIED_BOTH);
  });

  it('grants ai alone — the sync block is hidden and the sentence does not claim both', async () => {
    serve({ modules: ['farmer.health', 'ops.voice'] });
    renderDrilldown();
    await settled();

    expect(opsPanel('ops.voice')).not.toBeNull();
    expect(opsPanel('ops.errors')).toBeNull();
    expect(denialCopy()).toBe(OPS_DENIED_SYNC);
  });

  it('never renders `ops.live` as the grant a reader is told to ask for', async () => {
    serve({ modules: ['farmer.health', 'ops.live'] });
    renderDrilldown();
    await settled();

    /* Holding `ops.live` and nothing else must NOT open the blocks — that was
       the direction of the bug that drew a nulled sub-block as data. */
    expect(opsPanel('ops.errors')).toBeNull();
    expect(document.body.textContent).not.toContain('ops.live');
    expect(document.body.textContent).toContain('ops.errors');
  });
});

/* ═══ 5. Band 2 — the score it refuses to draw ══════════════════════════ */

describe('the DWC score card (Band 2)', () => {
  it('does NOT draw a total for a farm the server did not score', async () => {
    /* `EmptyScore()` sends total 0, bucket intervention, every pillar 0 and a
       week of TODAY. `insufficient_data` is the only honest field in it. */
    serve({
      body: farmer({
        score: score({
          total: 0,
          bucket: 'intervention',
          flag: 'insufficient_data',
          pillars: {
            triggerFit: 0,
            actionSimplicity: 0,
            proof: 0,
            reward: 0,
            investment: 0,
            repeat: 0,
          },
        }),
      }),
    });
    renderDrilldown();
    await settled();

    const scoreBand = band('score')!;
    expect(scoreBand.querySelector('[data-total]')).toBeNull();
    expect(scoreBand.querySelector('[data-bucket]')).toBeNull();
    expect(within(scoreBand).getByText('This farm has not been scored.')).toBeInTheDocument();
    /* And no band badge on the header either — a badge is a verdict. */
    expect(band('header')!.querySelector('[data-bucket]')).toBeNull();
  });

  it('draws the Investment pillar as a GAP, never as a failing 0 / 10', async () => {
    serve();
    renderDrilldown();
    await settled();

    const scoreBand = band('score')!;
    expect(scoreBand.querySelector('[data-bar="investment"]')).toBeNull();
    expect(scoreBand.querySelector('[data-bar="proof"]')).not.toBeNull();
    /* The hatch, with the pillar named on it — `GapBar`'s own contract. */
    const gaps = scoreBand.querySelectorAll('[data-state="gap"]');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].getAttribute('title')).toBe('Investment: not measured');
  });

  it('states the 30-point subtraction when a farm is flagged suspicious', async () => {
    serve({ body: farmer({ score: score({ flag: 'suspicious', total: 28 }) }) });
    renderDrilldown();
    await settled();

    const note = document.querySelector('[data-sum-note]')!.textContent ?? '';
    /* 6.4 + 14 + 9.5 + 3.2 + 0 + 25 = 58.1 — the sum of the six BARS, which
       is thirty higher than the total printed beside them. Without this line
       a reader who adds the bars has no way to find out why. */
    expect(note).toContain('58.1');
    expect(note).toContain(`${SUSPICION_PENALTY} points were subtracted`);
  });

  it('says nothing was subtracted when the farm is not flagged', async () => {
    serve();
    renderDrilldown();
    await settled();

    expect(document.querySelector('[data-sum-note]')!.textContent).toContain(
      'Nothing has been subtracted'
    );
  });

  it('expands one pillar at a time, and the explanation matches the matview', async () => {
    const user = userEvent.setup();
    serve();
    renderDrilldown();
    await settled();

    const repeat = screen.getByRole('button', { name: /Repeat/ });
    expect(repeat).toHaveAttribute('aria-expanded', 'false');
    await user.click(repeat);
    expect(repeat).toHaveAttribute('aria-expanded', 'true');

    /* `repeat_b` is `d7_active / 7` over DISTINCT DAYS — the card used to call
       it a "consecutive-day closure streak", which the SQL does not compute. */
    const explainId = repeat.getAttribute('aria-controls')!;
    expect(document.getElementById(explainId)!.textContent).toContain('not a consecutive streak');
  });
});

/* ═══ 6. Band 3 — the timeline ══════════════════════════════════════════ */

describe('the 14-day grid (Band 3)', () => {
  it('scales each row against its OWN maximum and says so', async () => {
    serve();
    renderDrilldown();
    await settled();

    expect(document.querySelector('[data-scale-note]')!.textContent).toContain(
      'against its own busiest day'
    );

    /* One verification and four started closures on the same grid: per-row
       normalisation puts BOTH at the top of their own ramp. A shared scale
       would leave the single verification near the floor. */
    const verify = document.querySelector<HTMLElement>('[data-cell^="verifications:"][title$=": 1"]');
    const started = document.querySelector<HTMLElement>('[data-cell^="closuresStarted:"][title$=": 4"]');
    expect(verify!.style.backgroundColor).toContain('95%');
    expect(started!.style.backgroundColor).toContain('95%');
  });

  it('uses tokens for the two meanings it encodes, and no literals', async () => {
    serve();
    renderDrilldown();
    await settled();

    const error = document.querySelector<HTMLElement>('[data-cell^="errors:"][title$=": 2"]')!;
    const activity = document.querySelector<HTMLElement>('[data-cell^="closuresStarted:"][title$=": 4"]')!;
    expect(error.style.backgroundColor).toContain('var(--color-red-vivid)');
    expect(activity.style.backgroundColor).toContain('var(--color-blue-vivid)');
    for (const cell of document.querySelectorAll<HTMLElement>('[data-cell]')) {
      expect(cell.getAttribute('style') ?? '').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('refuses to call an all-zero grid a measured zero', async () => {
    /* The window is backfilled with zero rows OUTSIDE the try, so a failed
       query and a quiet farm arrive identically. */
    serve({ body: farmer({ timeline: timeline().map((d) => day(d.date)) }) });
    renderDrilldown();
    await settled();

    const grid = band('timeline')!;
    expect(within(grid).getByText(/Nothing was recorded on this farm in fourteen days/)).toBeInTheDocument();
    expect(grid.querySelector('[data-cell]')).toBeNull();
    expect(grid.textContent).toContain('backfilled with zero rows');
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
  it('carries the disclaimer byte-for-byte', async () => {
    serve();
    renderDrilldown();
    await settled();

    /* The constant IS the sentence — checked here so the assertion cannot
       drift into passing against a paraphrase. */
    expect(WORKER_DISCLAIMER).toBe(
      '(captured automatically from voice logs; reputation tracking not yet built)'
    );
    expect(band('workers')!.textContent).toContain(WORKER_DISCLAIMER);
  });

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

  it('renders a Marathi worker name through the one primitive (A34 — the LAST site)', async () => {
    serve();
    renderDrilldown();
    await settled();

    const row = within(band('workers')!).getByText('रामू');
    expect(row.getAttribute('data-script')).toBe('devanagari');

    /* The duplicated regex is gone from the file, not merely unused. */
    const src = readFileSync(
      resolve(process.cwd(), 'src/features/farmer-health/components/WorkerSummaryList.tsx'),
      'utf-8'
    );
    expect(src).not.toContain('const HAS_DEVANAGARI');
    expect(src).not.toContain('function fontFor');
  });

  it('shows only three facts per worker — no reputation, no payout, no score', async () => {
    serve();
    renderDrilldown();
    await settled();

    const row = within(band('workers')!).getByRole('list', { name: 'Worker list' })
      .firstElementChild as HTMLElement;
    expect(row.textContent).toContain('रामू');
    expect(row.textContent).toContain('7×');
    expect(row.textContent).toContain('since 02 Jul 2026');
    for (const forbidden of ['reputation', 'dispute', 'payout', 'skill', 'rating']) {
      expect(row.textContent?.toLowerCase()).not.toContain(forbidden);
    }
  });
});

/* ═══ 8. Band 5 — the two figures that were never measurements ══════════ */

describe('the ops blocks (Band 5)', () => {
  it('never prints "pending pushes" as a number — it is hard-coded server-side', async () => {
    serve();
    renderDrilldown();
    await settled();

    const pending = document.querySelector('[data-pending]')!;
    expect(pending.textContent).not.toContain('0');
    expect(pending.querySelector('[data-state="unmeasured"]')).not.toBeNull();
    expect(opsPanel('ops.errors')!.textContent).toContain('hard-coded to 0 in the repository');
  });

  it('draws the AI rates when there are invocations to take a ratio of', async () => {
    serve();
    renderDrilldown();
    await settled();

    const ai = opsPanel('ops.voice')!;
    expect(within(ai).getByText('94%')).toBeInTheDocument();
    expect(within(ai).getByText('71%')).toBeInTheDocument();
  });

  it('refuses the 100% the server substitutes when nothing was invoked (A38, inverted)', async () => {
    /* This is EXACTLY the payload `GetAiHealthAsync` returns from its catch,
       and the payload its SQL produces for an empty window: two perfect rates
       over a zero count. */
    serve({
      body: farmer({
        aiHealth: {
          voiceParseSuccessRate14d: 1,
          receiptParseSuccessRate14d: 1,
          invocationCount14d: 0,
        },
      }),
    });
    renderDrilldown();
    await settled();

    const ai = opsPanel('ops.voice')!;
    expect(ai.textContent).not.toContain('100%');
    expect(ai.querySelectorAll('[data-rate] [data-state="never"]')).toHaveLength(2);
    expect(ai.textContent).toContain('no ratio to take');
  });

  it('clamps and em-dashes a rate that is not a number (A38, as registered)', async () => {
    serve({
      body: farmer({
        aiHealth: {
          voiceParseSuccessRate14d: Number.NaN,
          receiptParseSuccessRate14d: 1.4,
          invocationCount14d: 12,
        },
      }),
    });
    renderDrilldown();
    await settled();

    const ai = opsPanel('ops.voice')!;
    expect(within(ai).getByText('100%')).toBeInTheDocument(); // 1.4 clamped, not rejected
    expect(ai.querySelectorAll('[data-rate] [data-state="unmeasured"]')).toHaveLength(1);
  });

  it('carries the C8 slate inset edge on both ops panels, from the token', async () => {
    serve();
    renderDrilldown();
    await settled();

    for (const grant of ['ops.errors', 'ops.voice']) {
      const style = opsPanel(grant)!.getAttribute('style') ?? '';
      expect(style).toContain('var(--color-ops-inset)');
      expect(style).not.toMatch(/rgba\(100, 116, 139/);
    }
    /* And no ordinary band wears it — the edge is what tells the two apart. */
    expect(band('score')!.getAttribute('style') ?? '').not.toContain('--color-ops-inset');
  });
});
