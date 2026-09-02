import { cn } from '@/lib/utils';
import { STATE_WORD, type HonestState } from './honestState';

/**
 * NotMeasured — THE ONLY COMPONENT IN THIS CONSOLE ALLOWED TO PRINT A
 * MISSING VALUE.
 *
 * Ported from the v3 prototype's `AS.none` (`app.js:341-348`), whose own
 * comment reads: "The only place in the console that is allowed to print a
 * missing number. It never prints 0, never prints blank, and always says
 * why."
 *
 * Three properties, and all three are load-bearing:
 *
 *  1. NEVER A ZERO. A zero and "we have no reading" are different facts
 *     (CONTRACT.md §9.2). Printing the first when you mean the second is the
 *     defect this whole redesign exists to remove.
 *  2. NEVER A BARE DASH. A dash on its own is the same collapse in quieter
 *     clothing — the reader supplies the reason, and the reason they supply
 *     is usually "zero". The word underneath is not decoration.
 *  3. GREY, ALWAYS. `--color-text-3` is the honesty colour and it is not a
 *     semantic hue. An honesty state outranks any semantic colour
 *     (CONTRACT.md §9.4), so this component takes no tone prop and never will.
 *
 * The em dash is `aria-hidden`; the word is what a screen-reader user hears.
 * A sighted user gets both.
 *
 * For a WHOLE PANEL with no data source at all, use `NotMeasuredPanel`
 * (CONTRACT.md §6.4) — this component is the value-level form, for a KPI
 * figure or a table cell.
 */
export interface NotMeasuredProps {
  /** Which of the four causes. Defaults to `unmeasured`. */
  state?: HonestState;
  /**
   * The sentence explaining why, surfaced as a native tooltip.
   *
   * A tooltip is a WEAK place for a reason and it is deliberately the weak
   * form: it is what fits in a table cell. When the reason matters enough to
   * be read, put it in a KpiCard `caption` or a `NotMeasuredPanel` body,
   * both of which render it as text.
   */
  why?: string;
  className?: string;
}

export function NotMeasured({ state = 'unmeasured', why, className }: NotMeasuredProps) {
  return (
    <span
      data-state={state}
      title={why}
      className={cn('inline-block align-top text-text-3', className)}
    >
      <span aria-hidden="true" className="text-[17px] leading-none">
        &mdash;
      </span>
      <span className="block text-caption text-text-3">{STATE_WORD[state]}</span>
    </span>
  );
}
