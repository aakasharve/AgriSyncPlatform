import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  FeedDown,
  LoadFailed,
  LoadingState,
  MeasuredZero,
  NotMeasured,
  NotMeasuredPanel,
} from '@/components/state';
import { gapCount, isGap } from './fillAxis';
import type { AxisSlot } from './fillAxis';

/**
 * ONE CHART SHELL. From here on every chart in this console is drawn inside
 * this component, and the accessible data table is not optional.
 *
 * ── 1. THE DATA TABLE CANNOT BE OMITTED ──────────────────────────────────
 * Five charts carry a "Show data table" disclosure today:
 *
 *     ScoreDistributionChart.tsx:71    PillarHeatmap.tsx:77
 *     WeeklyTrendChart.tsx:91          FarmerTimeline.tsx:138
 *     EngagementTierBreakdown.tsx:95   <- `<details className="sr-only">`
 *
 * All five verified in the tree 2026-08-31. The fifth is the reason this is a
 * REQUIRED PROP rather than a convention: it is SCREEN-READER-ONLY BY
 * CONSTRUCTION, so it is invisible in any screenshot, any design review and
 * any before/after image a rewrite is signed off against. Drop it and nobody
 * notices until a blind operator cannot read a chart. A convention is a thing
 * a hurried person skips; a required prop is a thing the compiler refuses.
 *
 * Two consequences follow, and both are deliberate:
 *
 *   a. THE TABLE IS BUILT FROM THE CHART'S OWN SLOTS. `dataTable` describes
 *      COLUMNS, not rows. The rows are `slots` — the same array, in the same
 *      order, that the chart above is drawn from. A caller therefore cannot
 *      supply a table of something else, or of the same thing before it was
 *      filtered, which is the way an accessible table silently stops
 *      agreeing with its picture.
 *   b. THE GAP CELL IS RENDERED BY THE SHELL, NOT BY THE CALLER. A gap row
 *      prints `NotMeasured` across the columns. There is no code path by
 *      which the table can print `0` for a period that was never measured,
 *      which is the same honesty the hatch gives a sighted reader.
 *
 * The disclosure is VISIBLE. `sr-only` on the fifth chart above meant the one
 * accessibility affordance on the page was also the one thing no reviewer
 * could see; a sighted operator reading exact figures out of a chart had no
 * way in either.
 *
 * ── 2. WHY A PLAIN `<table>` AND NOT `DataList` ──────────────────────────
 * `DataList` (T8) is a READER INTERFACE: sort, search, facets, pagination,
 * expandable rows, URL state. Four reasons it is the wrong tool here, and the
 * first one is not about cost:
 *
 *   i.   A CHART'S TABLE MUST NOT BE SORTABLE. Its order IS the fixed axis —
 *        that is the property A33 exists to protect. A reader who re-sorts it
 *        now holds a second, disagreeing view of the same numbers.
 *   ii.  `DataList` owns its own `states` — loading, error, feed-down,
 *        measured-zero. The shell already owns those for the whole panel. Two
 *        state machines in one panel is how a chart says "loading" while its
 *        table says "measured zero".
 *   iii. It writes `?sort`, `?dir` and `?open`, which are NOT namespaced
 *        (recorded in the Task 8 report). Farmer Health draws four charts on
 *        one page; that is four lists fighting over three params.
 *   iv.  It would pull the list machinery — search index, facets, pager, URL
 *        state — into the recharts chunk, which is already the largest in the
 *        build, to render five rows.
 *
 * A five-row summary of a chart is a semantic `<table>` with a `<caption>`, a
 * `<th scope="col">` per column and a `<th scope="row">` per period. That is
 * what a screen reader wants and it is all it wants.
 *
 * ── 3. A GAP IS NOT A BAD DAY ────────────────────────────────────────────
 * The shell reads the SHAPE of `slots` and refuses to let three different
 * facts share one word:
 *
 *   every slot is a gap   -> `NotMeasuredPanel`. Nothing has been measured.
 *                            NOT "no farms scored badly", and not a chart of
 *                            ten empty bars.
 *   some slots are gaps   -> the chart, plus a line IN WORDS saying how many
 *                            periods were never measured. A hatch a reader
 *                            has to interpret is a legend, and this console
 *                            has no legends.
 *   all measured, all 0   -> THE CHART, drawn at zero. That is a measured
 *                            zero and it is a real reading.
 *
 * The live charts collapse the first and the third today: `if (total === 0)`
 * fires identically for "the API returned nothing" and for "ten bins, every
 * one measured at zero", and both print "Not enough data yet — check back in
 * 7 days" (`ScoreDistributionChart.tsx:36-38`, `EngagementTierBreakdown.tsx:34-36`).
 * One of those is a pipeline gap and the other is a cohort of farms that all
 * scored in one place.
 *
 * ── 4. NO CHART IS RE-POINTED IN THIS TASK ───────────────────────────────
 * All five call sites above are still standing, untouched. They move onto
 * this shell in Tasks 21-23, one screen at a time, so a mechanical change can
 * never hide a behavioural one. Eight tasks have kept the build green by
 * holding that line.
 */

/* ────────────────────────────────────────────────────────────── the table */

export interface ChartTableColumn<V> {
  /** Stable id — the React key for the column, not the heading. */
  key: string;
  label: ReactNode;
  align?: 'left' | 'right';
  /**
   * The cell, for a MEASURED slot only.
   *
   * 🛑 A GAP SLOT NEVER REACHES THIS FUNCTION. The shell renders the absent
   * period itself, through `NotMeasured`. That is the enforcement: there is
   * no argument you can be handed here that lets you print a 0 for something
   * nobody measured.
   *
   * Render figures through `fmt` (T4) and a per-column absence — a slot that
   * WAS measured but whose particular column is null — through `NotMeasured`
   * yourself, because only the screen knows which of the four causes applies.
   */
  value: (value: V, slot: Extract<AxisSlot<V>, { kind: 'value' }>) => ReactNode;
}

export interface ChartDataTable<V> {
  /** An sr-only `<caption>`: what the table is of, and over what window.
   *  Required — v3 gives every table one, and a table announced only as
   *  "table with 4 columns" has told a reader nothing. */
  caption: ReactNode;
  /** The heading over the period column — 'Bucket', 'Tier', 'Pillar', 'Week'. */
  slotHeader: ReactNode;
  columns: ChartTableColumn<V>[];
}

/* ───────────────────────────────────────────────────────────── the states */

export interface ChartShellStates {
  isLoading: boolean;
  /** A BACKGROUND refetch. Swaps in a quiet "Refreshing…" rather than a
   *  skeleton, so a 30-second poll does not blank a chart the reader is
   *  looking at (A25, B13 — the same rule `DataList` follows). */
  isFetching?: boolean;
  error: unknown;
  onRetry: () => void;

  /**
   * REQUIRED, exactly as it is on `DataList` (T8).
   *
   * A chart with nothing in it owes the reader the same two facts a list
   * does: WHAT was looked for and WHEN. Without both, "nothing here" is
   * indistinguishable from a feed that died — and on a chart that is worse,
   * because an empty chart still draws axes and therefore still looks like an
   * answer.
   *
   * `checkedAt` arrives already formatted through `@/lib/format`. Never a raw
   * ISO string, and never a `new Date()` computed at render, which is the
   * fabricated-freshness defect (D5).
   *
   * ── `unproven` — WHEN AN EMPTY ANSWER IS NOT A MEASUREMENT ──────────────
   * The same opt-in `DataList` grew in Task 17, and it is here for the same
   * reason: `MeasuredZero` closes with a fixed sentence — *"This is a measured
   * zero, not a missing feed"* — which some screens KNOW to be false.
   *
   * FIVE repository methods now end in a bare `catch { return <empty>; }`
   * (`AdminMisRepository.cs:219`, `:245`, `:287`, `AdminOpsRepository.cs:253`
   * and `:293`, the last found by Task 19 behind `/ops/voice`), so a dropped
   * connection, a missing view or a permission failure reaches the client as
   * an empty result with HTTP 200. A chart is the worse place for it: an empty
   * chart still draws its own frame and therefore still looks like an answer.
   *
   * Supply `unproven` and the empty branch renders a `NotMeasuredPanel` in the
   * same slot instead: `what` becomes its heading and `unproven` says why the
   * zero cannot be claimed as a reading. Opt-in per screen — silence keeps
   * today's behaviour exactly, because on a feed that cannot swallow its own
   * failure "measured zero" is the true and the stronger claim.
   */
  measuredZero: { what: string; checkedAt: string; unproven?: ReactNode };

  /** The feed stopped. Nothing below the line is drawn — a chart of
   *  yesterday under today's heading is the most damaging thing this console
   *  can do to a decision (CONTRACT.md §6.3, §9.3). */
  feedDown?: { since: string; lastGood?: string };
}

/* ────────────────────────────────────────────────────────────── the shell */

export interface ChartShellProps<V> {
  /** Namespaces the ids this panel generates. */
  id: string;
  /** The accessible name. A plain string because it is used as an aria label
   *  and inside the error and loading sentences, not only as a heading. */
  title: string;
  /** Where the figures come from and how old they are — the freshness chip
   *  and the source line belong here. */
  subtitle?: ReactNode;

  /**
   * The chart's data, on its FIXED axis, from `fillAxis`. Required, and it is
   * what the shell reads to tell a gap from a zero.
   */
  slots: readonly AxisSlot<V>[];

  /** REQUIRED. See §1 of this file's header before reaching for a default. */
  dataTable: ChartDataTable<V>;

  /**
   * WHAT ONE SLOT IS CALLED. Added by Task 22 and defaulted to today's word,
   * so every chart shipped before it is unchanged.
   *
   * The gap note and the nothing-measured panel both say how many slots have
   * no reading, and until now they said "period" — right for a day, a week or
   * a month, and wrong for the three axes Farmer Health draws, whose slots are
   * SCORE BINS, ENGAGEMENT TIERS and PILLARS. "1 of 6 periods was never
   * measured" over a list of pillars is a sentence that makes a reader stop
   * and re-read, which is the opposite of what an honesty note is for.
   */
  slotNoun?: { one: string; many: string };

  states: ChartShellStates;

  /** The chart itself — recharts, `Sparkline`, a heatmap, anything. */
  children: ReactNode;
  className?: string;
}

export function ChartShell<V>({
  id,
  title,
  subtitle,
  slots,
  dataTable,
  slotNoun = { one: 'period', many: 'periods' },
  states,
  children,
  className,
}: ChartShellProps<V>) {
  const titleId = `${id}-title`;
  const gaps = gapCount(slots);
  const allGaps = slots.length > 0 && gaps === slots.length;
  const refreshing = !!states.isFetching && !states.isLoading;

  /** The hatch, said out loud. A reader who is scanning rather than studying
   *  gets the fact without having to decode a texture — and a screenshot
   *  review can see it, which is the whole lesson of the sr-only table. */
  function gapNote(): ReactNode {
    if (gaps === 0) return null;
    const noun = gaps === 1 ? `${slotNoun.one} was` : `${slotNoun.many} were`;
    return (
      <p data-gap-note="" className="text-caption text-text-3">
        {gaps} of {slots.length} {noun} never measured — shown hatched, not as zero.
      </p>
    );
  }

  function body(): ReactNode {
    /* Precedence is deliberate and it is the same ladder `DataList` uses. A
       broken request outranks everything: it is the cause the seven
       silent-failure screens are actually hitting when they report good news. */
    if (states.error) {
      return <LoadFailed error={states.error} onRetry={states.onRetry} what={title} />;
    }

    if (states.isLoading) {
      return <LoadingState label={`Loading ${title}`} height={220} />;
    }

    if (states.feedDown) {
      return (
        <FeedDown
          since={states.feedDown.since}
          lastGood={states.feedDown.lastGood}
          what={title}
        />
      );
    }

    /* An axis with no slots at all: we asked over the window and the window
       held nothing to plot. That IS a measured zero, and it names what was
       looked for and when. */
    if (slots.length === 0) {
      /* AN EMPTY ANSWER IS NOT ALWAYS A MEASUREMENT. A screen whose feed can
         answer its own database failure with an empty result and HTTP 200
         says so IN THIS SLOT, rather than under a headline that has already
         claimed the opposite. See `ChartShellStates.measuredZero.unproven`. */
      if (states.measuredZero.unproven) {
        return (
          <NotMeasuredPanel
            title={states.measuredZero.what}
            why={states.measuredZero.unproven}
          />
        );
      }
      return (
        <MeasuredZero what={states.measuredZero.what} checkedAt={states.measuredZero.checkedAt} />
      );
    }

    /* Every slot a gap: nothing was measured. NOT a measured zero, NOT a
       chart of empty bars, and NOT "not enough data yet — check back in 7
       days", which is a promise about the future made by a component that
       cannot keep it. */
    if (allGaps) {
      return (
        <NotMeasuredPanel
          title={`${title} — not measured`}
          why={
            <>
              None of the {slots.length} {slotNoun.many} on this chart has a reading. This is an absence of
              measurement, not a run of zeros — drawing it as bars would show a flat chart that
              looks like an answer.
            </>
          }
        />
      );
    }

    return (
      <>
        {children}
        {gapNote()}
        {table()}
      </>
    );
  }

  function table(): ReactNode {
    return (
      /* NOT `sr-only`. See §1. */
      <details data-chart-table={id} className="text-caption text-text-2">
        <summary className="cursor-pointer">Show data table</summary>
        <table className="mt-2 w-full border-collapse text-caption">
          <caption className="sr-only">{dataTable.caption}</caption>
          <thead>
            <tr className="text-left text-text-2">
              <th scope="col" className="py-1 pr-3 font-semibold">
                {dataTable.slotHeader}
              </th>
              {dataTable.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'py-1 pr-3 font-semibold',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot.key} data-state={slot.kind === 'gap' ? 'gap' : 'value'}>
                <th scope="row" className="py-0.5 pr-3 text-left font-normal text-text-1">
                  {slot.label}
                </th>
                {isGap(slot) ? (
                  /* ONE honest cell across the row, not N zeros. `NotMeasured`
                     is the only component in this console allowed to print a
                     missing value, and it never prints a 0 or a bare dash. */
                  <td className="py-0.5 pr-3" colSpan={dataTable.columns.length}>
                    <NotMeasured
                      state={slot.why}
                      why={`${slot.label} has no reading on this axis.`}
                    />
                  </td>
                ) : (
                  dataTable.columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'py-0.5 pr-3 text-text-1',
                        column.align === 'right' && 'text-right tabular-nums',
                      )}
                    >
                      {column.value(slot.value, slot)}
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    );
  }

  return (
    <section
      data-chart={id}
      aria-labelledby={titleId}
      className={cn('flex flex-col gap-2', className)}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={titleId} className="text-h3 font-semibold text-text-1">
          {title}
        </h3>
        {subtitle}
        {refreshing && (
          <span data-refreshing="" className="text-caption text-text-3">
            Refreshing&hellip;
          </span>
        )}
      </div>
      {body()}
    </section>
  );
}
