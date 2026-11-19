import { fmt } from '@/lib/format';
import { cn } from '@/lib/utils';

export type FreshnessSource = 'live' | 'live-aggregated' | 'materialized';

export interface FreshnessChipProps {
  source: FreshnessSource;
  window?: string;
  /**
   * REQUIRED, AND ALLOWED TO BE `undefined` — the two together are the point.
   *
   * It was optional, so `<FreshnessChip source="materialized" />` compiled and
   * rendered "Nightly · recent" over an endpoint that sends no timestamp at all
   * (D13, `ScheduleTemplatesPage.tsx:29`). Required means a caller must SAY it
   * has no time rather than omit the prop and be given a word for one.
   */
  lastRefreshed: string | undefined;
  className?: string;
}

/**
 * BUG FIX 2026-08-31, standalone and deliberately NOT part of a screen port.
 *
 * The local copy computed `Date.now() - new Date(iso).getTime()`. For an
 * unparseable timestamp that is NaN, every comparison below it is false, and
 * the last branch rendered the literal string "NaNd ago" — a freshness age the
 * chip does not have. That is the D5 fabricated-freshness class the redesign
 * exists to delete, wearing a broken face.
 *
 * Now delegates to `fmt.age`, which returns null for both a missing and an
 * unparseable input.
 *
 * ── D13 CLOSED IN TASK 24 — THE OTHER HALF THE FIX LEFT STANDING ─────────
 * This header used to end: *"the `|| 'recent'` / `|| 'now'` fallbacks below are
 * unchanged and still wrong for a DIFFERENT reason (D13: a chip with no
 * timestamp at all still claims freshness) … that belongs to Task 24."* This is
 * Task 24, and both fallbacks are gone.
 *
 * The words that replaced them are the point. `'recent'` and `'now'` are ages —
 * they are what the chip says when it HAS a reading — so using them for the
 * absence of one made a missing timestamp indistinguishable from a fresh one,
 * and on Schedule Templates it printed a permanent *"Nightly · recent"* over an
 * endpoint that has no clock. "age not reported" is not an age. It is the
 * absence, said out loud, in the place the age would have been.
 *
 * Two guards, and one alone would not hold:
 *   1. `lastRefreshed` is REQUIRED (see the prop) — a caller cannot silently
 *      omit it, which is exactly how the defect got onto a screen.
 *   2. A caller that HAS the prop and it is empty, missing or unparseable still
 *      cannot get a fabricated age out of this component.
 *
 * Screens that genuinely have no timestamp should not render a chip at all —
 * Schedule Templates now says "reference data, no timestamp available" in
 * words. This branch is the backstop for the case where the SERVER drops a
 * stamp it normally sends, which is a real event and must not read as "now".
 */

/** Not an age, and deliberately not shaped like one. */
const NO_AGE = 'age not reported';

export function FreshnessChip({ source, lastRefreshed, className }: FreshnessChipProps) {
  const age = fmt.age(lastRefreshed) || NO_AGE;
  const label = source === 'materialized' ? `Nightly · ${age}` : `Live · ${age}`;
  const cls = source === 'materialized' ? 'chip-mat' : 'chip-live';
  return (
    <span className={cn('chip-fresh', cls, className)}>
      <span className="dot" />
      {label}
    </span>
  );
}
