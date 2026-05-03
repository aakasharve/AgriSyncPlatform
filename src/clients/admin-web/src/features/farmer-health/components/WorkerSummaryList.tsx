import { format, parseISO } from 'date-fns';
import { Users } from 'lucide-react';
import type { FarmerHealthWorkerSummaryDto } from '../farmer-health.types';
import { EmptyState } from './EmptyAndErrorStates';

/**
 * WorkerSummaryList — Mode A Band 4 (UI brief §4 Band 4).
 *
 * WTL v0 surface — adheres to constraint C6 / plan §1.6 red-line.
 * Renders ONLY:
 *   - worker name (Marathi, 'Noto Sans Devanagari')
 *   - assignment count (DM Sans, tabular)
 *   - first-seen date ("since {date}")
 *
 * **DO NOT add fields here without a new task.** No reputation, no dispute,
 * no payout, no skill, no score. The disclaimer is mandatory copy — sets
 * the right expectation for admin staff who might assume more.
 */

const HAS_DEVANAGARI = /[ऀ-ॿ]/;

function fontFor(name: string): string {
  return HAS_DEVANAGARI.test(name)
    ? "'Noto Sans Devanagari', sans-serif"
    : "'DM Sans', sans-serif";
}

function fmtSince(iso: string): string {
  try { return format(parseISO(iso), 'dd MMM yyyy'); }
  catch { return '—'; }
}

export interface WorkerSummaryListProps {
  workers: FarmerHealthWorkerSummaryDto[];
}

export function WorkerSummaryList({ workers }: WorkerSummaryListProps) {
  return (
    <section className="glass-panel p-5" aria-label="Workers seen on this farm">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-sidebar text-text-secondary">
          <Users size={13} strokeWidth={2.4} />
        </span>
        <h3 className="text-base font-extrabold text-text-primary">Workers seen on this farm</h3>
        <span className="ml-auto rounded-md bg-surface-sidebar px-2 py-0.5 font-mono text-[11px] font-extrabold tabular-nums text-text-secondary">
          {workers.length}
        </span>
      </div>

      {workers.length === 0 ? (
        <EmptyState
          message="No workers captured yet."
          hint="Workers appear here once their names are mentioned in voice logs."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-row-divider" aria-label="Worker list">
          {workers.slice(0, 5).map((w) => (
            <li key={w.workerId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm font-semibold text-text-primary"
                  style={{ fontFamily: fontFor(w.name) }}
                >
                  {w.name || '—'}
                </div>
                <div className="font-mono text-[11px] text-text-muted tabular-nums">
                  since {fmtSince(w.firstSeenUtc)}
                </div>
              </div>
              <span
                className="rounded-md bg-surface-sidebar px-2 py-0.5 font-mono text-[12px] font-extrabold tabular-nums text-text-primary"
                aria-label={`${w.assignmentCount} assignments`}
                title={`Mentioned in ${w.assignmentCount} voice log${w.assignmentCount === 1 ? '' : 's'}`}
              >
                {w.assignmentCount}×
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] italic leading-snug text-text-muted">
        (captured automatically from voice logs; reputation tracking not yet built)
      </p>
    </section>
  );
}
