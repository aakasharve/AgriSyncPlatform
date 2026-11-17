import { HeartPulse } from 'lucide-react';
import { NotBuiltYet } from '@/components/state';
import { FarmerSearchBox } from './components/FarmerSearchBox';

/**
 * FARMER HEALTH, the landing page (`/farmer-health`) — four ideas, no numbers
 * (amendment B24).
 *
 * The page used to be drawn from the cohort feed: an intervention queue, a
 * score spread, engagement tiers, six-part bars, an average by week and an
 * errors watchlist. Under the founder's rule (B23):
 *
 *  - Two of them are doubles and are gone. Engagement tiers (FH3) is the WVFD
 *    page's "Tiers A to D" (same view, same tiers); the errors watchlist (FH6)
 *    is the Suffering page's watchlist (the same view).
 *  - The other four are ideas. The farm health score is not counted on real
 *    inputs yet (one of its six parts has never been measured), so each stays
 *    on the page, says "Not built yet" with its two lines, and shows no number,
 *    no chart, no empty list and no "nobody".
 *
 * This page therefore makes NO request to the cohort or watchlist feeds. The
 * farm search box stays: it is a way into one farm, not a number, and it asks
 * for a farm only when someone searches.
 */
const PARTS = ['fh-queue', 'fh-distribution', 'fh-pillars', 'fh-cohort-avg'];

export default function FarmerHealthPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <HeartPulse size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Farmer Health
          </h1>
          <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
            How well each farm is doing with the app. None of this is counted yet, so each part
            waits below with what it will show and why it is here. Search for one farm to open its
            page.
          </p>
        </div>
        <FarmerSearchBox />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PARTS.map((metric) => (
          <NotBuiltYet key={metric} metric={metric} />
        ))}
      </div>
    </div>
  );
}
