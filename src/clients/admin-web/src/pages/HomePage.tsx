import type { ReactNode } from 'react';
import { LoadingState, MetricLines, NotBuiltYet, PhoneText } from '@/components/state';
import { Button } from '@/components/ui/Button';
import { PersonName } from '@/components/ui/PersonName';
import { notMeasuredWords } from '@/lib/silentFarms';
import { useShouldCallToday, type HalfState } from '@/hooks/useShouldCallToday';

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
const CALL_RULE_LINE = 'Quiet for 7 to 29 days, or 3 or more problems in the last 7 days.';

function halfNote(
  half: 'silent' | 'problems',
  state: HalfState,
  notMeasuredReason: string | null,
): string | null {
  const quiet = half === 'silent';
  const what = quiet ? 'quiet farms' : 'farms with repeated problems';
  switch (state) {
    case 'ready':
      return null;
    case 'loading':
      return `Still loading the ${what}.`;
    case 'restricted':
      return `Your role cannot read the ${what} list, so ${what} are not shown.`;
    case 'forbidden':
      return `The ${what} list is not available for this account, so ${what} are not shown.`;
    case 'failed':
      return `Could not load the ${what} list, so ${what} are not shown. This is not an empty list.`;
    case 'not-measured':
      return `Quiet farms could not be counted. ${notMeasuredWords(notMeasuredReason ?? '')}`;
  }
}

function CallList() {
  const { rows, silentState, problemsState, notMeasuredReason, churn, suffering } =
    useShouldCallToday();

  const notes = [
    { half: 'silent' as const, state: silentState },
    { half: 'problems' as const, state: problemsState },
  ]
    .map((n) => ({ ...n, text: halfNote(n.half, n.state, notMeasuredReason) }))
    .filter((n): n is typeof n & { text: string } => n.text !== null);

  const canRetry = silentState === 'failed' || problemsState === 'failed';
  const bothReady = silentState === 'ready' && problemsState === 'ready';
  const anyLoading = silentState === 'loading' || problemsState === 'loading';

  let body: ReactNode;
  if (rows.length === 0 && anyLoading) {
    body = <LoadingState label="Loading the call list…" height={120} />;
  } else if (rows.length === 0 && bothReady) {
    body = (
      <p data-state="no-call-today" className="text-body text-text-1">
        No farm to call today.
      </p>
    );
  } else {
    body = (
      <>
        {notes.length > 0 && (
          <div
            role={canRetry ? 'alert' : 'status'}
            data-state={canRetry ? 'load-failed' : 'half-not-shown'}
            className="mb-3 rounded-panel bg-tint-red px-4 py-3"
          >
            {notes.map((n) => (
              <p key={n.half} data-half={n.half} className="text-body text-text-2">
                {n.text}
              </p>
            ))}
            {canRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  if (silentState === 'failed') void churn.refetch();
                  if (problemsState === 'failed') void suffering.refetch();
                }}
              >
                Retry
              </Button>
            )}
          </div>
        )}
        {rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((r) => (
              <li key={r.farmId} data-farm-id={r.farmId} className="flex flex-col gap-0.5 py-2">
                <span className="text-body font-semibold text-text-1">
                  <PersonName name={r.name ?? ''} fallback={`${r.farmId.slice(0, 8)}…`} />
                </span>
                <span className="text-body text-text-2">
                  {/* A phone the caller may not see is "Hidden for you", never "Phone not recorded" (CR-3). */}
                  <PhoneText
                    value={r.ownerPhone}
                    whenNone={r.phoneKnown ? 'Phone not recorded' : 'Phone not fetched'}
                  />
                </span>
                <span className="text-caption text-text-3">
                  {r.reasons.map((x) => x.label).join('; ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <section
      aria-label="Farms a person should call today"
      data-metric="home-call-list"
      className="rounded-panel bg-tint-grey px-5 py-4 text-left"
    >
      <h3 className="text-h3 font-semibold text-text-1">Farms a person should call today</h3>
      <MetricLines metric="home-call-list" className="mt-1" />
      <p data-testid="home-call-rule" className="mt-1 mb-3 text-caption text-text-3">
        {CALL_RULE_LINE}
      </p>
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
