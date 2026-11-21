import { useMemo, type CSSProperties } from 'react';
import { MetricLines, NotMeasuredPanel } from '@/components/state';
import { DATE_FORMATS, fmt } from '@/lib/format';
import type { FarmerHealthTimelineDayDto } from '../farmer-health.types';

/**
 * BAND 3 — the 14-column × 6-row activity grid.
 *
 * ── PER-ROW NORMALISATION IS THE PRODUCT, AND IT IS ALSO A TRAP ──────────
 * Each row scales against its OWN maximum, so a single verification reads as
 * strongly as forty started closures. That is deliberate: the question the
 * grid answers is "does this event type happen on this farm, and when", not
 * "which event type is biggest". Normalising the whole grid together would
 * flatten five of the six rows into nothing behind whichever one is noisiest.
 *
 * It is also the single most misreadable thing on this screen, because the
 * live card's caption said only "darker = more events" — which invites a
 * reader to compare two rows against each other, the one comparison the scale
 * cannot support. The caption now says which.
 *
 * ── AN ALL-ZERO GRID IS NOT A MEASURED ZERO ─────────────────────────────
 * `GetTimelineAsync` swallows its own exception and then backfills fourteen
 * all-zero rows OUTSIDE the `try` (`AdminFarmerHealthRepository.cs:213-260`),
 * so a dropped connection, a missing `analytics.events` grant and a genuinely
 * quiet farm all arrive as the same complete, well-formed, entirely-zero
 * grid with HTTP 200. The component cannot tell them apart and neither can
 * the reader, so it stops claiming to.
 *
 * ── COLOUR MEANS ONE THING HERE ─────────────────────────────────────────
 * The live grid gave each of the six rows its own hue — purple, teal, sky,
 * ochre, lime, red — six literals, and five of them encoded nothing beyond
 * "different row", which is what the row label already says. CONTRACT.md §7.7
 * is explicit: if you cannot say what a colour means, remove it. Two meanings
 * survive and both are tokens: activity is `--color-blue-vivid`, the
 * neutral-informational fill, and errors are `--color-red-vivid`, a failure.
 * Intensity carries the amount.
 */

type EventKey =
  | 'closuresStarted'
  | 'closuresSubmitted'
  | 'proofAttached'
  | 'summariesViewed'
  | 'verifications'
  | 'errors';

interface RowMeta {
  key: EventKey;
  label: string;
  /** The analytics event this row counts — worth naming, because two of the
   *  six are not what their label suggests. */
  source: string;
  /** What is counted, in words, for the row tooltip. Falls back to `source`. */
  tip?: string;
  /** A failure, or an activity. The only two meanings this grid encodes. */
  failure?: boolean;
}

const ROWS: RowMeta[] = [
  { key: 'closuresStarted', label: 'Started', source: 'closure.started' },
  { key: 'closuresSubmitted', label: 'Submitted', source: 'closure.submitted' },
  { key: 'proofAttached', label: 'Proof', source: 'proof.attached' },
  { key: 'summariesViewed', label: 'Summary', source: 'closure_summary.viewed' },
  {
    key: 'verifications',
    label: 'Checked',
    source: 'verification.recorded',
    tip: "Counts a person's deliberate check of an entry, once per entry each day. Checks by the person who saved the entry are left out.",
  },
  {
    key: 'errors',
    label: 'Errors',
    source: 'api.error and client.error',
    tip: 'Counts problems on requests that named this farm, failed voice calls included.',
    failure: true,
  },
];


/** Ramp 18% → 95% of the row's own maximum; a single event still has to read.
 *  Whole percent, because it is fed straight into a `color-mix`. */
function intensityPct(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 0) return 15;
  return Math.round(18 + 77 * Math.min(1, count / max));
}

/** Two tokens, two meanings, no literals (CONTRACT.md §7.7). */
function fillToken(row: RowMeta): string {
  return row.failure ? 'var(--color-red-vivid)' : 'var(--color-blue-vivid)';
}

/**
 * The shade, mixed toward the empty-cell surface rather than faded with
 * `opacity`.
 *
 * `opacity` on the cell would take the FIGURE down with the fill, and the
 * figure is the thing that makes this grid readable at all — the shading is a
 * scanning aid, the number is the reading. `color-mix` is already how this
 * token layer builds its own surfaces (`globals.css` §B), so no new mechanism
 * is introduced and no colour is written as a literal.
 */
function cellStyle(row: RowMeta, pct: number): CSSProperties {
  if (pct <= 0) return { color: 'var(--color-text-3)' };
  return {
    backgroundColor: `color-mix(in oklab, ${fillToken(row)} ${pct}%, var(--color-wash))`,
    color: pct > 55 ? 'var(--color-page)' : 'var(--color-text-1)',
  };
}

export interface FarmerTimelineProps {
  timeline: FarmerHealthTimelineDayDto[];
  /**
   * CR-3 fix wave W-1: the sentence for "app events are not being recorded". When set, the five
   * analytics-backed rows (Started, Submitted, Proof, Summary, Errors) are not measured and are
   * not drawn: a row of zeros would read as "nothing happened". "Checked" is not an analytics
   * count and stays.
   */
  analyticsNotMeasured?: string | null;
}

/** The rows that are counted from app events. */
const ANALYTICS_ROWS: ReadonlySet<EventKey> = new Set<EventKey>([
  'closuresStarted',
  'closuresSubmitted',
  'proofAttached',
  'summariesViewed',
  'errors',
]);

export function FarmerTimeline({ timeline, analyticsNotMeasured = null }: FarmerTimelineProps) {
  const days = useMemo(() => timeline.slice(-14), [timeline]);
  const rowsShown = useMemo(
    () => (analyticsNotMeasured ? ROWS.filter((r) => !ANALYTICS_ROWS.has(r.key)) : ROWS),
    [analyticsNotMeasured],
  );

  const maxByRow = useMemo(() => {
    const max: Record<EventKey, number> = {
      closuresStarted: 0,
      closuresSubmitted: 0,
      proofAttached: 0,
      summariesViewed: 0,
      verifications: 0,
      errors: 0,
    };
    for (const d of days) {
      for (const row of rowsShown) {
        if (d[row.key] > max[row.key]) max[row.key] = d[row.key];
      }
    }
    return max;
  }, [days, rowsShown]);

  const total = useMemo(
    () => days.reduce((n, d) => n + rowsShown.reduce((m, row) => m + d[row.key], 0), 0),
    [days, rowsShown]
  );

  /* No grid at all. The server always backfills fourteen days, so reaching
     this branch means the response carried no timeline array — a different
     fact from a quiet farm, and it gets a different panel. */
  if (days.length === 0) {
    return (
      <section data-band="timeline" aria-label="14-day activity">
        <NotMeasuredPanel
          title="No timeline was sent for this farm"
          why="The server builds a fixed fourteen-day window for every farm, including farms with no events at all, so an absent array is a response that did not assemble rather than a farm with nothing on it."
        />
      </section>
    );
  }

  /* W-1: the analytics-backed rows are not measured; only "Checked" can be drawn. */
  if (analyticsNotMeasured && total === 0) {
    return (
      <section data-band="timeline" aria-label="14-day activity">
        <NotMeasuredPanel
          title="The 14-day activity is not measured"
          why={
            <span data-testid="analytics-not-measured">
              Started, Submitted, Proof, Summary and Errors: {analyticsNotMeasured}
            </span>
          }
        />
      </section>
    );
  }

  /* Every cell zero. This says only what the six rows counted. They do not
     count saved entries, and "Checked" leaves out self-checks, so a farm can
     have recorded work while every cell here is zero. */
  if (total === 0) {
    return (
      <section data-band="timeline" aria-label="14-day activity">
        <NotMeasuredPanel
          title="Nothing was counted in these six rows in fourteen days"
          why={
            <>
              <p>
                What these six rows count was zero on all {fmt.num(days.length)} India days. The
                rows do not count saved entries, and "Checked" leaves out checks made by the person
                who saved the entry, so this does not mean the farm recorded nothing.
              </p>
            </>
          }
        />
      </section>
    );
  }

  return (
    <section
      data-band="timeline"
      className="glass-panel rounded-panel p-5"
      aria-label="14-day activity"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-h3 font-semibold text-text-1">14-day activity</h3>
        <span className="text-caption text-text-3">
          {fmt.num(days.length)} days, ending with the most recent
        </span>
      </div>

      {/* The scale, stated. Comparing two ROWS by shade is the one reading
          this grid cannot support, and the old caption invited it. */}
      <p data-scale-note="" className="mb-3 text-caption text-text-3">
        Each row is shaded against its own busiest day, not against the other rows — a dark cell in
        Started and a dark cell in Submitted are not the same number. The figure is in the cell.
      </p>
      <MetricLines metric="fh-timeline" className="mb-3" />
      {analyticsNotMeasured && (
        <p data-testid="analytics-not-measured" className="mb-3 text-body text-text-1">
          Started, Submitted, Proof, Summary and Errors are not shown: {analyticsNotMeasured}
        </p>
      )}

      <div className="overflow-x-auto">
        <table
          className="border-separate text-caption"
          style={{ borderSpacing: '3px' }}
          aria-label="Activity by event type and day"
        >
          <caption className="sr-only">
            Counts of six event types on this farm (started, submitted, proof, summary viewed, checked,
            errors) for each of the last {fmt.num(days.length)} days. Each row is shaded against its own maximum.
          </caption>
          <thead>
            <tr>
              <th className="pr-2 text-left" />
              {days.map((d) => (
                <th
                  key={d.date}
                  scope="col"
                  className="text-caption tabular-nums text-text-3"
                  title={d.date}
                >
                  {fmt.date(d.date, DATE_FORMATS.timelineDay) ?? '??'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsShown.map((row) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className="pr-2 text-left text-caption font-semibold text-text-1"
                  title={row.tip ?? `Counts ${row.source}`}
                >
                  {row.label}
                </th>
                {days.map((d) => {
                  const count = d[row.key];
                  const pct = intensityPct(count, maxByRow[row.key]);
                  return (
                    <td key={`${row.key}-${d.date}`} className="p-0">
                      <div
                        data-cell={`${row.key}:${d.date}`}
                        className="grid h-7 w-7 place-items-center rounded-chip bg-wash text-caption font-semibold tabular-nums"
                        style={cellStyle(row, pct)}
                        title={`${row.label} on ${d.date}: ${count}`}
                      >
                        {count > 0 ? count : ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        A32 — the accessible details table, VISIBLE rather than sr-only. Task 9
        made this disclosure mandatory and sighted for the reason the donut
        taught: a table nobody can open is a table nobody reviews.
      */}
      <details className="mt-3 text-caption text-text-2">
        <summary className="cursor-pointer text-text-1">Show data table</summary>
        <div className="mt-2 overflow-x-auto">
          <table data-timeline-table="" className="w-full text-caption tabular-nums">
            <caption className="sr-only">
              The same fourteen days as exact counts, one row per day.
            </caption>
            <thead>
              <tr className="text-left text-text-2">
                <th className="py-1 pr-3 font-semibold">Date</th>
                {rowsShown.map((r) => (
                  <th key={r.key} className="py-1 pr-3 text-right font-semibold">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <th scope="row" className="py-0.5 pr-3 text-left font-normal text-text-2">
                    {fmt.date(d.date, DATE_FORMATS.churnLastLog) ?? d.date}
                  </th>
                  {rowsShown.map((r) => (
                    <td key={r.key} className="py-0.5 pr-3 text-right">
                      {d[r.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="mt-3 flex flex-col gap-2">
        <MetricLines metric="fh-timeline-verifies" />
        {!analyticsNotMeasured && <MetricLines metric="fh-timeline-errors" />}
      </div>
    </section>
  );
}
