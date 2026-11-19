import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChartShell } from '../ChartShell';
import type { ChartShellStates } from '../ChartShell';
import { Sparkline } from '../Sparkline';
import { fillAxis, ramp } from '../fillAxis';
import type { AxisSlot } from '../fillAxis';

/**
 * WHAT A CHART OWES ITS READER.
 *
 * Two things, and neither survives a rewrite unless something enforces them:
 *
 *  1. AN ACCESSIBLE DATA TABLE. Five charts carry one today and one of the
 *     five is `sr-only` — invisible in every screenshot review, so its loss
 *     would be silent. It is a REQUIRED prop here; the compile-time proof is
 *     at the bottom of this file and the runtime proof is at the top.
 *  2. A GAP MUST NOT READ AS A BAD DAY. A period never measured is a
 *     full-height hatch and the words "not measured". A period measured at
 *     zero is a real zero, in the chart and in the table.
 *
 * NO CHART IS RE-POINTED IN THIS TASK. Everything below renders the shell
 * directly against a fixture, which is the point: the shell has to be proven
 * before the first chart depends on it.
 */

interface Week {
  weekStart: string;
  avgScore: number | null;
}

const AXIS = ['w1', 'w2', 'w3', 'w4'];

const STATES: ChartShellStates = {
  isLoading: false,
  error: null,
  onRetry: () => undefined,
  measuredZero: { what: 'No weeks scored in the last 8 weeks', checkedAt: '31 Aug 2026, 06:12' },
};

function weeks(rows: Week[]): AxisSlot<number>[] {
  return fillAxis<Week, number>(AXIS, rows, {
    keyOf: (r) => r.weekStart,
    valueOf: (r) => r.avgScore,
  });
}

const TABLE = {
  caption: 'Average DWC score per week over the last four weeks.',
  slotHeader: 'Week',
  columns: [
    {
      key: 'avg',
      label: 'Avg score',
      align: 'right' as const,
      value: (v: number) => v.toFixed(1),
    },
  ],
};

function renderShell(slots: AxisSlot<number>[], states: Partial<ChartShellStates> = {}) {
  return render(
    <ChartShell
      id="trend"
      title="Weekly trend"
      slots={slots}
      dataTable={TABLE}
      states={{ ...STATES, ...states }}
    >
      <div data-testid="the-chart">chart</div>
    </ChartShell>,
  );
}

/* ─────────────────────────── 1. the table cannot be dropped or hidden ──── */

describe('the accessible data table (A32)', () => {
  it('renders whenever the chart renders', async () => {
    renderShell(weeks([{ weekStart: 'w1', avgScore: 62 }]));

    const disclosure = screen.getByText('Show data table');
    expect(disclosure).toBeInTheDocument();
    await userEvent.click(disclosure);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('is VISIBLE — not sr-only, which is how the fifth chart hid it', () => {
    const { container } = renderShell(weeks([{ weekStart: 'w1', avgScore: 62 }]));

    const details = container.querySelector('[data-chart-table="trend"]');
    expect(details).not.toBeNull();
    // `EngagementTierBreakdown.tsx:95` is `<details className="sr-only">`, so
    // the one accessibility affordance on that chart is also the one thing no
    // reviewer can see. A sighted operator reading exact figures out of a
    // chart had no way in either.
    expect(details?.className).not.toContain('sr-only');
  });

  it('carries a caption and a row header per period', async () => {
    renderShell(weeks([{ weekStart: 'w1', avgScore: 62 }]));
    await userEvent.click(screen.getByText('Show data table'));

    expect(screen.getByRole('table')).toHaveAccessibleName(
      'Average DWC score per week over the last four weeks.',
    );
    expect(screen.getByRole('rowheader', { name: 'w1' })).toBeInTheDocument();
  });

  it('is a table of THE CHART’S OWN slots — same rows, same order', async () => {
    renderShell(weeks([{ weekStart: 'w3', avgScore: 1 }, { weekStart: 'w1', avgScore: 2 }]));
    await userEvent.click(screen.getByText('Show data table'));

    // The caller supplies COLUMNS, never rows. There is no argument that lets
    // the table disagree with the picture above it.
    const headers = screen.getAllByRole('rowheader').map((th) => th.textContent);
    expect(headers).toEqual(AXIS);
  });
});

/* ─────────────────────────────────── 2. a gap is not a bad day ────────── */

describe('a gap is not a zero — in the table', () => {
  it('prints "not measured" for a period that was never measured, never a 0', async () => {
    renderShell(weeks([{ weekStart: 'w1', avgScore: 0 }]));
    await userEvent.click(screen.getByText('Show data table'));

    const rows = screen.getAllByRole('row');
    const measured = rows.find((r) => within(r).queryByRole('rowheader', { name: 'w1' }));
    const gap = rows.find((r) => within(r).queryByRole('rowheader', { name: 'w2' }));

    // A slot we measured and found empty keeps its zero.
    expect(measured).toHaveTextContent('0.0');
    // A slot we never measured says so, in words.
    expect(gap).toHaveTextContent('not measured');
    expect(gap).not.toHaveTextContent('0');
  });

  it('marks the gap rows in the DOM so the two are distinguishable', async () => {
    const { container } = renderShell(weeks([{ weekStart: 'w1', avgScore: 0 }]));
    await userEvent.click(screen.getByText('Show data table'));

    expect(container.querySelectorAll('tbody tr[data-state="gap"]')).toHaveLength(3);
    expect(container.querySelectorAll('tbody tr[data-state="value"]')).toHaveLength(1);
  });

  it('renders ONE honest cell across the row, not one absence per column', async () => {
    const { container } = renderShell(weeks([{ weekStart: 'w1', avgScore: 4 }]));
    await userEvent.click(screen.getByText('Show data table'));

    const gapRow = container.querySelector('tbody tr[data-state="gap"]');
    expect(gapRow?.querySelectorAll('td')).toHaveLength(1);
  });

  it('says how many periods are missing IN WORDS — a hatch alone is a legend', () => {
    renderShell(weeks([{ weekStart: 'w1', avgScore: 4 }]));

    expect(screen.getByText(/3 of 4 periods were never measured/)).toBeInTheDocument();
    /* "hatched" -> "a striped gap", 2026-09-02: an operator should not have to
       know what a hatch is to read the sentence that stops a gap being read as
       a zero. The claim is unchanged and is still the load-bearing half. */
    expect(screen.getByText(/drawn as a striped gap, not as a zero/)).toBeInTheDocument();
  });

  it('says nothing about gaps when there are none', () => {
    renderShell(weeks(AXIS.map((weekStart) => ({ weekStart, avgScore: 0 }))));

    expect(screen.queryByText(/never measured/)).not.toBeInTheDocument();
  });
});

describe('a gap is not a zero — in the picture', () => {
  function sparkline(rows: Week[]) {
    return render(
      <Sparkline slots={weeks(rows)} valueOf={(v) => v} label="Weekly average, last four weeks" />,
    );
  }

  it('draws a never-measured period as a full-height hatch, not a zero-height bar', () => {
    const { container } = sparkline([{ weekStart: 'w1', avgScore: 10 }]);

    const gaps = container.querySelectorAll('[data-state="gap"]');
    expect(gaps).toHaveLength(3);
    // The hatch is the ONE gradient CONTRACT.md §8 allows, and it is a data
    // encoding. If this class goes, a gap is a flat line on the axis again.
    expect(gaps[0].className).toContain('chart-gap-hatch');
    expect(gaps[0].className).toContain('h-full');
  });

  it('gives a MEASURED zero a real, visible bar rather than a hatch', () => {
    const { container } = sparkline([
      { weekStart: 'w1', avgScore: 0 },
      { weekStart: 'w2', avgScore: 8 },
    ]);

    const bars = container.querySelectorAll('[data-state="value"]');
    expect(bars).toHaveLength(2);
    // v3's `Math.max(2, …)`: a zero we measured is a fact, and an invisible
    // fact is an omission.
    expect((bars[0] as HTMLElement).style.height).toBe('2%');
  });

  it('does NOT apply the recency ramp to a gap — an absence has no recency', () => {
    const { container } = sparkline([{ weekStart: 'w4', avgScore: 10 }]);

    const gap = container.querySelector('[data-state="gap"]') as HTMLElement;
    // A faded hatch would invent a fact about WHEN the measurement stopped.
    expect(gap.style.opacity).toBe('');
  });

  it('applies the ramp to measured bars, newest at full strength', () => {
    const { container } = sparkline(AXIS.map((weekStart) => ({ weekStart, avgScore: 5 })));

    const bars = Array.from(container.querySelectorAll('[data-state="value"]')) as HTMLElement[];
    expect(bars.map((b) => b.style.opacity)).toEqual(
      AXIS.map((_, i) => String(ramp(i, AXIS.length))),
    );
    expect(bars[bars.length - 1].style.opacity).toBe('1');
  });

  it('names the series — a role="img" with no name is a hole in the page', () => {
    sparkline([{ weekStart: 'w1', avgScore: 1 }]);

    expect(screen.getByRole('img', { name: 'Weekly average, last four weeks' })).toBeInTheDocument();
  });

  it('scales over the measured slots only, so a gap cannot inflate the bars', () => {
    const { container } = sparkline([
      { weekStart: 'w1', avgScore: 5 },
      { weekStart: 'w2', avgScore: 10 },
    ]);

    const bars = Array.from(container.querySelectorAll('[data-state="value"]')) as HTMLElement[];
    expect(bars.map((b) => b.style.height)).toEqual(['50%', '100%']);
  });
});

/* ────────────────────────── 3. the four causes, at panel level (T5) ────── */

describe('an empty chart says WHICH kind of empty it is', () => {
  it('all periods missing is NOT MEASURED — not a chart of zeros', () => {
    renderShell(weeks([]));

    expect(screen.getByText(/absence of measurement, not a run of zeros/)).toBeInTheDocument();
    // Nothing is drawn. Ten empty bars still look like an answer.
    expect(screen.queryByTestId('the-chart')).not.toBeInTheDocument();
  });

  it('all periods measured at zero IS the chart — that is a real reading', () => {
    renderShell(weeks(AXIS.map((weekStart) => ({ weekStart, avgScore: 0 }))));

    expect(screen.getByTestId('the-chart')).toBeInTheDocument();
    expect(screen.queryByText(/absence of measurement/)).not.toBeInTheDocument();
  });

  it('an empty axis is a MEASURED zero, and names what was looked for and when', () => {
    renderShell([]);

    expect(screen.getByText('No weeks scored in the last 8 weeks')).toBeInTheDocument();
    expect(screen.getByText(/31 Aug 2026, 06:12/)).toBeInTheDocument();
  });

  /*
   * ── `unproven` (added Task 19, the first screen whose feed can swallow) ──
   * FIVE repository methods end in a bare `catch { return <empty>; }`, so a
   * database failure can reach a screen as an empty result with HTTP 200. On
   * those feeds "This is a measured zero, not a missing feed" is a sentence
   * the client cannot support. Opt-in, exactly as on `DataList`: silence
   * keeps the stronger claim for every feed that can still make it.
   */
  it('an empty axis a screen knows it cannot vouch for is NOT MEASURED, not a measured zero', () => {
    renderShell([], {
      measuredZero: {
        what: 'No weeks scored in the last 8 weeks',
        checkedAt: '31 Aug 2026, 06:12',
        unproven: 'This endpoint answers its own failures with an empty list.',
      },
    });

    expect(
      screen.queryByText(/This is a measured zero/),
      'a feed that can answer a database failure with an empty list reported that empty as a measurement',
    ).toBeNull();
    expect(screen.getByText('No weeks scored in the last 8 weeks')).toBeInTheDocument();
    expect(
      screen.getByText('This endpoint answers its own failures with an empty list.'),
    ).toBeInTheDocument();
  });

  it('keeps the measured-zero claim when a screen says nothing', () => {
    renderShell([]);
    expect(screen.getByText(/This is a measured zero, not a missing feed/)).toBeInTheDocument();
  });

  it('a broken request is a failure with a retry, never an empty chart', async () => {
    const onRetry = vi.fn();
    renderShell(weeks([{ weekStart: 'w1', avgScore: 4 }]), {
      error: new Error('Request failed with status code 500'),
      onRetry,
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Request failed with status code 500');
    expect(screen.queryByTestId('the-chart')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a dead feed names when it stopped and draws nothing below the line', () => {
    renderShell(weeks([{ weekStart: 'w1', avgScore: 4 }]), {
      feedDown: { since: '06:12 today', lastGood: '41 logs at 06:11' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Feed down since 06:12 today');
    expect(screen.queryByTestId('the-chart')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('a first load is a NAMED busy block, not a spinner', () => {
    renderShell(weeks([]), { isLoading: true });

    const busy = screen.getByRole('status');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAccessibleName('Loading Weekly trend');
  });

  it('a background refetch says Refreshing and keeps the chart on screen', () => {
    renderShell(weeks([{ weekStart: 'w1', avgScore: 4 }]), { isFetching: true });

    expect(screen.getByText(/Refreshing/)).toBeInTheDocument();
    expect(screen.getByTestId('the-chart')).toBeInTheDocument();
  });

  it('a FIRST load shows the skeleton and no Refreshing indicator (A25, B13)', () => {
    renderShell(weeks([]), { isLoading: true, isFetching: true });

    expect(screen.queryByText(/Refreshing/)).not.toBeInTheDocument();
  });
});

/* ──────────────────────────── 4. the compile-time enforcement ─────────── */

describe('`dataTable` cannot be omitted — proved by the compiler, not by prose', () => {
  /**
   * 🛑 THIS IS A TYPE TEST, AND IT RUNS IN `npm run build`, NOT IN `vitest`.
   *
   * `tsconfig.app.json` includes "src", so `tsc -b` — the first half of
   * `npm run build` — type-checks this file. `@ts-expect-error` asserts the
   * error EXISTS: the moment `dataTable` or `measuredZero` becomes optional,
   * the directive itself becomes an "Unused '@ts-expect-error' directive"
   * error and the BUILD goes red.
   *
   * So the enforcement is not "it is a required prop", which is a claim. It is
   * that making it optional breaks the build, which is a mechanism. The
   * expressions below are never rendered — they exist to be compiled.
   */
  it('omitting it does not compile', () => {
    // @ts-expect-error dataTable is REQUIRED — omitting it must not compile.
    const withoutTable = <ChartShell id="x" title="X" slots={[]} states={STATES} children={null} />;
    expect(withoutTable).toBeTruthy();
  });

  it('omitting `states.measuredZero` does not compile either', () => {
    // A chart with nothing in it owes the reader what a list owes it (T8):
    // what was looked for, and when.
    // @ts-expect-error measuredZero is REQUIRED on a chart, as it is on a list.
    const states: ChartShellStates = { isLoading: false, error: null, onRetry: () => undefined };
    expect(states).toBeTruthy();
  });

  it('supplying it compiles and renders', async () => {
    renderShell(weeks([{ weekStart: 'w1', avgScore: 4 }]));
    await userEvent.click(screen.getByText('Show data table'));

    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
