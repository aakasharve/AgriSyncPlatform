import type { ReactNode } from 'react';
import { LoadingState, MetricLines, NotBuiltYet, NotMeasuredPanel } from '@/components/state';
import { Button } from '@/components/ui/Button';
import { PersonName } from '@/components/ui/PersonName';
import { notMeasuredWords } from '@/lib/silentFarms';
import { useShouldCallToday } from '@/hooks/useShouldCallToday';

/**
 * HOME (`/home`): the farms a person should call today (H9) and one idea (H8).
 *
 * Under the founder's rule (B23) a number shown twice lives only in the place
 * that stays, and a number that is not real is parked as an idea.
 *
 *  - H9, the call list, is real: farms silent 7 to 29 days plus farms with
 *    repeated problems in the last 7 days, merged by farm id, each saying why
 *    it is listed. "No farm to call today" appears only when both answers are
 *    real and empty; a failed or not-counted answer says so instead.
 *  - H8, monthly revenue, stays "Not built yet": no amount is stored anywhere.
 *
 * The lockup at the top is unchanged (brand contract: the halo sits under the
 * mark and behind no text).
 */
function CallList() {
  const { rows, state, notMeasuredReason, churn, suffering } = useShouldCallToday();

  let body: ReactNode;
  if (state === 'restricted') {
    body = (
      <NotMeasuredPanel
        title="Call list not available"
        why="Your role cannot read both the silent farms and the repeated-problems lists, so no call list is shown."
      />
    );
  } else if (state === 'failed') {
    body = (
      <div role="alert" data-state="load-failed" className="rounded-panel bg-tint-red px-5 py-4">
        <p className="text-h3 font-semibold text-text-1">Could not load the call list.</p>
        <p className="mt-1 text-body text-text-2">
          One of the two lists did not answer. Nothing is shown because nothing was received. This
          is not an empty list.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            if (churn.isError) void churn.refetch();
            if (suffering.isError) void suffering.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  } else if (state === 'loading') {
    body = <LoadingState label="Loading the call list…" height={120} />;
  } else if (state === 'not-measured') {
    body = (
      <NotMeasuredPanel
        title="Silent farms not counted"
        why={notMeasuredWords(notMeasuredReason ?? '')}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <p data-state="no-call-today" className="text-body text-text-1">
        No farm to call today.
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((r) => (
          <li key={r.farmId} data-farm-id={r.farmId} className="flex flex-col gap-0.5 py-2">
            <span className="text-body font-semibold text-text-1">
              <PersonName name={r.name ?? ''} fallback={`${r.farmId.slice(0, 8)}…`} />
            </span>
            <span className="text-body text-text-2">{r.ownerPhone ?? 'Phone not recorded'}</span>
            <span className="text-caption text-text-3">
              {r.reasons.map((x) => x.label).join('; ')}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      aria-label="Farms a person should call today"
      data-metric="home-call-list"
      className="rounded-panel bg-tint-grey px-5 py-4 text-left"
    >
      <h3 className="text-h3 font-semibold text-text-1">Farms a person should call today</h3>
      <MetricLines metric="home-call-list" className="mt-1 mb-3" />
      {body}
    </section>
  );
}

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
          The farms to call today are below. Monthly revenue waits until there is real data behind
          it. The company numbers are on the Company MIS pages.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <NotBuiltYet metric="home-mrr" />
        <CallList />
      </div>
    </div>
  );
}
