import { fmt } from '@/lib/format';
import { cn } from '@/lib/utils';

export type FreshnessSource = 'live' | 'live-aggregated' | 'materialized';

export interface FreshnessChipProps {
  source: FreshnessSource;
  window?: string;
  lastRefreshed?: string;
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
 * unparseable input. The `|| 'recent'` / `|| 'now'` fallbacks below are
 * unchanged and still wrong for a DIFFERENT reason (D13: a chip with no
 * timestamp at all still claims freshness). That one is a visible change to
 * Schedule Templates and belongs to Task 24, which ports that screen — fixing
 * it here would alter a live screen from outside any task.
 */

export function FreshnessChip({ source, lastRefreshed, className }: FreshnessChipProps) {
  const label =
    source === 'materialized'
      ? `Nightly · ${fmt.age(lastRefreshed) || 'recent'}`
      : `Live · ${fmt.age(lastRefreshed) || 'now'}`;
  const cls = source === 'materialized' ? 'chip-mat' : 'chip-live';
  return (
    <span className={cn('chip-fresh', cls, className)}>
      <span className="dot" />
      {label}
    </span>
  );
}
