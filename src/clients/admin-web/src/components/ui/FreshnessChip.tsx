import { cn } from '@/lib/utils';

export type FreshnessSource = 'live' | 'live-aggregated' | 'materialized';

export interface FreshnessChipProps {
  source: FreshnessSource;
  window?: string;
  lastRefreshed?: string;
  className?: string;
}

function fmtAge(iso: string | undefined): string {
  if (!iso) return '';
  const age = Date.now() - new Date(iso).getTime();
  if (age < 60_000) return `${Math.max(1, Math.floor(age / 1000))}s ago`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return `${Math.floor(age / 86_400_000)}d ago`;
}

export function FreshnessChip({ source, lastRefreshed, className }: FreshnessChipProps) {
  const label =
    source === 'materialized'
      ? `Nightly · ${fmtAge(lastRefreshed) || 'recent'}`
      : `Live · ${fmtAge(lastRefreshed) || 'now'}`;
  const cls = source === 'materialized' ? 'chip-mat' : 'chip-live';
  return (
    <span className={cn('chip-fresh', cls, className)}>
      <span className="dot" />
      {label}
    </span>
  );
}
