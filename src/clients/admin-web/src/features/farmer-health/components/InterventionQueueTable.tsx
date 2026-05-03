import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { CohortBucketDto } from '../farmer-health.types';
import { EmptyState } from './EmptyAndErrorStates';

/**
 * Mode B intervention queue (DWC v2 §4.4 component #1).
 *
 * Most prominent table on Mode B (per UI brief Band 2). Each row carries a
 * red 4 px left-border (C7 — destructive token, never bright green).
 *
 * Default sort follows §4.6 Step 1: `score ASC, lastActiveAt DESC`
 * (worst farms with recent activity first).
 */

type SortKey = 'farmerName' | 'score' | 'weeklyDelta' | 'lastActiveAt';
type SortDir = 'asc' | 'desc';

export interface InterventionQueueTableProps {
  rows: CohortBucketDto[];
  /** Set false to render the empty-state copy instead of "🎉" — used in Mode B first-deploy. */
  understatedEmpty?: boolean;
}

const HAS_DEVANAGARI = /[ऀ-ॿ]/;

function fontFor(name: string): string {
  return HAS_DEVANAGARI.test(name)
    ? "'Noto Sans Devanagari', sans-serif"
    : "'DM Sans', sans-serif";
}

function fmtRelative(iso: string): string {
  try {
    return format(parseISO(iso), 'dd MMM, HH:mm');
  } catch {
    return '—';
  }
}

export function InterventionQueueTable({ rows, understatedEmpty }: InterventionQueueTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sortKey) {
        case 'farmerName': av = a.farmerName; bv = b.farmerName; break;
        case 'score':      av = a.score; bv = b.score; break;
        case 'weeklyDelta':av = a.weeklyDelta; bv = b.weeklyDelta; break;
        case 'lastActiveAt': av = a.lastActiveAt; bv = b.lastActiveAt; break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      // Tiebreak score-asc by lastActiveAt DESC (per §4.6).
      if (sortKey === 'score') return a.lastActiveAt < b.lastActiveAt ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'farmerName' ? 'asc' : 'desc'); }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        message={understatedEmpty
          ? 'No farms in intervention bucket yet.'
          : 'No farms in intervention bucket.'}
        hint={understatedEmpty ? undefined : 'All scored farms are above the 40-pt intervention threshold.'}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Intervention queue">
        <thead>
          <tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
            <SortHeader k="farmerName" cur={sortKey} dir={sortDir} onClick={toggleSort}>Farmer</SortHeader>
            <SortHeader k="score" cur={sortKey} dir={sortDir} onClick={toggleSort} align="right">Score</SortHeader>
            <SortHeader k="weeklyDelta" cur={sortKey} dir={sortDir} onClick={toggleSort} align="right">Δ wk</SortHeader>
            <SortHeader k="lastActiveAt" cur={sortKey} dir={sortDir} onClick={toggleSort}>Last active</SortHeader>
            <th className="py-2 pr-4" aria-label="Drill into farm" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.farmId}
              className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar"
              style={{ boxShadow: 'inset 4px 0 0 0 var(--color-danger, #dc2626)' }}
            >
              <td className="py-2.5 pl-4 pr-4 font-semibold text-text-primary" style={{ fontFamily: fontFor(r.farmerName) }}>
                {r.farmerName || '—'}
              </td>
              <td className="py-2.5 pr-4 text-right">
                <span className="inline-block rounded-md bg-danger px-2 py-0.5 font-mono text-[12px] font-extrabold tabular-nums text-white">
                  {r.score}
                </span>
              </td>
              <td className={`py-2.5 pr-4 text-right font-mono text-[12px] font-bold tabular-nums ${r.weeklyDelta < 0 ? 'text-danger' : 'text-text-secondary'}`}>
                {r.weeklyDelta > 0 ? `+${r.weeklyDelta}` : r.weeklyDelta}
              </td>
              <td className="py-2.5 pr-4 font-mono text-[11px] text-text-muted tabular-nums">
                {fmtRelative(r.lastActiveAt)}
              </td>
              <td className="py-2.5 pr-4 text-right">
                <Link
                  to={`/farmer-health/${r.farmId}`}
                  className="inline-flex items-center gap-1 rounded-md border border-surface-border px-2 py-1 text-[11px] font-bold text-text-primary hover:bg-white/60 dark:hover:bg-white/10"
                  aria-label={`Open drilldown for ${r.farmerName}`}
                >
                  Open <ChevronRight size={12} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SortHeaderProps {
  k: SortKey;
  cur: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: 'left' | 'right';
  children: React.ReactNode;
}

function SortHeader({ k, cur, dir, onClick, align = 'left', children }: SortHeaderProps) {
  const Icon = cur !== k ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`py-2 pr-4 first:pl-4 ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 rounded-sm px-1 -mx-1 py-0.5 hover:bg-surface-sidebar focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal ${align === 'right' ? 'flex-row-reverse' : ''}`}
        aria-sort={cur === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {children}<Icon size={11} />
      </button>
    </th>
  );
}
