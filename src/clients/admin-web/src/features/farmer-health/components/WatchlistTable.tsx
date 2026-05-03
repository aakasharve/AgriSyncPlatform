import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { CohortBucketDto } from '../farmer-health.types';
import { EmptyState } from './EmptyAndErrorStates';

/**
 * Mode B watchlist (DWC v2 §4.4 component #2).
 *
 * Same row shape as the intervention queue but with an amber 4 px left
 * border (per UI brief Band 4 / C7). Section is collapsed by default;
 * expanding it reveals the full table sorted by `weeklyDelta DESC`
 * (per §4.6 Step 1 — biggest week-over-week drops first).
 */

const HAS_DEVANAGARI = /[ऀ-ॿ]/;

function fontFor(name: string): string {
  return HAS_DEVANAGARI.test(name)
    ? "'Noto Sans Devanagari', sans-serif"
    : "'DM Sans', sans-serif";
}

function fmtRelative(iso: string): string {
  try { return format(parseISO(iso), 'dd MMM, HH:mm'); } catch { return '—'; }
}

export interface WatchlistTableProps {
  rows: CohortBucketDto[];
  /** Default open/closed state. Defaults to false (collapsed). */
  defaultOpen?: boolean;
}

export function WatchlistTable({ rows, defaultOpen = false }: WatchlistTableProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Sort by weeklyDelta DESC — most-improving farms first (drop = negative,
  // appears at the bottom). Per §4.6 the watchlist surfaces farms whose
  // score *dropped* most: actually we want ASC of delta for "biggest drops
  // first". The plan §4.6 says "weeklyDelta DESC … score dropped most
  // week-over-week first" — interpret DESC of (drop magnitude) which is
  // ASC of weeklyDelta when drops are negative.
  const sorted = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => a.weeklyDelta - b.weeklyDelta); // ascending = biggest drop first
    return copy;
  }, [rows]);

  return (
    <section className="glass-panel p-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="watchlist-body"
        className="flex w-full items-center gap-2 rounded-t-lg px-4 py-3 text-left transition-colors hover:bg-surface-sidebar focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
      >
        <span className="grid h-5 w-5 place-items-center">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="text-base font-extrabold text-text-primary">
          Watchlist
        </span>
        <span className="rounded-md bg-[color:rgba(245,158,11,0.15)] px-2 py-0.5 font-mono text-[11px] font-extrabold tabular-nums text-[#b45309]">
          {rows.length}
        </span>
        <span className="ml-auto text-[11px] text-text-muted">
          score 41–60 · click to {open ? 'collapse' : 'expand'}
        </span>
      </button>

      {open && (
        <div id="watchlist-body" className="border-t border-surface-border px-0 py-2">
          {rows.length === 0 ? (
            <EmptyState message="No farms in the watchlist bucket yet." hint="No farms scored between 41 and 60 this week." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Watchlist">
                <thead>
                  <tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
                    <th className="py-2 pl-4 pr-4">Farmer</th>
                    <th className="py-2 pr-4 text-right">Score</th>
                    <th className="py-2 pr-4 text-right">Δ wk</th>
                    <th className="py-2 pr-4">Last active</th>
                    <th className="py-2 pr-4" aria-label="Drill into farm" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => (
                    <tr
                      key={r.farmId}
                      className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar"
                      style={{ boxShadow: 'inset 4px 0 0 0 #f59e0b' }}
                    >
                      <td className="py-2.5 pl-4 pr-4 font-semibold text-text-primary" style={{ fontFamily: fontFor(r.farmerName) }}>
                        {r.farmerName || '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className="inline-block rounded-md bg-[color:rgba(245,158,11,0.18)] px-2 py-0.5 font-mono text-[12px] font-extrabold tabular-nums text-[#b45309]">
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
          )}
        </div>
      )}
    </section>
  );
}
