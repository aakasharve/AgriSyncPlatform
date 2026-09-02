import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter } from '@/test/stubAdapter';
import type { StubbedAdapter } from '@/test/stubAdapter';
import type { MeScopeResponse } from '@/hooks/useAdminScope';
import type { OpsHealthData } from '@/hooks/useOpsHealth';
import homeSource from '../HomePage.tsx?raw';
import HomePage from '../HomePage';

/**
 * HOME — the screen that told three lies at once, and the spec that keeps them
 * deleted.
 *
 * The central claims of this file, in the order they matter:
 *
 *  1. NO FABRICATED FRESHNESS (D5). Every chip states the age of a SERVER
 *     stamp, and a section with no stamp gets no chip. The deleted code
 *     computed `new Date()` and `Date.now() - 14h` at render, so it printed
 *     "Live · 1s ago" and "Nightly · 14h ago" over em dashes, forever. The
 *     fixtures below put their stamps at KNOWN OFFSETS — three hours and nine
 *     hours — so a chip reading the browser's clock reads "1s ago" and fails.
 *  2. R1–R8 READ NOT CHECKED (D8), and "all R1–R10 clear" cannot render.
 *  3. A TILE WITH NO SOURCE RENDERS AN ABSENCE, NEVER A ZERO.
 *  4. THE VOICE TILE'S TONE COMES FROM R10, so Ops Now cannot paint green the
 *     figure the Active Alerts tile beside it counts as a breach.
 *  5. THE CALL LIST IS A UNION, ONE ROW PER FARM, and it is deliberately NOT
 *     ordered by the event count — which counts successful AI calls (Task 16).
 *  6. IT ASKS FOR NOTHING IT MAY NOT READ. Home is the one screen with no route
 *     guard (A4), and a denial invalidates the cached scope and re-asks.
 *
 * SETTLE_WAIT — measured 2026-09-01 by Task 19 and carried with its reason.
 * Under full-suite parallelism forty-odd jsdom environments compete for the
 * same cores and a block has not always finished changing inside Testing
 * Library's 1000 ms default. Nothing is weakened; a real regression still
 * fails, it just fails after waiting. `vitest.config.ts` is untouched.
 *
 * MOUNT BUDGET, AND IT IS NOT A STYLE CHOICE. Task 24's first draft mounted its
 * screen fifteen times and took the suite from green to two failures in four
 * runs. THIS screen mounts FIVE hooks, so it is the most expensive mount in the
 * console. SIX mounts, one per fixture. The `it` blocks are long rather than
 * numerous, and no assertion was dropped to keep the count down.
 */

const SETTLE_WAIT = 15_000;
const ORG = '11111111-1111-1111-1111-111111111111';

const FARM_BOTH = '11111111-1111-1111-1111-111111111111';
const FARM_SILENT = '22222222-2222-2222-2222-222222222222';
const FARM_FAILING = '33333333-3333-3333-3333-333333333333';

/* ══════════════════════════════════════════════════════════ the clock ════ */

/**
 * STAMPS AT KNOWN OFFSETS, and this is the whole of the D5 proof.
 *
 * `fmt.age` renders "3h ago" for a three-hour-old instant and "1s ago" for one
 * computed at render, so an assertion on the exact age is an assertion that the
 * chip read the SERVER's clock. The fabrication cannot pass it.
 */
const HOURS = 3_600_000;
const threeHoursAgo = () => new Date(Date.now() - 3 * HOURS).toISOString();
const sixHoursAgo = () => new Date(Date.now() - 6 * HOURS).toISOString();
const nineHoursAgo = () => new Date(Date.now() - 9 * HOURS).toISOString();

/* ════════════════════════════════════════════════════════ the fixtures ═══ */

const ALL_MODULES = [
  'ops.live',
  'metrics.nsm',
  'farms.list',
  'farms.silent-churn',
  'farms.suffering',
];

function scopeBody(modules: string[]): MeScopeResponse {
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

/**
 * The REAL `/ops/health` body — NO ENVELOPE (A27), `computedAtUtc` at the top
 * level, and every field `OpsHealthData` declares. The `recentErrors` list
 * carries THREE event types, because the query does
 * (`AdminOpsRepository.cs:105`): only one of them is an API error.
 */
function opsHealth(over: Partial<OpsHealthData> = {}): OpsHealthData {
  const when = threeHoursAgo();
  return {
    voiceInvocations24h: 120,
    voiceFailures24h: 6,
    voiceFailureRatePct: 5,
    voiceAvgLatencyMs: 800,
    voiceP95LatencyMs: 2100,
    recentErrors: [
      { eventType: 'api.error', endpoint: '/sync/push', statusCode: 500, latencyMs: 120, farmId: null, occurredAtUtc: when },
      { eventType: 'api.error', endpoint: '/sync/push', statusCode: 500, latencyMs: 130, farmId: null, occurredAtUtc: when },
      { eventType: 'api.slow', endpoint: '/sync/push', statusCode: 200, latencyMs: 2400, farmId: null, occurredAtUtc: when },
      { eventType: 'client.error', endpoint: 'unknown', statusCode: null, latencyMs: null, farmId: null, occurredAtUtc: when },
    ],
    topSufferingFarms: [],
    apiErrorSpike: false,
    voiceDegraded: false,
    computedAtUtc: when,
    ...over,
  };
}

function envelope(data: unknown, lastRefreshedUtc: string | undefined, source = 'materialized') {
  return { data, meta: { source, lastRefreshedUtc, ttlSeconds: 300 } };
}

function wvfdBody(over: Record<string, unknown> = {}) {
  return {
    currentWvfd: 3.2,
    priorWvfd: 3.0,
    goalWvfd: 4.5,
    weeks: [
      { weekStart: '2026-08-24T00:00:00.0000000Z', avgWvfd: 3.0, activeFarms: 14 },
      { weekStart: '2026-08-31T00:00:00.0000000Z', avgWvfd: 3.2, activeFarms: 15 },
    ],
    topFarms: [],
    ...over,
  };
}

function farmsBody(totalCount: number, items: unknown[] = [{ farmId: FARM_BOTH }]) {
  return { items, totalCount, page: 1, pageSize: 1 };
}

/** The REAL `SufferingItemDto` (`AdminMisRepository.cs:240-242`). */
function sufferingRow(farmId: string, name: string, over: Record<string, unknown> = {}) {
  return {
    farmId,
    name,
    errorCount: 40,
    syncErrors: 5,
    logErrors: 1,
    voiceErrors: 2,
    lastErrorAt: sixHoursAgo(),
    ...over,
  };
}

/** The REAL `SilentChurnItemDto` (`AdminMisRepository.cs:209-215`). */
function churnRow(farmId: string, name: string, over: Record<string, unknown> = {}) {
  return {
    farmId,
    name,
    ownerPhone: '98******10',
    plan: 'trial',
    weeksSilent: 4,
    lastLogAt: '2026-08-02T04:00:00.0000000Z',
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════ the harness ══ */

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

interface ServeOptions {
  modules?: string[];
  health?: OpsHealthData;
  wvfd?: Record<string, unknown>;
  farms?: unknown;
  suffering?: unknown[];
  churn?: unknown[];
  /** Drop the top-level server stamp — the "no timestamp" branch. */
  noHealthStamp?: boolean;
  /** Drop the envelopes' stamps — the same branch, materialized side. */
  noMetaStamp?: boolean;
}

function serve(options: ServeOptions = {}) {
  const {
    modules = ALL_MODULES,
    health = opsHealth(),
    wvfd = wvfdBody(),
    farms = farmsBody(16),
    suffering = [],
    churn = [],
    noHealthStamp = false,
    noMetaStamp = false,
  } = options;

  const stamp = noMetaStamp ? undefined : nineHoursAgo();

  stub = installAdapter(async (req) => {
    if (req.url.includes('/me/scope')) return { status: 200, data: scopeBody(modules) };
    if (req.url.includes('/ops/health')) {
      return {
        status: 200,
        data: noHealthStamp ? { ...health, computedAtUtc: undefined } : health,
      };
    }
    if (req.url.includes('/metrics/wvfd')) return { status: 200, data: envelope(wvfd, stamp) };
    if (req.url.includes('/admin/farms/suffering')) {
      return { status: 200, data: envelope(suffering, stamp, 'live-aggregated') };
    }
    if (req.url.includes('/admin/farms/silent-churn')) {
      return { status: 200, data: envelope(churn, stamp) };
    }
    if (req.url.includes('/admin/farms')) return { status: 200, data: envelope(farms, stamp) };
    return { status: 404, data: {} };
  });
  return stub;
}

function renderHome() {
  return renderWithProviders(<HomePage />, { route: `/?org=${ORG}` });
}

/** A KPI tile, found by its label and walked up to the element that carries the
 *  honesty state. Narrow on purpose: an assertion over the whole page would
 *  pass on any other tile's words — the toothless-assertion trap Task 17 met. */
function tile(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-state]');
  if (!el) throw new Error(`no tile for ${label}`);
  return el as HTMLElement;
}

function callRows(): HTMLTableRowElement[] {
  const list = document.querySelector('[data-list="should-call-today"]');
  if (!list) return [];
  return [...list.querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter(
    (tr) => !tr.id.includes('detail'),
  );
}

function dotFor(section: string): Element | null {
  return document.querySelector(`[data-section="${section}"] [data-section-dot]`);
}

/** The source with comments stripped. Every "must not contain" runs against
 *  THIS: the file names the defects it deleted, and an assertion over the raw
 *  text would be failed by its own explanation. */
const homeCode = homeSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

it('read the real source, not an empty stub', () => {
  expect(homeSource.length).toBeGreaterThan(2000);
  expect(homeSource).toContain('export default function HomePage');
});

/* ═══════════════════════════ MOUNT 1 — the whole board, everything granted */

describe('every feed answering', () => {
  it('states the server’s age, counts only the rules it read, and reports each tile honestly', async () => {
    serve({
      suffering: [
        sufferingRow(FARM_BOTH, 'Wagholi Grapes', { errorCount: 40 }),
        /* THE BIGGEST NUMBER AND THE FEWEST REASONS — the row an
           events-descending sort would put first. */
        sufferingRow(FARM_FAILING, 'Sinnar Tomato', { errorCount: 900 }),
      ],
      churn: [churnRow(FARM_BOTH, 'Wagholi Grapes'), churnRow(FARM_SILENT, 'Ozar Onion')],
    });
    renderHome();
    await screen.findByText('Ops Now', undefined, { timeout: SETTLE_WAIT });
    await waitFor(() => expect(callRows()).toHaveLength(3), { timeout: SETTLE_WAIT });

    /* ── D5: the SERVER's clock, never the browser's ──────────────────── */
    /* `computedAtUtc` is three hours old and the envelopes are nine, so these
       two strings can only appear if the chips read what the server sent. */
    expect(screen.getByText('Live · 3h ago')).toBeInTheDocument();
    expect(screen.getAllByText('Nightly · 9h ago').length).toBe(2);
    expect(screen.queryByText('Live · 1s ago')).toBeNull();
    expect(screen.queryByText('Nightly · 14h ago')).toBeNull();
    /* And it cannot be reintroduced quietly: neither expression survives
       anywhere in the file's CODE (comments stripped — the header names both
       by quoting the deleted lines). */
    expect(homeCode).not.toContain('new Date()');
    expect(homeCode).not.toContain('Date.now()');

    /* ── D8: two rules counted, eight named as unchecked ──────────────── */
    const alerts = tile('Active alerts');
    /* Both read, both clear — a MEASURED zero, which is a different fact from
       the hardcoded `value={0}` this tile used to carry. */
    expect(alerts).toHaveAttribute('data-state', 'ok');
    expect(within(alerts).getByText('0')).toBeInTheDocument();
    expect(within(alerts).getByText(/2 of 2 rules read at/)).toBeInTheDocument();
    expect(within(alerts).getByText(/R1–R8/)).toBeInTheDocument();
    expect(within(alerts).getByText(/are NOT CHECKED/)).toBeInTheDocument();
    /* The claim itself must be unrenderable. */
    expect(screen.queryByText(/all R1–R10 clear/)).toBeNull();
    expect(homeCode).not.toContain('R1–R10 clear');

    /* ── the errors tile: one event type, over the window that exists ─── */
    const errors = tile('API errors · last 2 hours');
    /* Four events arrived and TWO are `api.error`. Counting all four would be
       the "they are not all API errors" conflation Task 16 corrected. */
    expect(errors).toHaveAttribute('data-state', 'ok');
    expect(within(errors).getByText('2')).toBeInTheDocument();
    expect(within(errors).getByText(/out of 4 events read at/)).toBeInTheDocument();
    /* Re-pointed at the plain-language wording, 2026-09-02. The claim guarded
       is the window — this tile reads two hours, not the twenty-four its
       neighbours read — and it is still asserted. */
    expect(
      within(errors).getByText(/The last TWO hours, not the last twenty-four/),
    ).toBeInTheDocument();

    /* ── the three tiles with no endpoint: an absence, never a zero ───── */
    for (const label of ['Logs today', 'D30 retention', 'MRR']) {
      const t = tile(label);
      /* The KpiCard forced-grey rule from Task 3, observed rather than
         assumed: not-`ok` is grey and an em dash whatever tone was asked for. */
      expect(t).toHaveAttribute('data-state', 'unmeasured');
      expect(t).toHaveAttribute('data-tone', 'grey');
      expect(within(t).getByText('—')).toBeInTheDocument();
      expect(within(t).getByText('not measured')).toBeInTheDocument();
      expect(within(t).getByText(/there is no endpoint behind this tile/)).toBeInTheDocument();
      expect(within(t).queryByText('0')).toBeNull();
    }
    /* Two of them say something stronger than "not built". */
    expect(within(tile('D30 retention')).getByText(/metrics\.retention/)).toBeInTheDocument();
    expect(within(tile('MRR')).getByText(/no amount and no currency/)).toBeInTheDocument();

    /* ── the farm count is not a count of ACTIVE farms ────────────────── */
    const farms = tile('Farms on record');
    expect(farms).toHaveAttribute('data-state', 'ok');
    expect(within(farms).getByText('16')).toBeInTheDocument();
    expect(within(farms).getByText(/no activity filter/)).toBeInTheDocument();
    expect(screen.queryByText('Active Farms')).toBeNull();

    /* ── WVFD carries the two caveats the North Star screen established ─ */
    const w = tile('WVFD');
    expect(w).toHaveAttribute('data-state', 'ok');
    expect(within(w).getByText('3.2')).toBeInTheDocument();
    /* The goal is the SERVER's constant, printed from the response and never
       from a client-side 4.5. */
    expect(within(w).getByText(/goal 4\.5 — a constant in the API/)).toBeInTheDocument();
    /* Re-pointed at the plain-language wording, 2026-09-02. The claim guarded
       is that the tile warns the newest week is incomplete, so a Monday dip is
       not a finding. Still asserted, in words a new support hire can read. */
    expect(
      within(w).getByText(/newest week is always half-finished/),
    ).toBeInTheDocument();
    /* A partial week is not a verdict. */
    expect(w).not.toHaveAttribute('data-tone', 'green');

    /* ── the dots, each with a WORD, worst state winning ──────────────── */
    /* Ops: both rules clear, but Logs Today has no source — so the band is
       unmeasured rather than green. */
    expect(dotFor('Ops now')).toHaveAttribute('data-section-dot', 'unmeasured');
    expect(screen.getByText('1 of these 4 figures have no reading')).toBeInTheDocument();
    /* Business: two of four were never built, so it can never be green. */
    expect(dotFor('Business')).toHaveAttribute('data-section-dot', 'unmeasured');
    expect(screen.getByText('2 of these 4 figures have no reading')).toBeInTheDocument();
    /* Attention: three farms flagged, and attention outranks unmeasured. */
    expect(dotFor('Needs attention')).toHaveAttribute('data-section-dot', 'attention');
    expect(screen.getByText('3 farms need a person today')).toBeInTheDocument();

    /* ── the union: one row per farm, every reason ────────────────────── */
    const rows = callRows();
    const both = rows.find((r) => r.textContent?.includes('Wagholi Grapes'))!;
    /* Flagged twice, listed once, carrying both pills. A concatenation would
       have produced four rows. */
    expect(within(both).getByText('Failed events')).toBeInTheDocument();
    expect(within(both).getByText('Silent 4 full weeks')).toBeInTheDocument();

    const silentOnly = rows.find((r) => r.textContent?.includes('Ozar Onion'))!;
    expect(within(silentOnly).getByText('Silent 4 full weeks')).toBeInTheDocument();
    expect(within(silentOnly).queryByText('Failed events')).toBeNull();
    /* "Not on the other watchlist" is not "zero". */
    expect(within(silentOnly).getAllByText('not measured').length).toBeGreaterThan(0);

    /* ── the order, and the decision behind it ────────────────────────── */
    /* `error_count` is a bare COUNT(*) that admits successful AI calls, so
       ranking a CALL list by it puts the heaviest, happiest users first. The
       fixture makes the two orders differ: Sinnar Tomato holds the largest
       count (900) and the fewest reasons. */
    const names = callRows().map((r) => r.querySelector('td')?.textContent?.trim() ?? '');
    expect(names[0]).toContain('Wagholi Grapes');
    expect(names[1]).toContain('Ozar Onion');
    expect(names[2]).toContain('Sinnar Tomato');
    /* Re-pointed at the plain-language wording, 2026-09-02. The claim guarded
       is that the screen STATES its fixed order — a list a reader cannot
       re-sort has to say what it is sorted by. */
    expect(
      screen.getByText(/Sorted by how many problems a farm has/),
    ).toBeInTheDocument();

    /* ── THE CORRECTION IS STILL ON SCREEN, AND STILL UNFOLDED ─────────────
     *
     * This used to assert the sentence "heaviest, happiest users at the top".
     * The 2026-09-02 copy pass rewrote it in plain language, so the old string
     * is gone — but what it was PROTECTING is not a string, it is a property:
     * the reader must be told, without clicking anything, that the number in
     * the "Events counted" column is not a count of problems. Without that,
     * they ring the busiest, happiest farmer on the platform (defect A1).
     *
     * So the assertion moved from the wording to the property. Both halves
     * matter: the sentence is present, AND it is not inside a disclosure. The
     * same pass folded every other caveat on this screen; this is the one it
     * was not allowed to fold, and this is what stops a later pass folding it
     * for tidiness. */
    const correction = screen.getByText(/is not a count of problems/);
    expect(correction).toBeVisible();
    expect(correction.closest('[data-disclosure]')).toBeNull();

    /* And the detail that DID fold is still in the page — collapsed, not
     * deleted. `Disclosure` renders its children whether open or shut. */
    const built = screen.getByRole('button', { name: /how this list is built/i });
    expect(built).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/treat this as today/i)).toBeInTheDocument();
    /* Task 16's name for the figure, carried onto this screen — never
       "Errors", which is what the column does not count. */
    expect(screen.getByRole('columnheader', { name: /Events counted/ })).toBeInTheDocument();
  });
});

/* ═══════════════════════════ MOUNT 2 — R10 breached, and the tone follows */

describe('the voice tile takes its tone from the rule, not from its own field', () => {
  it('cannot paint green the figure the alerts tile beside it counts as a breach', async () => {
    serve({ health: opsHealth({ voiceDegraded: true }) });
    renderHome();
    await screen.findByText('Ops Now', undefined, { timeout: SETTLE_WAIT });

    await screen.findByText(/R10 · Voice degraded is in BREACH/, undefined, {
      timeout: SETTLE_WAIT,
    });
    const voice = tile('AI call success · 24h');
    expect(voice).toHaveAttribute('data-state', 'ok');
    /* 5% failures is 95% success. A tile taking its tone from its own field
       paints that green, beside an Active Alerts tile reading 1. */
    /* `fmt.pct` carries one decimal. */
    expect(within(voice).getByText('95.0%')).toBeInTheDocument();
    expect(voice).toHaveAttribute('data-tone', 'amber');

    /* It says WHICH rule judged it, in that rule's own words — read from the
       same declaration Live Health reads, so the two cannot disagree. */
    expect(within(voice).getByText(/R10 · Voice degraded is in BREACH/)).toBeInTheDocument();
    expect(within(voice).getByText(/above 20% in 6 hours/)).toBeInTheDocument();
    /* And it does NOT claim this figure breached that rule: R10 reads six
       hours, this covers twenty-four, and Live Health already says so. */
    expect(within(voice).getByText(/not the same reading/)).toBeInTheDocument();

    const alerts = tile('Active alerts');
    expect(within(alerts).getByText('1')).toBeInTheDocument();
    expect(alerts).toHaveAttribute('data-tone', 'red');
  });
});

/* ═══════════════════ MOUNT 3 — no entitlements, and therefore no requests */

describe('the one ungated screen asks for nothing it may not read', () => {
  it('issues no data request, claims no measurement, and shows no dot where there is nothing to report', async () => {
    /* ONE key, not none. A positive gate — the farm count arriving proves the
       scope resolved and that an ENTITLED request really went out — and it
       proves the gate is per-key rather than all-or-nothing. */
    serve({ modules: ['farms.list'] });
    renderHome();
    await screen.findByText('16', undefined, { timeout: SETTLE_WAIT });
    expect(tile('Active alerts')).toHaveAttribute('data-state', 'unmeasured');

    /* Home carries no route guard, so an unentitled request would 403, which
       invalidates the cached scope, which re-renders this screen, which asks
       again. Fail closed at the REQUEST. */
    const asked = stub!.requests.map((r) => r.url);
    expect(asked.some((u) => u.includes('/ops/health'))).toBe(false);
    expect(asked.some((u) => u.includes('/metrics/wvfd'))).toBe(false);
    expect(asked.some((u) => u.includes('/admin/farms/suffering'))).toBe(false);
    expect(asked.some((u) => u.includes('/admin/farms/silent-churn'))).toBe(false);
    /* And the one it MAY read, it read. */
    expect(asked.some((u) => u.includes('/admin/farms?page=1'))).toBe(true);

    /* "Not measured" would be false — it IS measured, and not for them. The
       caption names the grant, so an operator asking for access can name one. */
    expect(within(tile('Active alerts')).getByText(/gated on ops\.live/)).toBeInTheDocument();
    expect(within(tile('WVFD')).getByText(/gated on metrics\.nsm/)).toBeInTheDocument();
    /* And the tile it IS entitled to reports a reading rather than a grant. */
    expect(tile('Farms on record')).toHaveAttribute('data-state', 'ok');

    /* No list, and a sentence in its place that is not a zero. */
    expect(document.querySelector('[data-list="should-call-today"]')).toBeNull();
    /* Same claim, plainer words: an empty screen here is a permission fact,
       never a measurement. Read from the paragraph rather than its direct text
       nodes, because the sentence now carries a bold span. */
    expect(document.body.textContent).toMatch(/This is not a count of zero/);

    /* A dot that means nothing teaches a reader to ignore all of them. */
    expect(dotFor('Ops now')).toBeNull();
    expect(dotFor('Needs attention')).toBeNull();
  });
});

/* ══════════════ MOUNT 4 — the server substitutes, and nothing is claimed */

describe('a substituted answer is not a reading', () => {
  it('believes neither the five voice zeros, nor an empty error list, nor a zero farm count, nor the WVFD sentinel', async () => {
    serve({
      health: opsHealth({
        /* The voice query's catch substitutes (0,0,0,0,0) and still answers
           200 — the signature Task 20 established on Live Health. */
        voiceInvocations24h: 0,
        voiceFailures24h: 0,
        voiceFailureRatePct: 0,
        voiceAvgLatencyMs: 0,
        voiceP95LatencyMs: 0,
        /* `catch { }` over a pre-declared empty list: no rows and a failed
           read are the same response. */
        recentErrors: [],
        /* `null` is what the endpoint sends when it could not read the view. */
        apiErrorSpike: null,
        voiceDegraded: null,
      }),
      /* `catch { return new FarmsListDto([], 0, page, pageSize) }` (`:145`). */
      farms: farmsBody(0, []),
      /* `catch { return new WvfdHistoryDto(0m, null, 4.5m, [], []) }` — the
         one swallow site that returns a COMPLETE set of numbers. */
      wvfd: wvfdBody({ currentWvfd: 0, priorWvfd: null, weeks: [], topFarms: [] }),
    });
    renderHome();
    /* The gate is the sentence that can only be written once the body has
       ARRIVED with five zeros in it. An `unmeasured` tile is also what an
       unanswered request looks like, so waiting for one would be waiting for
       nothing. */
    await screen.findByText(/all five voice figures came back as zero/, undefined, {
      timeout: SETTLE_WAIT,
    });

    const voice = tile('AI call success · 24h');
    expect(voice).toHaveAttribute('data-state', 'unmeasured');

    const errors = tile('API errors · last 2 hours');
    expect(errors).toHaveAttribute('data-state', 'unmeasured');
    expect(within(errors).queryByText('0')).toBeNull();
    expect(within(errors).getByText(/also what it returns when the query fails/)).toBeInTheDocument();

    const farms = tile('Farms on record');
    expect(within(farms).queryByText('0')).toBeNull();
    expect(within(farms).getByText(/which is also its failure path/)).toBeInTheDocument();

    const w = tile('WVFD');
    expect(w).toHaveAttribute('data-state', 'unmeasured');
    /* The old page printed "0.0" here, under a hardcoded "goal 4.5". */
    expect(within(w).queryByText('0.0')).toBeNull();
    expect(within(w).getByText(/no week in the window carries a reading/)).toBeInTheDocument();

    /* Neither rule could be read, so there is no count of breaches either —
       and an unread rule is not a clear one. */
    const alerts = tile('Active alerts');
    expect(alerts).toHaveAttribute('data-state', 'unmeasured');
    expect(within(alerts).getByText(/neither R9 nor R10 could be read/)).toBeInTheDocument();
    expect(within(alerts).queryByText('0')).toBeNull();
  });
});

/* ═════════════════ MOUNT 5 — empty watchlists are not proof of health ═══ */

describe('an empty call list', () => {
  it('is not claimed as a measured zero, because both feeds swallow their own failures', async () => {
    serve({ suffering: [], churn: [] });
    renderHome();
    await screen.findByText('Ops Now', undefined, { timeout: SETTLE_WAIT });

    expect(
      await screen.findByText(/cannot be claimed as a measured zero/, undefined, {
        timeout: SETTLE_WAIT,
      }),
    ).toBeInTheDocument();
    /* The server stamp, qualified: it is when the list was READ, and the
       matviews behind it are rebuilt once a night. */
    expect(
      screen.getAllByText(/both watchlists are rebuilt only once a night/).length,
    ).toBeGreaterThan(0);
    expect(callRows()).toHaveLength(0);
    /* It answered and named nobody, so the section is healthy — and the
       sentence beside the dot says which of those two things happened. */
    expect(dotFor('Needs attention')).toHaveAttribute('data-section-dot', 'healthy');
    expect(screen.getByText('no farm needs a person today')).toBeInTheDocument();
  });
});

/* ═══════════════════════ MOUNT 6 — a server that sends no stamp at all ══ */

describe('a chip may only state an age it has', () => {
  it('renders no chip at all when the server sent no timestamp', async () => {
    serve({ noHealthStamp: true, noMetaStamp: true });
    renderHome();
    /* The farm count proves every feed answered. Waiting for "no server
       timestamp" would prove nothing — it is also what the screen shows before
       the first response. */
    await screen.findByText('16', undefined, { timeout: SETTLE_WAIT });
    expect(screen.getAllByText('no server timestamp').length).toBe(3);

    /* Not "Live · now", not "Nightly · recent", and not even the chip's own
       "age not reported" backstop: a section with no stamp renders no chip. */
    expect(document.querySelector('.chip-fresh')).toBeNull();
    expect(screen.queryByText(/Live ·/)).toBeNull();
    expect(screen.queryByText(/Nightly ·/)).toBeNull();
  });
});
