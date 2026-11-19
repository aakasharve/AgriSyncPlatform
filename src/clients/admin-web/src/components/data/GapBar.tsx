import { cn } from '@/lib/utils';
import { STATE_WORD, type HonestState } from '@/components/state/honestState';

/**
 * A PERIOD WITH NO MEASUREMENT — drawn as a full-height hatched stub, never
 * as a bar of height zero.
 *
 * ── The one thing this component is for ──────────────────────────────────
 * A GAP MUST NOT BE READABLE AS A BAD DAY.
 *
 * Every charting default in existence draws "no data" and "zero" identically:
 * a flat line on the axis. One of those is a fact about the farm and the other
 * is a fact about our pipeline, and an operator looking at a flat February
 * cannot tell which. This stub occupies the whole slot so it cannot be
 * mistaken for a low reading, and it says "not measured" in words underneath
 * itself for anyone who is not reading the texture.
 *
 * ── The three properties, all load-bearing ───────────────────────────────
 *  1. FULL HEIGHT. Not proportional to anything, because it is not a
 *     quantity. `h-full`, always.
 *  2. NO RECENCY. The opacity ramp that fades older periods is NOT applied
 *     here — "an absence has no recency worth reading" (`theme.css:809-812`).
 *     A faded hatch would invent a fact about when the measurement stopped.
 *  3. GREY, ALWAYS. `--color-tint-grey` and `--color-edge-grey`. An honesty
 *     state outranks any semantic colour (CONTRACT.md §9.4), so this takes no
 *     tone prop and never will — the same rule `NotMeasured` follows.
 *
 * The hatch itself is `.chart-gap-hatch` in `styles/globals.css` §A.10: the
 * ONE gradient the v3 stylesheet allows, documented there as data encoding
 * rather than decoration. CONTRACT.md §8's exception is singular — do not add
 * a second one.
 */
export interface GapBarProps {
  /**
   * The slot this stub stands in for — '15 Jun', 'Tier C', 'Investment'. It
   * is not decoration: a hatch with no period attached tells a reader
   * something is missing without telling them WHAT, which is a worse state
   * than the zero it replaced.
   */
  label: string;
  /** Which of T5's four causes. Defaults to `unmeasured`. */
  why?: HonestState;
  className?: string;
}

export function GapBar({ label, why = 'unmeasured', className }: GapBarProps) {
  const words = `${label}: ${STATE_WORD[why]}`;
  return (
    <div
      /* `data-state="gap"` is the prototype's own hook (`app.js:254`) and it is
         what the tests assert on, so a class rename cannot quietly turn a gap
         back into a bar. */
      data-state="gap"
      data-why={why}
      title={words}
      className={cn(
        'chart-gap-hatch h-full w-full rounded-chip border border-dashed border-edge-grey',
        className,
      )}
    >
      <span className="sr-only">{words}</span>
    </div>
  );
}
