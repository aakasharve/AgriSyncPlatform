import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import type { WvfdFarmRow, WvfdHistory, WvfdWeek } from '@/hooks/useWvfd';
import NorthStarPage from '../NorthStarPage';

/**
 * NORTH STAR — WVFD. Three claims are central, and each is proven by breaking
 * its source rather than by reading the screen and agreeing with it.
 *
 *  1. THE WINDOW REACHES ALL FOUR PLACES — hook argument, QUERY KEY, query
 *     string, interpolated title. The key is the one that fails silently:
 *     drop `weeks` from `['metrics','wvfd',org,weeks]` and 8, 12 and 24 share
 *     one cache entry, react-query issues no request (staleTime is five
 *     minutes) and the screen draws twelve weeks under a heading that says
 *     twenty-four, with no request, no error and nothing for a reader to
 *     notice. The FIRST assertion after the click is therefore that a SECOND
 *     request went out, so a collision names itself instead of surfacing as a
 *     stale number three assertions later.
 *
 *  2. A NEVER-COMPUTED WEEK IS A HOLE AND A MEASURED ZERO IS A ZERO. Both, in
 *     the picture and in the table, from one fixture that holds both. v3's own
 *     sample has two such weeks — 15 and 22 June — and those are the two used
 *     here, because the live chart would have drawn them as a trough and a
 *     trough is a story about the business that did not happen.
 *
 *  3. NO FABRICATED NUMBER SURVIVES AN ANSWER THAT CARRIES NOTHING. This is
 *     the sharpest one on this screen, because the endpoint's own failure path
 *     is `catch { return new WvfdHistoryDto(0m, null, 4.5m, [], []); }`
 *     (`AdminMisRepository.cs:78`) — it answers a database failure with HTTP
 *     200 AND A COMPLETE SET OF NUMBERS. The old page then added four more of
 *     its own: `?? '0.0'` for the current figure and `?? '4.5'` three times
 *     for the goal (`NorthStarPage.tsx:84,97,125,126`), over a hardcoded
 *     `ReferenceLine y={4.5}`. The exact swallow payload is served below and
 *     nothing on screen may print a figure from it.
 *
 * FIXTURES STUB `lastRefreshedUtc`, THE SPELLING THE SERVER SENDS. A fixture
 * that stubs `lastRefreshed` is why an inverted envelope type survived on
 * every screen until `7a742b05`. It is load-bearing twice over here: the "read
 * at" line AND the right-hand edge of the axis are both taken from it.
 *
 * SIX MOUNTS. Tasks 15-19 each measured a timing cliff on this suite; Task 19
 * found it was `findBy`/`waitFor` on the 1000ms default and fixed it at
 * `558b6a9d`. `SETTLE_WAIT` below is that fix, and the mount count is kept
 * under the seven Task 19 measured as safe. `vitest.config.ts` is untouched.
 */

const ORG = '11111111-1111-1111-1111-111111111111';

/**
 * 08:30 UTC on Tuesday 1 September — the moment the server SERVED the request
 * (`GetWvfdHistoryHandler.cs:19` is `DateTime.UtcNow`), which is the same
 * clock the SQL's `CURRENT_DATE` window is measured from.
 */
const READ_AT = '2026-09-01T08:30:00.0000000Z';

/**
 * A 12-week window anchored on that Tuesday spans TWELVE Mondays, 15 Jun to
 * 31 Aug. Computed, not assumed: the SQL is `week_start >= CURRENT_DATE -
 * INTERVAL '84 days'`, so the oldest slot is the first Monday on or after
 * 9 June — which is 15 June — and the newest is the Monday of the anchor's own
 * week. (Anchor the window on a Monday and it spans thirteen; that is
 * arithmetic, and it is why the axis is derived rather than counted.)
 */
const WEEKS_IN_12 = 12;
const OLDEST = '2026-06-15';
const NEWEST = '2026-08-31';
/** Its slot label, through `DATE_FORMATS.nsmWeek`. */
const NEWEST_LABEL = '31 Aug';

function week(weekStart: string, avgWvfd: number, activeFarms = 12): WvfdWeek {
  return { weekStart, avgWvfd, activeFarms };
}

function farm(n: number, wvfd: number, engagementTier: WvfdFarmRow['engagementTier']): WvfdFarmRow {
  return {
    farmId: `f${String(n).padStart(3, '0')}0000-0000-0000-0000-00000000000${n % 10}`,
    wvfd,
    engagementTier,
    /* ALWAYS 0 from the server (`AdminMisRepository.cs:65`) and never
       rendered. Stubbed at 0 so a screen that started printing it would print
       the fabrication the real feed sends. */
    activeFarms: 0,
  };
}

/** The real envelope: `AdminMetaDto("materialized", $"last {weeks} weeks",
 *  DateTime.UtcNow, 300)` over a `WvfdHistoryDto`. */
function envelope(
  history: Partial<WvfdHistory>,
  meta: { window?: string | null; lastRefreshedUtc?: string | null } = {},
) {
  const { window: w = 'last 12 weeks', lastRefreshedUtc = READ_AT } = meta;
  return {
    data: {
      currentWvfd: 0,
      priorWvfd: null,
      goalWvfd: 4.5,
      weeks: [],
      topFarms: [],
      ...history,
    },
    meta: {
      source: 'materialized',
      ...(w === null ? {} : { window: w }),
      ...(lastRefreshedUtc === null ? {} : { lastRefreshedUtc }),
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

function serve(history: Partial<WvfdHistory>, meta?: Parameters<typeof envelope>[1]) {
  stub = installAdapter(async () => ({ status: 200, data: envelope(history, meta) }));
  return stub;
}

function renderNsm(route = `/metrics/nsm?org=${ORG}`) {
  return renderWithProviders(<NorthStarPage />, { route });
}

/* ── the regions, addressed by their own hooks rather than by class ─────── */

function kpis(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-kpis="wvfd"]')!;
}

/** One tile, found by its label. Every assertion on a figure reads THE VALUE
 *  ELEMENT — not the tile, whose text also holds the caption and the note, so
 *  an assertion on the whole tile would pass on a number in a sentence. */
function tile(label: string): HTMLElement {
  return within(kpis()).getByText(label).closest('[data-state]') as HTMLElement;
}

function tileValue(label: string): string {
  return (tile(label).firstElementChild as HTMLElement).textContent!.trim();
}

function chart(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-chart="wvfd-weeks"]')!;
}

function tableRows(): HTMLTableRowElement[] {
  return [
    ...document.querySelectorAll<HTMLTableRowElement>('[data-chart-table="wvfd-weeks"] tbody tr'),
  ];
}

function rowFor(label: string): HTMLTableRowElement {
  const row = tableRows().find((tr) => tr.querySelector('th')?.textContent?.trim() === label);
  if (!row) throw new Error(`no row for ${label} — rows are ${tableRows().length}`);
  return row;
}

/** ONE CELL, never the row. Task 17 found a mutation surviving because an
 *  assertion read a whole row and every row happened to contain the string it
 *  looked for. Columns are Average WVFD, Farms with a row, Share of goal. */
function cell(label: string, index: number): string {
  return rowFor(label).querySelectorAll('td')[index].textContent!.trim();
}

/**
 * SETTLE_WAIT — measured 2026-09-01, and NOT a tolerance for slow tests.
 *
 * These waits used Testing Library's 1000ms default. Under full-suite
 * parallelism 38 jsdom environments compete for the same cores and a lazily
 * resolved route had not always finished, so an assertion that a state is
 * ABSENT ran while the previous state was still on screen — a failure that
 * reads like a product defect and is not one. Fixed at `558b6a9d`; nothing is
 * weakened, a real regression still fails, it just fails after waiting.
 */
const SETTLE_WAIT = 15_000;

async function settled() {
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /Loading/ })).toHaveLength(0), {
    timeout: SETTLE_WAIT,
  });
}

/* ═══════════ 1. the window — hook arg, query key, query string, title ════ */

describe('the week window reaches all four places (A18, A19, B5)', () => {
  it('changes the request, the cache entry and the title — and refuses a value the server would clamp', async () => {
    const user = userEvent.setup();
    stub = installAdapter(async (req) => {
      const asked = Number(/weeks=(\d+)/.exec(req.url)?.[1] ?? 12);
      return {
        status: 200,
        data: envelope(
          {
            currentWvfd: 3.6,
            priorWvfd: null,
            goalWvfd: 4.5,
            weeks: [week(NEWEST, 3.6, asked === 24 ? 99 : 14)],
          },
          { window: `last ${asked} weeks` },
        ),
      };
    });

    /* `?weeks=999` first, because the old page passed the URL's value through
       unchecked: `?weeks=x` produced the literal request `?weeks=NaN` against
       a non-nullable `int` (a 400), and `?weeks=2` was silently answered as 4
       by the server's own clamp (`AdminEndpoints.cs:167`). */
    renderNsm(`/metrics/nsm?org=${ORG}&weeks=999`);
    await settled();

    expect(stub.requests[0].url).toBe('/shramsafal/admin/metrics/wvfd?weeks=12');
    expect(screen.getByText(/outside the 4 to 52 the server accepts/)).toHaveTextContent('999');
    expect(screen.getByRole('heading', { name: /WVFD — last 12 weeks/ })).toBeVisible();
    expect(tileValue('Farms with a row that week')).toBe('14');

    const before = stub.requests.length;
    await user.click(screen.getByRole('button', { name: '24 weeks' }));

    /*
     * ASSERTED FIRST, ON PURPOSE. This is the query-key assertion: if `weeks`
     * leaves `['metrics','wvfd',org,weeks]`, the 24-week view resolves to the
     * 12-week cache entry, react-query issues no request, and the screen
     * quietly draws twelve weeks under a heading that says twenty-four.
     */
    await waitFor(() =>
      expect(
        stub!.requests.length,
        'switching the window issued no new request — 8, 12 and 24 are sharing one cache entry, so the figures on screen belong to the previous window while the title and the URL claim the new one',
      ).toBeGreaterThan(before),
    );

    expect(stub.requests[stub.requests.length - 1].url).toBe(
      '/shramsafal/admin/metrics/wvfd?weeks=24',
    );
    expect(
      await screen.findByRole('heading', { name: /WVFD — last 24 weeks/ }, { timeout: SETTLE_WAIT }),
    ).toBeVisible();
    await waitFor(() => expect(tileValue('Farms with a row that week')).toBe('99'));
  });
});

/* ══ 2. a hole is not a trough, a zero is a zero, and every tile is the
      rows underneath it — ONE FIXTURE, ONE MOUNT ════════════════════ */

describe('holes, zeros, and figures that are the rows underneath them', () => {
  /**
   * TEN MEASURED WEEKS IN A TWELVE-WEEK AXIS, and every number is
   * load-bearing:
   *
   *   15 Jun, 22 Jun  absent entirely — the two weeks v3's own sample has no
   *                   row for, which the live chart would draw as a trough
   *    3 Aug  0.0     a MEASURED zero, which keeps its 0 and is drawn as a bar
   *   31 Aug  3.6     the headline week, and the newest slot on the axis
   *   24 Aug  3.2     the week the delta is actually against
   *
   * `currentWvfd` and `priorWvfd` are stubbed at the values the server would
   * compute from those rows (`weekRows[^1]` and `weekRows[^2]`), so the tiles
   * are checked against the table underneath them rather than against a
   * constant. Fifty farms, which is the server's own `LIMIT`, so the tier
   * chips are in their truncated branch.
   */
  it('draws, tabulates and describes them all without collapsing any two', async () => {
    serve({
      currentWvfd: 3.6,
      priorWvfd: 3.2,
      goalWvfd: 4.5,
      weeks: [
        week('2026-06-29', 1.2, 9),
        week('2026-07-06', 1.8, 10),
        week('2026-07-13', 2.1, 11),
        week('2026-07-20', 2.4, 11),
        week('2026-07-27', 2.9, 12),
        week('2026-08-03', 0, 5),
        week('2026-08-10', 3.1, 13),
        week('2026-08-17', 3.3, 13),
        week('2026-08-24', 3.2, 14),
        week(NEWEST, 3.6, 14),
      ],
      topFarms: [
        ...Array.from({ length: 5 }, (_, i) => farm(i, 6, 'A')),
        ...Array.from({ length: 20 }, (_, i) => farm(10 + i, 3, 'B')),
        ...Array.from({ length: 20 }, (_, i) => farm(30 + i, 1, 'C')),
        ...Array.from({ length: 5 }, (_, i) => farm(50 + i, 0, 'D')),
      ],
    });
    renderNsm();
    await settled();

    expect(tableRows()).toHaveLength(WEEKS_IN_12);
    expect(rowFor('15 Jun')).toBeInTheDocument();
    expect(rowFor('31 Aug')).toBeInTheDocument();

    /* ── the holes, in words. A hatch a reader has to interpret is a legend. */
    expect(screen.getByText(/2 of 12 periods were never measured/)).toBeInTheDocument();

    /* ── the holes, in the table: ONE honest cell each, never three zeroes. */
    for (const label of ['15 Jun', '22 Jun']) {
      const gap = rowFor(label);
      expect(gap).toHaveAttribute('data-state', 'gap');
      expect(gap.querySelectorAll('td')).toHaveLength(1);
      expect(gap.querySelector('td')!.textContent).toContain('not measured');
      expect(gap.textContent).not.toMatch(/\b0\b/);
    }

    /* ── the measured zero, IN ITS OWN CELL. Reading the whole row would pass
       on the word "0" appearing anywhere in it. */
    const zeroWeek = rowFor('3 Aug');
    expect(zeroWeek).toHaveAttribute('data-state', 'value');
    expect(cell('3 Aug', 0)).toBe('0.00');
    expect(cell('3 Aug', 1)).toBe('5');
    expect(cell('3 Aug', 2)).toBe('0.0%');

    /* ── the headline week's row, which the tiles are checked against. */
    expect(cell(NEWEST_LABEL, 0)).toBe('3.60');
    expect(cell(NEWEST_LABEL, 1)).toBe('14');
    expect(cell(NEWEST_LABEL, 2)).toBe('80.0%');

    /* ── the picture: one series, so exactly two hatches. The query is scoped
       to the `role="img"` series, because the shell's own table marks its gap
       ROWS with the same attribute and an unscoped count would pass on two
       table rows and no hatch at all. */
    const hatches = chart().querySelectorAll('[role="img"] [data-state="gap"]');
    expect(hatches).toHaveLength(2);
    hatches.forEach((h) => {
      expect(h).toHaveClass('chart-gap-hatch');
      /* Full height, always: a stub proportional to nothing cannot be read as
         a low reading. */
      expect(h).toHaveClass('h-full');
      expect((h as HTMLElement).style.height).toBe('');
    });

    /* ── a measured 0.0 is a BAR, not a hatch: 3 Aug had farms logging and
       nothing confirmed, which is a fact about the week rather than an
       absence of one. */
    const zeroBar = chart().querySelector<HTMLElement>('[role="img"] [title="3 Aug: 0"]')!;
    expect(zeroBar).toHaveAttribute('data-state', 'value');
    expect(zeroBar.style.height).toBe('2%');
    expect(zeroBar).not.toHaveClass('chart-gap-hatch');

    /* ── THE TILES ARE THE ROWS UNDERNEATH THEM. */
    expect(tileValue('Verified farm-days per farm')).toBe('3.6');
    expect(tileValue('Change from the week before')).toBe('+0.40');
    expect(tileValue('Farms with a row that week')).toBe('14');
    expect(tileValue('Weeks with a row')).toBe('10 of 12');
    /* The delta is against a week that IS adjacent here, and it is named. */
    expect(tile('Change from the week before')).toHaveTextContent(
      /against the week of 24 Aug 2026, which was 3\.20/,
    );

    /* ── the goal bar is drawn from the server's goal and the measured
       current, and it states the share rather than implying it. */
    const goalFill = document.querySelector<HTMLElement>('[data-goal-fill]')!;
    expect(goalFill.style.width).toBe('80%');
    expect(screen.getByText(/against a goal of/)).toHaveTextContent('4.5');

    /* ── the tier chips, in their TRUNCATED branch. The feed returned exactly
       the server's LIMIT, and because tier is a monotone function of wvfd the
       farms cut off are always the lowest-scoring, so every count is a floor.
       A "Tier D: 5" read as a count would be the reassurance this screen is
       least entitled to give. */
    const tiers = document.querySelector<HTMLElement>('[data-tiers="wvfd"]')!;
    expect(within(tiers).getByText(/These are floors, not counts/)).toBeInTheDocument();
    tiers.querySelectorAll('[data-tier]').forEach((chip) => {
      expect(chip.textContent).toContain('at least');
    });

    /* The window was READ from the envelope's own spelling. If this screen
       ever reads `meta.lastRefreshed` — the key no endpoint sends — this line
       appears and the axis loses its newest week. */
    expect(screen.queryByText(/a time the server did not report/)).toBeNull();
    expect(within(chart()).getByText(/10 of 12 weeks have a row/)).toBeInTheDocument();
  });
});

/* ══════ 3. the week the delta is against is named, never assumed ════════ */

describe('the comparison week is read off the axis, not off the field name', () => {
  /**
   * `priorWvfd` is `weekRows[^2]` — the second-newest ROW, which is the
   * previous WEEK only when no week between them is missing
   * (`AdminMisRepository.cs:69`). Here 31 Aug and 17 Aug have no row, so the
   * headline is 24 Aug and the comparison is against 10 Aug, two weeks back.
   * The old page labelled that "vs last week": a comparison that was not made.
   */
  it('names a non-adjacent comparison, and says when the headline is not this week', async () => {
    serve({
      currentWvfd: 2.8,
      priorWvfd: 2.5,
      goalWvfd: 4.5,
      weeks: [
        week(OLDEST, 1, 8),
        week('2026-08-10', 2.5, 12),
        week('2026-08-24', 2.8, 13),
      ],
      topFarms: [farm(1, 6, 'A'), farm(2, 2, 'C'), farm(3, 0, 'D')],
    });
    renderNsm();
    await settled();

    /* The newest slot on the axis has no row, so the headline is older than
       the window's own newest week — and says so. */
    expect(rowFor(NEWEST_LABEL)).toHaveAttribute('data-state', 'gap');
    expect(tile('Verified farm-days per farm')).toHaveTextContent(/week of 24 Aug 2026/);
    expect(tile('Verified farm-days per farm')).toHaveTextContent(/This is not the current week/);

    const change = tile('Change from the week before');
    expect(tileValue('Change from the week before')).toBe('+0.30');
    expect(change).toHaveTextContent(/against the week of 10 Aug 2026, which was 2\.50/);
    expect(change).toHaveTextContent(/2 weeks back, not one/);
    expect(change).not.toHaveTextContent(/vs last week/);

    /* The goal sentence names the same week the headline came from. */
    expect(screen.getByText(/verified farm-days per farm in the week of/)).toHaveTextContent(
      '24 Aug 2026',
    );

    /* Under the server's LIMIT, so the tier counts are counts and say so. */
    const tiers = document.querySelector<HTMLElement>('[data-tiers="wvfd"]')!;
    expect(within(tiers).getByText(/Counted over the 3 farms this feed returns/)).toBeInTheDocument();
    expect(tiers.textContent).not.toContain('at least');
  });
});

/* ═══ 4-5. an answer that carries nothing prints NOTHING from this screen ═ */

describe('no fabricated number survives an empty answer', () => {
  it('serves the endpoint’s own failure payload and prints not one figure from it', async () => {
    /* THE EXACT SWALLOW PAYLOAD. `AdminMisRepository.cs:78` answers a dropped
       connection, a missing matview or a refused permission on `mis.*` with
       HTTP 200 and a complete-looking result: a current WVFD of 0 and a goal
       of 4.5. The old page then printed "0.0" under "goal 4.5" with a
       progress bar at 0% — and would have printed the same four figures even
       if the server had sent none of them, because of `?? '0.0'` and three
       `?? '4.5'`. */
    serve({ currentWvfd: 0, priorWvfd: null, goalWvfd: 4.5, weeks: [], topFarms: [] });
    renderNsm();
    await settled();

    /* The server's 0 is its substitution for "no weeks", not a reading. */
    expect(tileValue('Verified farm-days per farm')).toBe('—not measured');
    expect(tileValue('Change from the week before')).toBe('—not measured');
    expect(tileValue('Farms with a row that week')).toBe('—not measured');
    expect(within(kpis()).queryByText('0.0')).toBeNull();
    expect(within(kpis()).queryByText('0')).toBeNull();

    /* THE GOAL IS NOT DRAWN AND NOT PRINTED. There is no bar to fill and no
       figure to state a share of — and no client-side 4.5 to fall back on. */
    expect(document.querySelector('[data-goal-fill]')).toBeNull();
    expect(screen.queryByText(/against a goal of/)).toBeNull();
    expect(screen.getByText('There is no share of the goal to draw')).toBeInTheDocument();

    /* Twelve weeks and no readings is an ABSENCE OF MEASUREMENT, not a run of
       zeros — and the chart is not drawn as twelve empty bars. */
    expect(screen.getByText(/absence of measurement, not a run of zeros/)).toBeInTheDocument();
    expect(chart().querySelector('[role="img"]')).toBeNull();

    /* And the swallow is NAMED, so the empty per-farm list is never reported
       as a measured zero. */
    expect(screen.getByText(/AdminMisRepository\.cs:78/)).toBeInTheDocument();
    expect(
      screen.queryByText(/This is a measured zero/),
      'an endpoint that answers its own database failures with a goal of 4.5 and HTTP 200 reported that answer as a measurement',
    ).toBeNull();

    /* No tier chips: there is nothing to count and no zero to claim. */
    expect(document.querySelector('[data-tiers="wvfd"]')).toBeNull();
  });

  it('with no stamp either: there is no axis, and the shell says so', async () => {
    /* No rows and no `lastRefreshedUtc`, so there is no date to measure the
       window back from and therefore no axis at all. Without
       `measuredZero.unproven` the shell would close this with "This is a
       measured zero, not a missing feed", which this endpoint cannot support. */
    serve(
      { currentWvfd: 0, priorWvfd: null, goalWvfd: 4.5, weeks: [], topFarms: [] },
      { lastRefreshedUtc: null, window: null },
    );
    renderNsm();
    await settled();

    expect(screen.getByText('No week in this window carries a reading')).toBeInTheDocument();
    expect(screen.getAllByText(/AdminMisRepository\.cs:78/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/This is a measured zero/)).toBeNull();
    /* Never "0 of 0 weeks": with no axis there is no denominator, and a ratio
       invented to fill a caption is the same fabrication as a zero. */
    expect(screen.queryByText(/0 of 0 weeks/)).toBeNull();
    expect(screen.getAllByText(/no weeks could be placed on this axis/).length).toBeGreaterThan(0);
    expect(tileValue('Weeks with a row')).toBe('—not measured');
  });
});

/* ════════════════════ 6. a broken request is a failure ══════════════════ */

describe('a broken request is named, never drawn as an empty chart', () => {
  it('shows the failure with a working retry, and no tile shows a number it does not have', async () => {
    const user = userEvent.setup();
    stub = installAdapter(async () => ({ status: 500, data: {} }));
    renderNsm();
    await settled();

    /* No fabricated figures anywhere in the summary band — the old page
       rendered "0.0" and "goal 4.5" over exactly this state. */
    expect(within(kpis()).queryByText('0.0')).toBeNull();
    expect(within(kpis()).queryByText('4.5')).toBeNull();
    expect(tileValue('Verified farm-days per farm')).toBe('—not measured');
    expect(document.querySelector('[data-goal-fill]')).toBeNull();

    const alerts = await screen.findAllByRole('alert', undefined, { timeout: SETTLE_WAIT });
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Request failed with status code 500/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/measured zero/)).toBeNull();
    expect(screen.queryByText(/never measured/)).toBeNull();

    const before = stub.requests.length;
    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => expect(stub!.requests.length).toBeGreaterThan(before));
  });
});
