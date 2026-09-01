import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import type { OpsVoiceDay } from '@/hooks/useOpsVoice';
import OpsVoicePage from '../OpsVoicePage';

/**
 * VOICE PIPELINE — the first screen drawn inside `ChartShell`.
 *
 * Three claims are central here, and each is proven by breaking its source:
 *
 *  1. THE WINDOW REACHES ALL FOUR PLACES — hook argument, QUERY KEY, query
 *     string, interpolated title. The key is the one that fails silently:
 *     drop `days` from it and 7, 14 and 30 share one cache entry, so the
 *     screen draws a fortnight under a heading that says thirty days with no
 *     request, no error and nothing for a reader to notice. The first
 *     assertion in the first test is therefore that a SECOND request went
 *     out, so a collision names itself rather than showing up as a stale
 *     number three assertions later.
 *
 *  2. A NEVER-MEASURED DATE IS A HOLE AND A MEASURED ZERO IS A ZERO. Both,
 *     in the picture and in the table, from one fixture that holds both.
 *
 *  3. THE FIGURES ARE DERIVED FROM THE ROWS ON SCREEN. v3's `data.js`
 *     self-checks that its breakdown sums to its totals and shouts into the
 *     console if it stops. A console warning nobody reads is not a check, so
 *     the sum is asserted here — against the table this screen actually
 *     draws, which is the strongest form of it available: the provider
 *     breakdown v3 sums cannot be built at all from this feed (no provider
 *     field on the DTO), so what is checked is that every tile equals the
 *     rows underneath it, that a gap contributes nothing to any of them, and
 *     that the success rate is derived from the two counts rather than
 *     averaged from the daily rates.
 *
 * FIXTURES STUB `lastRefreshedUtc`, THE SPELLING THE SERVER SENDS. A fixture
 * that stubs `lastRefreshed` is why an inverted envelope type survived on
 * every screen until `7a742b05`. It is load-bearing twice over here: the
 * screen's "read at" line AND the right-hand edge of the chart's axis are
 * both taken from it, and the fixtures below deliberately put the newest
 * measured date one day BEFORE the stamp, so reading the wrong key changes
 * the number of dates on the axis.
 *
 * FIVE MOUNTS. Task 18 measured this suite at a timing cliff: a nine-mount
 * file failed 4 runs in 5, and merging it to seven — with no assertion
 * dropped — returned it to 5 green of 5. Two tests here were merged onto one
 * fixture for the same reason, and nothing was dropped to do it.
 * `vitest.config.ts` is untouched; Task 29 owns the fix.
 */

const ORG = '11111111-1111-1111-1111-111111111111';

/** 08:30 UTC on 1 Sep — the moment the server SERVED the request
 *  (`GetOpsVoiceHandler.cs:20` is `DateTime.UtcNow`), so 1 Sep is the newest
 *  date the window can reach even when nothing has been recorded on it yet. */
const READ_AT = '2026-09-01T08:30:00.0000000Z';

/** A 14-day window spans FIFTEEN dates: the SQL measures back from the moment
 *  of the read (`NOW() - INTERVAL '14 days'`), not from midnight. */
const DATES_IN_14 = 15;

function day(date: string, over: Partial<OpsVoiceDay> = {}): OpsVoiceDay {
  return { date, invocations: 100, failures: 4, successRatePct: 96, avgLatencyMs: 1200, ...over };
}

/** The real envelope: `AdminMetaDto("live-aggregated", $"last {days} days",
 *  DateTime.UtcNow, 300)` over `{ days: [...] }`. */
function envelope(
  days: OpsVoiceDay[],
  meta: { window?: string | null; lastRefreshedUtc?: string | null } = {},
) {
  const { window: w = 'last 14 days', lastRefreshedUtc = READ_AT } = meta;
  return {
    data: { days },
    meta: {
      source: 'live-aggregated',
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

function serve(days: OpsVoiceDay[], meta?: Parameters<typeof envelope>[1]) {
  stub = installAdapter(async () => ({ status: 200, data: envelope(days, meta) }));
  return stub;
}

function renderVoice(route = `/ops/voice?org=${ORG}`) {
  return renderWithProviders(<OpsVoicePage />, { route });
}

/* ── the regions, addressed by their own hooks rather than by class ─────── */

function kpis(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-kpis="voice"]')!;
}

/** One tile, found by its label. Every assertion on a figure goes through
 *  this and reads THE VALUE ELEMENT — not the tile, whose text also contains
 *  the caption and the note, so an assertion on the whole tile would pass on
 *  a number that appears in a sentence. */
function tile(label: string): HTMLElement {
  return within(kpis()).getByText(label).closest('[data-state]') as HTMLElement;
}

function tileValue(label: string): string {
  return (tile(label).firstElementChild as HTMLElement).textContent!.trim();
}

function chart(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-chart="voice-days"]')!;
}

function tableRows(): HTMLTableRowElement[] {
  return [
    ...document.querySelectorAll<HTMLTableRowElement>(
      '[data-chart-table="voice-days"] tbody tr',
    ),
  ];
}

function rowFor(label: string): HTMLTableRowElement {
  const row = tableRows().find((tr) => tr.querySelector('th')?.textContent?.trim() === label);
  if (!row) throw new Error(`no row for ${label} — rows are ${tableRows().length}`);
  return row;
}

/** ONE CELL, never the row. Task 17 found a mutation surviving because an
 *  assertion read a whole row and every row happened to contain the string it
 *  looked for. Columns are Calls, Failed, Success rate, Avg latency. */
function cell(label: string, index: number): string {
  return rowFor(label).querySelectorAll('td')[index].textContent!.trim();
}

async function settled() {
  await waitFor(() => expect(screen.queryByRole('status', { name: /Loading/ })).toBeNull());
}

/* ═══════════ 1. the window — hook arg, query key, query string, title ════ */

describe('the day window reaches all four places (A19, B5)', () => {
  it('changes the request, the cache entry and the title — and refuses a value the server would clamp', async () => {
    const user = userEvent.setup();
    stub = installAdapter(async (req) => {
      const asked = Number(/days=(\d+)/.exec(req.url)?.[1] ?? 14);
      return {
        status: 200,
        data: envelope([day('2026-08-31', { invocations: asked === 30 ? 900 : 100 })], {
          window: `last ${asked} days`,
        }),
      };
    });

    /* `?days=999` first, because the old page passed the URL's value through
       unchecked: `?days=x` produced the literal request `?days=NaN` against a
       non-nullable `int` (a 400), and `?days=3` was silently answered as 7 by
       the server's own clamp. */
    renderVoice(`/ops/voice?org=${ORG}&days=999`);
    await settled();

    expect(stub.requests[0].url).toBe('/shramsafal/admin/ops/voice?days=14');
    expect(screen.getByText(/outside the 7 to 30 the server accepts/)).toHaveTextContent('999');
    expect(screen.getByRole('heading', { name: /Voice success rate — last 14 days/ })).toBeVisible();

    const before = stub.requests.length;
    await user.click(screen.getByRole('button', { name: '30 days' }));

    /*
     * ASSERTED FIRST, ON PURPOSE. This is the query-key assertion: if `days`
     * leaves `['ops','voice',org,days]`, the 30-day view resolves to the
     * 14-day cache entry, react-query issues no request (the hook's staleTime
     * is 5 minutes) and the screen quietly draws a fortnight under a heading
     * that says thirty days.
     */
    await waitFor(() =>
      expect(
        stub!.requests.length,
        'switching the window issued no new request — 7, 14 and 30 are sharing one cache entry, so the figures on screen belong to the previous window while the title and the URL claim the new one',
      ).toBeGreaterThan(before),
    );

    expect(stub.requests[stub.requests.length - 1].url).toBe(
      '/shramsafal/admin/ops/voice?days=30',
    );
    expect(
      await screen.findByRole('heading', { name: /Voice success rate — last 30 days/ }),
    ).toBeVisible();
    await waitFor(() => expect(tileValue('Calls')).toBe('900'));
  });
});

/* ══ 2. a hole is not a bad day, a zero is a zero, and every tile is the
      rows underneath it — ONE FIXTURE, ONE MOUNT ════════════════════ */

describe('holes, zeros, and figures that are the rows underneath them', () => {
  /**
   * FOUR MEASURED DATES IN A FIFTEEN-DATE AXIS, and every number in them is
   * load-bearing:
   *
   *   31 Aug  0 failures       — a MEASURED zero, which keeps its 0
   *   28 Aug  0 avgLatencyMs   — the server's COALESCE sentinel, which does not
   *   28 Aug  0% success rate  — a measured zero IN THE PICTURE: a real bar
   *    1 Sep  absent entirely  — a hole, reached only because the axis is
   *                             anchored on the envelope's `lastRefreshedUtc`
   *
   * The totals separate three implementations that all look right in a
   * screenshot: 510 calls and 50 failures give 90.2%, while averaging the
   * four daily rates gives 70%; the latency mean of 1,300ms drops to 975ms
   * the moment the sentinel is counted as a reading.
   *
   * Two tests were merged onto this one mount — no assertion dropped — for
   * the reason in this file's header.
   */
  it('draws, tabulates, sums and describes them all without collapsing any two', async () => {
    serve([
      day('2026-08-31', { invocations: 100, failures: 0, successRatePct: 100, avgLatencyMs: 1000 }),
      day('2026-08-30', { invocations: 300, failures: 30, successRatePct: 90, avgLatencyMs: 2000 }),
      day('2026-08-29', { invocations: 100, failures: 10, successRatePct: 90, avgLatencyMs: 900 }),
      day('2026-08-28', { invocations: 10, failures: 10, successRatePct: 0, avgLatencyMs: 0 }),
    ]);
    renderVoice();
    await settled();

    expect(tableRows()).toHaveLength(DATES_IN_14);

    /* ── the hole, in words. A hatch a reader has to interpret is a legend. */
    expect(screen.getByText(/11 of 15 periods were never measured/)).toBeInTheDocument();

    /* ── the hole, in the table: ONE honest cell, never four zeroes. */
    const gap = rowFor('1 Sep');
    expect(gap).toHaveAttribute('data-state', 'gap');
    expect(gap.querySelectorAll('td')).toHaveLength(1);
    expect(gap.querySelector('td')!.textContent).toContain('not measured');
    expect(gap.textContent).not.toMatch(/\b0\b/);

    /* ── the measured zero, in the table, IN ITS OWN CELL. Reading the whole
       row would pass on the word "0" appearing anywhere in it. */
    const clean = rowFor('31 Aug');
    expect(clean).toHaveAttribute('data-state', 'value');
    expect(cell('31 Aug', 1)).toBe('0');
    expect(cell('31 Aug', 2)).toBe('100.0%');

    /* ── the server's `COALESCE(..., 0)` latency, turned back into the
       absence it stands for — and NOT into "0ms". */
    expect(cell('28 Aug', 3)).toContain('not measured');
    expect(cell('28 Aug', 3)).not.toContain('0ms');
    /* Its other three figures are real and are still reported — the sentinel
       costs that date its latency cell, not its row. */
    expect(cell('28 Aug', 0)).toBe('10');
    expect(cell('28 Aug', 1)).toBe('10');
    expect(cell('28 Aug', 2)).toBe('0.0%');

    /* ── the picture. Two series over one axis, so twelve holes each — and
       the query is scoped to the two `role="img"` series, because the shell's
       own table marks its gap ROWS with the same attribute and an unscoped
       count would pass on twelve table rows and no hatch at all. */
    const hatches = chart().querySelectorAll('[role="img"] [data-state="gap"]');
    expect(hatches).toHaveLength(22);
    hatches.forEach((h) => {
      expect(h).toHaveClass('chart-gap-hatch');
      /* Full height, always: a stub proportional to nothing cannot be read as
         a low reading. */
      expect(h).toHaveClass('h-full');
      expect((h as HTMLElement).style.height).toBe('');
    });

    /* ── a measured 0% is a BAR, not a hatch: 28 Aug failed every call, which
       is a fact about the pipeline rather than an absence of one. */
    const zeroBar = chart().querySelector<HTMLElement>('[role="img"] [title="28 Aug: 0"]')!;
    expect(zeroBar).toHaveAttribute('data-state', 'value');
    expect(zeroBar.style.height).toBe('2%');
    expect(zeroBar).not.toHaveClass('chart-gap-hatch');

    /* ── THE SUM CHECK, against the table on screen rather than against a
       constant. v3 runs this as a console warning over its own sample data;
       here it is the assertion, and it reads the same cells the operator
       reads. Eleven of the fifteen dates are gaps and contribute nothing. */
    const callCells = tableRows()
      .filter((tr) => tr.getAttribute('data-state') === 'value')
      .map((tr) => Number(tr.querySelectorAll('td')[0].textContent!.replace(/,/g, '')));
    expect(callCells).toHaveLength(4);
    expect(tileValue('Calls')).toBe(String(callCells.reduce((a, b) => a + b, 0)));
    expect(tileValue('Calls')).toBe('510');
    expect(tileValue('Failed calls')).toBe('50');

    /*
     * 90.2%, not 70%. The rate is derived from the two counts — 460 of 510 —
     * and NOT averaged from the four daily rates (100, 90, 90, 0), which would
     * weight a 10-call date the same as a 300-call one. The old page averaged
     * the rates (`OpsVoicePage.tsx:21-23`).
     */
    expect(tileValue('Success rate')).toBe('90.2%');

    /*
     * 1,300ms: the mean of 1000, 2000 and 900. The fourth date's `0` is the
     * server's substitution for "no call recorded a duration", so it is left
     * out — counting it would report 975ms, a mean over four dates when three
     * carry a duration, which is a figure with a fabricated denominator.
     */
    expect(tileValue('Avg latency')).toBe('1,300ms');

    /* The window was READ from the envelope's own spelling. If this screen
       ever reads `meta.lastRefreshed` — the key no endpoint sends — this line
       appears and the axis loses its newest date. */
    expect(screen.queryByText(/a time the server did not report/)).toBeNull();
    expect(within(chart()).getByText(/4 of 15 dates measured/)).toBeInTheDocument();
  });
});

/* ═══════════════ 4-5. an empty answer says which kind of empty ══════════ */

describe('an empty answer is never reported as a measured zero', () => {
  it('with a stamp: fifteen dates and no readings is an ABSENCE OF MEASUREMENT, not a run of zeros', async () => {
    serve([]);
    renderVoice();
    await settled();

    expect(screen.getByText(/absence of measurement, not a run of zeros/)).toBeInTheDocument();
    expect(screen.queryByText(/This is a measured zero/)).toBeNull();

    /* And no tile invents a figure to sit over it. */
    expect(tile('Calls')).toHaveAttribute('data-state', 'unmeasured');
    expect(tileValue('Calls')).toBe('—not measured');
    expect(tileValue('Success rate')).toBe('—not measured');
    expect(within(kpis()).queryByText('0')).toBeNull();
    expect(within(kpis()).queryByText('0%')).toBeNull();
  });

  it('with no stamp either: it says the request came back with nothing, and NAMES the swallow', async () => {
    /* No rows and no `lastRefreshedUtc`, so there is no axis to draw at all.
       Without `measuredZero.unproven` the shell would close this block with
       "This is a measured zero, not a missing feed" — which this endpoint
       cannot support: `GetVoiceTrendAsync` ends `catch { return empty; }`
       (`AdminOpsRepository.cs:293`), so a database failure arrives as an
       empty list with HTTP 200. */
    serve([], { lastRefreshedUtc: null, window: null });
    renderVoice();
    await settled();

    expect(screen.getByText('No date in this window carries a reading')).toBeInTheDocument();
    expect(screen.getByText(/AdminOpsRepository.cs:293/)).toBeInTheDocument();
    expect(
      screen.queryByText(/This is a measured zero/),
      'an endpoint that answers its own database failures with an empty list and HTTP 200 reported that empty as a measurement',
    ).toBeNull();
  });
});

/* ════════════════════ 6. a broken request is a failure ══════════════════ */

describe('a broken request is named, never drawn as an empty chart', () => {
  it('shows the failure with a retry, and no tile shows a number it does not have', async () => {
    const user = userEvent.setup();
    stub = installAdapter(async () => ({ status: 500, data: {} }));
    renderVoice();
    await settled();

    /* No fabricated figures anywhere in the summary band — the old page
       rendered `0ms` and `0` over exactly this state (D18). */
    expect(within(kpis()).queryByText('0')).toBeNull();
    expect(within(kpis()).queryByText('0ms')).toBeNull();
    expect(tileValue('Avg latency')).toBe('—not measured');

    await screen.findByRole('alert');
    expect(screen.getByText(/Request failed with status code 500/)).toBeInTheDocument();
    expect(screen.queryByText(/measured zero/)).toBeNull();
    expect(screen.queryByText(/never measured/)).toBeNull();

    const before = stub.requests.length;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(stub!.requests.length).toBeGreaterThan(before));
  });
});
