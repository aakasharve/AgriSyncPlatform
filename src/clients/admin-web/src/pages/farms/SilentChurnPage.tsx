import { TrendingDown } from 'lucide-react';
import { NotBuiltYet } from '@/components/state';

/**
 * SILENT CHURN (`/farms/silent-churn`) — three ideas, no numbers (amendment B24).
 *
 * The watchlist used to be read from `/admin/farms/silent-churn`, a nightly
 * view that is empty on this database, and an empty answer was drawn as a
 * quiet platform. Under the founder's rule (B23) a number that is not real is
 * parked as an idea: it stays on its page, says "Not built yet" with its two
 * lines, and shows no number, no zero, no list and no "nobody".
 *
 * This page therefore makes NO request to the silent-churn feed. It is built
 * later, at request time, from each farm's last entry.
 */
const PARTS = ['silent-watchlist', 'silent-plan', 'silent-groups'];

export default function SilentChurnPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
          <TrendingDown size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
          Silent Churn Watchlist
        </h1>
        <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
          Farms that have gone quiet. None of this is counted yet, so each part waits below with what
          it will show and why it is here.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PARTS.map((metric) => (
          <NotBuiltYet key={metric} metric={metric} />
        ))}
      </div>
    </div>
  );
}
