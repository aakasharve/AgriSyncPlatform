import { NotBuiltYet } from '@/components/state';

/**
 * HOME (`/home`) — two ideas, no numbers (amendment B24, 2026-11-17).
 *
 * Home used to be "Ops Now": eight tiles and a call list. Under the founder's
 * rule (B23) a number shown twice is removed and a number that is not real is
 * parked as an idea, visible, saying "Not built yet" with its two lines.
 *
 *  - The seven doubles are gone, each lives on in the place that stays:
 *      Active alerts              -> Live Health, Alert rules
 *      API errors, last 2 hours   -> Live Health, Recent events
 *      AI call success, 24 h      -> Company MIS, Quality, Voice recordings saved
 *      Logs today                 -> Company MIS, Overview, Entries saved (range = today)
 *      WVFD                       -> WVFD page, Verified farm-days per farm
 *      Farms on record            -> Company MIS, Farms, Farms registered
 *      D30 retention              -> Company MIS, Retention, Active on day 30
 *  - The two that remain, monthly revenue (H8) and the farms a person should
 *    call today (H9), are ideas. No amount is stored anywhere, so H8 cannot be
 *    real until payments are recorded; H9 becomes real with the silent-farms and
 *    repeated-problems reads.
 *
 * This page therefore makes NO request: not to /admin/ops/health, not to
 * /admin/metrics/wvfd, not to /admin/farms, not to the suffering or silent-churn
 * feeds. An empty answer from a feed must never be drawn as "none".
 *
 * The lockup at the top is unchanged (brand contract: the halo sits under the
 * mark and behind no text).
 */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="relative flex flex-col items-center gap-4 pt-6 pb-9 text-center">
        <span
          aria-hidden="true"
          className="brand-hero-halo pointer-events-none absolute top-0 left-1/2 -z-10 h-[260px] w-[min(560px,90%)] -translate-x-1/2 rounded-full"
        />

        <img
          src="/brand/logo-full.webp"
          alt="Shram Safal"
          width={1100}
          height={330}
          loading="eager"
          decoding="async"
          className="brand-hero-mark h-[clamp(64px,9vw,104px)] w-auto object-contain drop-shadow-[0_10px_28px_rgba(15,92,61,0.16)]"
        />

        <p className="text-caption tracking-[0.16em] text-text-2 uppercase">Admin console</p>
      </header>

      <div>
        <h1 className="text-h1 font-bold text-text-1">Home</h1>
        <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
          Two ideas wait here until there is real data behind them. The company numbers are on the
          Company MIS pages.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <NotBuiltYet metric="home-mrr" />
        <NotBuiltYet metric="home-call-list" />
      </div>
    </div>
  );
}
