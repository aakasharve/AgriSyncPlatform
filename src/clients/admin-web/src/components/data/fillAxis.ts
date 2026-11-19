import type { HonestState } from '@/components/state/honestState';

/**
 * THE FIXED AXIS, AND THE DIFFERENCE BETWEEN A ZERO AND A GAP.
 *
 * ── The collision this file resolves ──────────────────────────────────────
 * Two rules met here and they had to be DECIDED, not averaged.
 *
 * The live console ZERO-FILLS. `ScoreDistributionChart.tsx:33`,
 * `EngagementTierBreakdown.tsx:31` and `PillarHeatmap.tsx:51` all read
 * `map.get(key) ?? 0`. That is right about one thing and wrong about another.
 *
 *   RIGHT — the API returns SPARSE collections. Without a fixed axis a missing
 *   bin does not render at all, the remaining bars redistribute, and the chart
 *   changes shape between two refreshes that measured the same farm. That
 *   reads as DATA MOVEMENT rather than as absence, and it is invisible until
 *   it happens in prod in front of the founder.
 *
 *   WRONG — `?? 0` says a period we never measured had a reading, and that the
 *   reading was the worst one available. A gap becomes a bad day. On a weekly
 *   trend that is a fabricated trough; on a score histogram it is a bin of
 *   farms that does not exist.
 *
 * ── The resolution (Preservation Register A33; CONTRACT.md §7.4, §9.2) ────
 *   1. KEEP THE FIXED AXIS. Order and length come from the axis, always, so
 *      the chart cannot reshuffle and cannot grow a slot the axis did not ask
 *      for.
 *   2. AN ABSENT SLOT IS A GAP, NOT A ZERO. `zeroFill` becomes `fillAxis` and
 *      returns a value OR a gap marker — never a substituted number.
 *   3. A SLOT MEASURED AND RETURNED ZERO IS A REAL ZERO. It keeps its 0, it is
 *      drawn as a zero, and it sorts and sums as a zero.
 *
 * That is the measured-zero-versus-missing-feed distinction Task 5 drew for a
 * panel, applied to one slot of a chart. `fmt` (T4) draws it for a figure and
 * `sortRows` (T8) draws it for a cell; this file is the same rule for an axis.
 *
 * ── What a gap is NOT ────────────────────────────────────────────────────
 * A gap is not a recency. The v3 stylesheet steps a series' opacity from the
 * newest period at full strength down to about 45% at the oldest, and it
 * deliberately exempts a gap: "an absence has no recency worth reading"
 * (`theme.css:809-812`, `app.js:900-906`). `ramp()` below is that arithmetic,
 * and `Sparkline` never applies it to a gap.
 *
 * ── NOTHING HERE IS RE-IMPLEMENTED ───────────────────────────────────────
 * The four causes come from `@/components/state/honestState` (T5). The word a
 * gap is printed with comes from `STATE_WORD` there, through `NotMeasured`.
 * This file adds a shape and one decision, not a second vocabulary.
 */

/** A slot on the axis. A bare string is its own label ('0-10', 'A'); the
 *  object form is for an axis whose key is not what a reader should see
 *  ('triggerFit' -> 'Trigger fit', an ISO week -> '10 Aug'). */
export type AxisPoint = string | { key: string; label: string };

/**
 * ONE SLOT, AND THERE ARE EXACTLY TWO KINDS.
 *
 * The discriminant is what makes the collapse impossible to write by accident:
 * a gap slot has NO `value` property at all, so `slot.value` does not compile
 * on the gap branch and `?? 0` has nothing to fall through to.
 */
export type AxisSlot<V> =
  | { key: string; label: string; kind: 'value'; value: V }
  | {
      key: string;
      label: string;
      kind: 'gap';
      /** WHY there is no reading — one of T5's four causes. Defaults to
       *  `unmeasured`. `feed-down` is the one a screen should pass when it
       *  knows the pipe stopped, because "not measured" and "the feed died"
       *  are different apologies. */
      why: HonestState;
    };

function pointKey(point: AxisPoint): string {
  return typeof point === 'string' ? point : point.key;
}

function pointLabel(point: AxisPoint): string {
  return typeof point === 'string' ? point : point.label;
}

/**
 * A value that is not a reading. `null` and `undefined` are the obvious two;
 * a non-finite number is the third and it is the one that gets missed. `NaN`
 * arrives from `parseFloat` of an empty string and from `0/0` in an average
 * over an empty week, and `NaN` rendered as a bar height is a bar of height
 * zero — the exact fabrication this file exists to stop.
 */
function isReading(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

export interface FillAxisOptions<T, V> {
  /** Which slot a returned row belongs to. */
  keyOf: (row: T) => string;
  /**
   * The value in that slot. Return `null` or `undefined` when the row exists
   * but carries no reading — the slot then becomes a GAP rather than a zero,
   * because a row with a null figure is still a period with no number.
   */
  valueOf: (row: T) => V | null | undefined;
  /** The cause to attribute an absent slot to. Defaults to `unmeasured`. */
  why?: (key: string) => HonestState;
}

/**
 * Fill a FIXED axis from a SPARSE collection.
 *
 * The axis decides the order and the length. The collection decides only which
 * slots carry a reading. A row whose key is not on the axis is IGNORED rather
 * than appended: an API that starts returning an eleventh score bin must not
 * silently widen a chart the reader has learned the shape of.
 *
 * Duplicate keys: the LAST row wins. That is `new Map(entries)` semantics,
 * which is what all three live charts already do (`new Map(bins.map(...))`),
 * and it is preserved deliberately rather than improved — machinery beats
 * mockup, and a silent change of tie-breaking is exactly the kind of drift a
 * rewrite is supposed to avoid.
 */
export function fillAxis<T, V>(
  axis: readonly AxisPoint[],
  measured: readonly T[] | null | undefined,
  options: FillAxisOptions<T, V>,
): AxisSlot<V>[] {
  const { keyOf, valueOf, why } = options;

  const found = new Map<string, T>();
  for (const row of measured ?? []) found.set(keyOf(row), row);

  return axis.map((point) => {
    const key = pointKey(point);
    const label = pointLabel(point);
    const row = found.get(key);

    /* NOT `row ? ... : gap`. The row may exist and still carry no number, and
       a present-but-null row is a period with no reading — not a zero. */
    if (row !== undefined) {
      const value = valueOf(row);
      if (isReading(value)) {
        /* A MEASURED 0 LANDS HERE, WITH ITS 0. That is the whole other half
           of the rule: a slot we looked at and found empty is a fact about
           the farm, and blurring it into the gap would be the same collapse
           running the other way. */
        return { key, label, kind: 'value', value: value as V };
      }
    }

    return { key, label, kind: 'gap', why: why?.(key) ?? 'unmeasured' };
  });
}

/** Narrowing helper, so a caller never reaches for `'value' in slot`. */
export function isGap<V>(slot: AxisSlot<V>): slot is Extract<AxisSlot<V>, { kind: 'gap' }> {
  return slot.kind === 'gap';
}

/** The slots that carry a reading, in axis order. */
export function measuredSlots<V>(
  slots: readonly AxisSlot<V>[],
): Extract<AxisSlot<V>, { kind: 'value' }>[] {
  return slots.filter((slot): slot is Extract<AxisSlot<V>, { kind: 'value' }> => !isGap(slot));
}

/** How many slots on this axis were never measured. Rendered IN WORDS by
 *  `ChartShell`, because a hatch a reader has to interpret is a legend. */
export function gapCount<V>(slots: readonly AxisSlot<V>[]): number {
  return slots.reduce((n, slot) => (isGap(slot) ? n + 1 : n), 0);
}

/**
 * THE RECENCY STEP — ported verbatim from v3 `AS.ramp` / `AS.recency`
 * (`app.js:882-887` and again at `app.js:911-917`, one function under two
 * names so a page never writes its own).
 *
 * `i` is the position in the series, OLDEST FIRST. `n` is the series length.
 * Returns 1 for the newest period and `faint` (0.45) for the oldest.
 *
 * 🛑 NEVER CALL THIS FOR A GAP. `theme.css` says why in one line — "an
 * absence has no recency worth reading" — and the practical version is that a
 * faded hatch reads as an OLD gap, which invents a fact about when the
 * measurement stopped. `Sparkline` enforces this; if you draw your own series,
 * you enforce it.
 *
 * `n` is the FULL series length including gaps, so the step of a series does
 * not change when a week goes missing. Two charts side by side that stepped
 * differently because one had a hole would be unreadable against each other.
 */
export function ramp(i: number, n: number, faint = 0.45): number {
  if (!n || n < 2) return 1;
  return Math.round((faint + (1 - faint) * (i / (n - 1))) * 100) / 100;
}

/**
 * THE THREE FIXED AXES THAT EXIST TODAY (A33).
 *
 * ⚠️ SCOPE, stated so nobody mistakes this for a migration. These constants
 * DOCUMENT the three live charts; they do not yet DRIVE them. No chart is
 * re-pointed in Task 9 — that happens screen by screen in Tasks 21-23, so a
 * mechanical change can never hide a behavioural one. This is the same
 * arrangement `DATE_FORMATS` has in `lib/format.ts` (T4), for the same reason.
 *
 * Because there are briefly TWO copies of each axis, `__tests__/fillAxis.test.ts`
 * reads the three live chart files from disk and asserts the copies still
 * agree. A duplicate nothing compares is a duplicate that drifts.
 *
 * Verified in the tree 2026-08-31:
 *   ScoreDistributionChart.tsx:20   FIXED_BINS    10 buckets
 *   EngagementTierBreakdown.tsx:20  TIER_ORDER    A B C D
 *   PillarHeatmap.tsx:25            PILLAR_ORDER  6 pillars
 */

/** 10 score buckets. The histogram's whole point is that a bucket with no
 *  farms keeps its place on the x-axis. */
export const SCORE_BINS: readonly string[] = [
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
];

/** Engagement tiers, best to worst. */
export const TIER_ORDER: readonly string[] = ['A', 'B', 'C', 'D'];

/** The six DWC v2 pillars, in weighting order. Keys are the API's; labels are
 *  the reader's — which is exactly why `AxisPoint` has an object form. */
export const PILLAR_ORDER: readonly AxisPoint[] = [
  { key: 'triggerFit', label: 'Trigger fit' },
  { key: 'actionSimplicity', label: 'Action simplicity' },
  { key: 'proof', label: 'Proof' },
  { key: 'reward', label: 'Reward' },
  { key: 'investment', label: 'Investment' },
  { key: 'repeat', label: 'Repeat' },
];
