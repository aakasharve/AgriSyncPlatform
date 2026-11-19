import { MetricLines } from '@/components/state';
import { PersonName } from '@/components/ui/PersonName';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { WORKER_LIMIT, realName } from '../drilldown';
import type { FarmerHealthWorkerDto } from '../farmer-health.types';

/**
 * P7: the workers named most often in this farm's entries. Name, count and
 * first-seen date only: nothing is scored or judged about a person here.
 */
export function FarmWorkers({ workers }: { workers: FarmerHealthWorkerDto[] }) {
  const rows = workers.slice(0, WORKER_LIMIT);
  return (
    <section
      data-metric="fh-workers"
      aria-label="Workers"
      className="glass-panel rounded-panel p-5"
    >
      <h3 className="text-h3 font-semibold text-text-1">Workers</h3>
      {rows.length === 0 ? (
        <p data-empty="workers" className="mt-2 text-body text-text-2">
          No worker is named in this farm&rsquo;s entries.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-line" aria-label="Worker list">
          {rows.map((w) => {
            const since = fmt.date(w.firstSeenUtc, DATE_FORMATS.workerSince);
            return (
              <li key={w.workerId} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <PersonName
                    name={realName(w.name)}
                    fallback="Name not recorded"
                    className="block truncate text-body font-semibold text-text-1"
                  />
                  {since ? <div className="text-caption text-text-3">since {since}</div> : null}
                </div>
                <span
                  className="shrink-0 rounded-chip bg-wash px-2 py-0.5 text-caption font-semibold tabular-nums text-text-1"
                  aria-label={`${w.assignmentCount} mentions`}
                >
                  {fmt.num(w.assignmentCount)}&times;
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <MetricLines metric="fh-workers" className="mt-2" />
    </section>
  );
}
