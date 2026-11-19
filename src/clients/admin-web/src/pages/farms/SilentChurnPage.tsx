import { useMemo } from 'react';
import { TrendingDown } from 'lucide-react';
import { LoadingState, MeasuredZero, MetricLines, NotMeasuredPanel } from '@/components/state';
import { Button } from '@/components/ui/Button';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { PersonName } from '@/components/ui/PersonName';
import { formatError } from '@/components/state';
import { metaRefreshedAt } from '@/lib/api';
import { DATE_FORMATS, fmt } from '@/lib/format';
import {
  NO_PLAN_LABEL,
  SILENT_BANDS,
  daysSilentWords,
  isForbiddenError,
  notMeasuredWords,
  planGroup,
  planWords,
} from '@/lib/silentFarms';
import { useSilentChurn, type SilentFarm } from '@/hooks/useFarms';

/**
 * SILENT CHURN (`/farms/silent-churn`) — farms that have gone quiet, counted live (CR-2e C26).
 *
 * The server counts each farm's last entry when the page opens and groups the
 * farms that have been silent 7 days or more (or never saved an entry). Each
 * load writes audit rows, so the page never refreshes on its own.
 *
 * A reason the server could not count is shown in words, never as an empty
 * list. A failed request says "could not load".
 */
function FarmTable({ farms, caption }: { farms: SilentFarm[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-body">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-caption text-text-3">
            <th scope="col" className="py-1 pr-4 font-semibold">Farm</th>
            <th scope="col" className="py-1 pr-4 font-semibold">Owner phone</th>
            <th scope="col" className="py-1 pr-4 font-semibold">Days silent</th>
            <th scope="col" className="py-1 pr-4 font-semibold">Last entry</th>
            <th scope="col" className="py-1 font-semibold">Plan</th>
          </tr>
        </thead>
        <tbody>
          {farms.map((f) => (
            <tr key={f.farmId} className="border-t border-border">
              <td className="py-1.5 pr-4 text-text-1">
                <PersonName name={f.name} fallback={`${f.farmId.slice(0, 8)}…`} />
              </td>
              <td className="py-1.5 pr-4 text-text-2">{f.ownerPhone ?? 'Phone not recorded'}</td>
              <td className="py-1.5 pr-4 text-text-2">{daysSilentWords(f)}</td>
              <td className="py-1.5 pr-4 text-text-2">
                {fmt.dateTime(f.lastEntryUtc, DATE_FORMATS.usersLastLogin) ?? 'No entry recorded'}
              </td>
              <td className="py-1.5 text-text-2">{planWords(f)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SilentChurnPage() {
  const { data, isLoading, isError, error, refetch } = useSilentChurn();
  const answer = data?.data;
  const reason = answer?.notMeasuredReason ?? null;
  const farms = useMemo(() => answer?.farms ?? [], [answer]);

  const byBand = useMemo(
    () => SILENT_BANDS.map((b) => ({ ...b, farms: farms.filter((f) => f.band === b.band) })),
    [farms],
  );
  const byPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of farms) map.set(planGroup(f), (map.get(planGroup(f)) ?? 0) + 1);
    return [...map.entries()].sort(
      (a, b) =>
        (a[0] === NO_PLAN_LABEL ? 1 : 0) - (b[0] === NO_PLAN_LABEL ? 1 : 0) || b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [farms]);

  const countedAt =
    fmt.dateTime(answer?.countedAtUtc, DATE_FORMATS.usersLastLogin) ?? 'a time the server did not report';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <TrendingDown size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Silent Churn Watchlist
          </h1>
          <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
            Farms that have gone quiet: no entry for 7 days or more, or no entry ever. Counted when
            this page opened.
          </p>
        </div>
        <FreshnessChip source="live" lastRefreshed={metaRefreshedAt(data?.meta)} />
      </div>

      <div className="flex flex-col gap-2">
        <MetricLines metric="silent-watchlist" />
        <MetricLines metric="silent-plan" />
        <MetricLines metric="silent-groups" />
      </div>

      {isLoading ? (
        <LoadingState label="Counting silent farms…" />
      ) : isError ? (
        <div role="alert" data-state="load-failed" className="rounded-panel bg-tint-red px-5 py-4">
          <p className="text-h3 font-semibold text-text-1">Could not load the silent farms.</p>
          <p className="mt-1 text-body text-text-2">
            {isForbiddenError(error) ? 'Not available for this account.' : formatError(error)}
          </p>
          <p className="mt-1 text-body text-text-2">
            Nothing is shown because nothing was received. This is not an empty list.
          </p>
          {!isForbiddenError(error) && (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
              Retry
            </Button>
          )}
        </div>
      ) : reason ? (
        <NotMeasuredPanel title="Silent farms not counted" why={notMeasuredWords(reason)} />
      ) : farms.length === 0 ? (
        <MeasuredZero what="No farm has been silent for 7 days or more" checkedAt={countedAt} />
      ) : (
        <>
          <section aria-label="Counts by silence and by plan" className="grid gap-4 md:grid-cols-2">
            <div className="rounded-panel bg-tint-grey px-5 py-4">
              <h2 className="text-h3 font-semibold text-text-1">By days silent</h2>
              <ul className="mt-2 text-body text-text-2">
                {byBand.map((b) => (
                  <li key={b.band} data-band-count={b.band}>
                    {b.label}: {b.farms.length} {b.farms.length === 1 ? 'farm' : 'farms'}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-panel bg-tint-grey px-5 py-4">
              <h2 className="text-h3 font-semibold text-text-1">By plan</h2>
              <ul className="mt-2 text-body text-text-2">
                {byPlan.map(([label, count]) => (
                  <li key={label} data-plan-count={label}>
                    {label}: {count} {count === 1 ? 'farm' : 'farms'}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {byBand.map((b) => (
            <section key={b.band} aria-label={b.label} data-band={b.band} className="flex flex-col gap-2">
              <h2 className="text-h2 font-semibold text-text-1">
                {b.label} ({b.farms.length} {b.farms.length === 1 ? 'farm' : 'farms'})
              </h2>
              {b.farms.length === 0 ? (
                <p className="text-body text-text-2">
                  No farm in this group when counted at {countedAt}.
                </p>
              ) : (
                <FarmTable farms={b.farms} caption={`Farms ${b.label}`} />
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
