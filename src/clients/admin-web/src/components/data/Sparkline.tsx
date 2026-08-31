import { cn } from '@/lib/utils';
import { GapBar } from './GapBar';
import { isGap, ramp } from './fillAxis';
import type { AxisSlot } from './fillAxis';

/**
 * A SERIES THAT CAN SHOW A HOLE.
 *
 * Ported from the prototype's `AS.spark` / `AS.sparkBars` (`app.js:241-271`)
 * with its two rules intact and its one silent assumption removed.
 *
 * ── Rule 1: recency reads off the picture, not off a legend ──────────────
 * ONE colour per series, chosen for what the series MEANS, with the newest
 * period at full strength and each older one a step fainter down to ~45%
 * (`theme.css:788-793`). This console has no legends, so the step is how a
 * reader knows which end is now. The arithmetic lives in `ramp()` and is
 * never hand-set: 45% across eight bars is a different step from 45% across
 * twelve, and two charts doing their own drift apart on a screen the reader
 * compares side by side.
 *
 * ── Rule 2: a gap gets no step, and no height ────────────────────────────
 * An absence has no recency worth reading, so `ramp()` is not called for one.
 * It is drawn full-height and hatched by `GapBar` — never as a bar of height
 * zero, which is the fabrication this whole task exists to remove.
 *
 * ── The assumption removed ───────────────────────────────────────────────
 * v3 takes a `values` array and treats `null` as a gap. That works only while
 * the caller remembers to hand over one entry per period INCLUDING the empty
 * ones — a sparse API response mapped straight into it produces a shorter
 * series that is silently rescaled, which is the axis-reshuffle defect
 * wearing different clothes. This component takes `AxisSlot[]` from
 * `fillAxis` instead, so the axis is fixed before the drawing starts and the
 * shape of the series cannot depend on what the API happened to return.
 */

/** The four signal tones plus grey. Vivid fills are for bars and dots only,
 *  never for text (CONTRACT.md §7.7). */
export type SparkTone = 'blue' | 'green' | 'amber' | 'red' | 'grey';

const TONE_FILL: Record<SparkTone, string> = {
  blue: 'bg-blue-vivid',
  green: 'bg-green-vivid',
  amber: 'bg-amber-vivid',
  red: 'bg-red-vivid',
  grey: 'bg-edge-grey',
};

export interface SparklineProps<V> {
  /** One entry per period, gaps included, straight from `fillAxis`. */
  slots: readonly AxisSlot<V>[];
  /** The figure a measured slot contributes to the bar height. Return `null`
   *  and the bar is drawn as a gap — a value the series cannot plot is not a
   *  zero either. */
  valueOf: (value: V) => number | null | undefined;
  /**
   * REQUIRED. The whole series is one `role="img"`, and an image with no
   * accessible name is a hole in the page rather than a chart. The figures
   * themselves live in the shell's data table; this is the one-line summary.
   */
  label: string;
  tone?: SparkTone;
  size?: 'sm' | 'lg';
  /** The faintest step, for the oldest period. v3's default is 0.45. */
  faint?: number;
  className?: string;
}

export function Sparkline<V>({
  slots,
  valueOf,
  label,
  tone = 'blue',
  size = 'sm',
  faint = 0.45,
  className,
}: SparklineProps<V>) {
  const n = slots.length;

  /* The scale is taken over the MEASURED slots only. A gap contributes no
     number, so it cannot pull a maximum down and make every real bar taller
     than it should be. `|| 1` keeps a series of all-zeros from dividing by
     zero — and a series of all-zeros is a legitimate reading, so it is drawn
     rather than replaced by a state block. */
  const heights = slots.map((slot) => (isGap(slot) ? null : (valueOf(slot.value) ?? null)));
  const max = heights.reduce<number>(
    (hi, v) => (v !== null && Number.isFinite(v) && v > hi ? v : hi),
    0,
  );
  const span = max || 1;

  return (
    <div
      role="img"
      aria-label={label}
      data-tone={tone}
      className={cn(
        'flex min-w-20 items-end gap-1',
        size === 'lg' ? 'h-16' : 'h-10',
        className,
      )}
    >
      {slots.map((slot, i) => {
        const value = heights[i];

        /* A gap: full height, hatched, and deliberately NOT stepped. */
        if (value === null || !Number.isFinite(value)) {
          const why = isGap(slot) ? slot.why : 'unmeasured';
          return (
            <div key={slot.key} className="flex h-full flex-1 basis-0 items-stretch">
              <GapBar label={slot.label} why={why} />
            </div>
          );
        }

        /* `Math.max(2, …)` is v3's: a real reading of zero still gets a
           visible sliver, because a zero we measured is a fact and an
           invisible fact is an omission. It is 2% against a full-height
           hatch, so the two never look alike. */
        const pct = Math.max(2, Math.round((value / span) * 100));
        return (
          <div
            key={slot.key}
            data-state="value"
            title={`${slot.label}: ${value}`}
            className={cn('min-h-0.5 flex-1 basis-0 rounded-sm', TONE_FILL[tone])}
            style={{ height: `${pct}%`, opacity: ramp(i, n, faint) }}
          />
        );
      })}
    </div>
  );
}
