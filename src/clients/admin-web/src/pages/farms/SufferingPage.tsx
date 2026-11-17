import { Frown } from 'lucide-react';
import { NotBuiltYet } from '@/components/state';

/**
 * SUFFERING (`/farms/suffering`) — two ideas, no numbers (amendment B24).
 *
 * The watchlist used to be read from `/admin/farms/suffering`, a nightly view
 * whose query names a column that does not exist, and an empty answer was
 * drawn as "no farm is suffering". Under the founder's rule (B23) a number
 * that is not real is parked as an idea: it stays on its page, says "Not built
 * yet" with its two lines, and shows no number, no zero, no list and no
 * "nobody".
 *
 * This page therefore makes NO request to the suffering feed. It is built
 * later, at request time, from the errors recorded for each farm.
 */
const PARTS = ['suffering-watchlist', 'suffering-areas'];

export default function SufferingPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
          <Frown size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
          Farmer Suffering Watchlist
        </h1>
        <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
          Farms that keep hitting problems. None of this is counted yet, so each part waits below
          with what it will show and why it is here.
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
