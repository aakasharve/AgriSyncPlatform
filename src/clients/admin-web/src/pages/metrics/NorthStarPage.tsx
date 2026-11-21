import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Star } from 'lucide-react';
import {
  LoadingState,
  MetricLines,
  NotBuiltYet,
  NotMeasuredPanel,
  StandingNote,
  formatError,
} from '@/components/state';
import { Button } from '@/components/ui/Button';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { PersonName } from '@/components/ui/PersonName';
import { metaRefreshedAt } from '@/lib/api';
import { fmt } from '@/lib/format';
import { isForbiddenError } from '@/lib/silentFarms';
import { FarmNamesNeedTick } from '@/components/FarmNamesNeedTick';
import { useFarmContactsState } from '@/hooks/useFarmContacts';
import { useWvfd, type WvfdWeekDto } from '@/hooks/useWvfd';

/**
 * WVFD — the North Star (`/metrics/nsm`), counted when the page opens (CR-2e C32).
 *
 * The server counts, farm by farm, the days on which an entry was checked by a
 * person (not only by the person who saved it) within 48 hours. Days confirmed
 * only by the person who saved the entry are counted apart and shown beside the
 * checked days. They are never added in: whether they count is still open
 * (D-151 b), so no figure here is inflated.
 *
 * Weeks are India weeks. The current week is not over, so it is drawn and
 * labelled "so far" and is never the headline or compared with a full week.
 *
 * Nothing here polls. A number the server could not count is shown as its
 * reason in words, never as "none" and never as 0. The goal (W5) is not set
 * yet, so no share of a goal is shown.
 */
const WEEKS = 12;
const TIERS = ['A', 'B', 'C', 'D'] as const;
const TIER_RULE = 'A: 5 or more checked days, B: 3-4, C: 1-2, D: none';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function notMeasuredWords(reason: string): string {
  switch (reason) {
    case 'too_many_farms_for_live_count':
      return 'There are too many farms to count checked days live, so they were not counted.';
    case 'farm_list_unreadable':
      return 'At least one farm could not be read, so these numbers were not counted. This is not a zero.';
    default:
      return 'The server did not count checked days.';
  }
}

/** `2026-11-09` as `9 Nov`, without going through a time zone. */
function dayWords(weekStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(weekStart);
  if (!m) return weekStart;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

function weekLabel(w: WvfdWeekDto): string {
  return `${dayWords(w.weekStart)}${w.isPartial ? ' (so far)' : ''}`;
}

/** A number to two places at most, or null. */
function days(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return String(Math.round(v * 100) / 100);
}

function signed(v: number): string {
  const r = Math.round(v * 100) / 100;
  if (r === 0) return 'No change';
  return `${r > 0 ? '+' : '-'}${Math.abs(r)} days`;
}

const NO_ACTIVE_FARM = 'No farm saved an entry that week, so there is no average.';

function Panel({ title, children, metric }: { title: string; children: ReactNode; metric?: string }) {
  return (
    <section aria-label={title} className="rounded-panel bg-tint-grey px-5 py-4">
      <h2 className="text-h3 font-semibold text-text-1">{title}</h2>
      <div className="mt-2 text-body text-text-2">{children}</div>
      {metric && <MetricLines metric={metric} className="mt-3" />}
    </section>
  );
}

const CHART_W = 640;
const CHART_H = 220;
const PAD = { l: 40, r: 16, t: 16, b: 40 };
const FONT = "'DM Sans', sans-serif";

/** The chart's top value: the largest figure rounded up, never below 1. */
function chartTop(values: number[]): number {
  let biggest = 0;
  for (const v of values) if (v > biggest) biggest = v;
  return Math.max(1, Math.ceil(biggest));
}

/** Two series by week. A week with no average is a gap in the line, never a zero. */
function WeeksChart({ weeks }: { weeks: WvfdWeekDto[] }) {
  const values = weeks.flatMap((w) => [w.avgWvfd, w.avgSelfOnlyDays]).filter((v): v is number => v !== null);
  const top = chartTop(values);
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (weeks.length <= 1 ? innerW / 2 : (i * innerW) / (weeks.length - 1));
  const y = (v: number) => PAD.t + innerH - (v / top) * innerH;

  const runsOf = (pick: (w: WvfdWeekDto) => number | null) => {
    const runs: { i: number; v: number }[][] = [];
    let run: { i: number; v: number }[] = [];
    weeks.forEach((w, i) => {
      const v = pick(w);
      if (v === null || w.isPartial) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push({ i, v });
    });
    if (run.length) runs.push(run);
    return runs;
  };

  const drawSeries = (
    name: string,
    pick: (w: WvfdWeekDto) => number | null,
    className: string,
    dash?: string,
  ) => (
    <g className={className} data-series={name}>
      {runsOf(pick).map((r, k) => (
        <polyline
          key={k}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray={dash}
          points={r.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
        />
      ))}
      {weeks.map((w, i) => {
        const v = pick(w);
        if (v === null) return null;
        return (
          <circle
            key={w.weekStart}
            cx={x(i)}
            cy={y(v)}
            r={3.5}
            stroke="currentColor"
            strokeWidth={2}
            fill={w.isPartial ? 'none' : 'currentColor'}
          />
        );
      })}
    </g>
  );

  return (
    <svg
      role="img"
      aria-label="Average checked days and self-confirmed days per farm, by week"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full max-w-[640px]"
      style={{ fontFamily: FONT }}
    >
      <line
        x1={PAD.l}
        y1={PAD.t + innerH}
        x2={CHART_W - PAD.r}
        y2={PAD.t + innerH}
        stroke="currentColor"
        className="text-text-3"
      />
      <text x={PAD.l - 6} y={PAD.t + 4} textAnchor="end" fontSize={11} fontFamily={FONT} fill="currentColor" className="text-text-3">
        {top}
      </text>
      <text x={PAD.l - 6} y={PAD.t + innerH} textAnchor="end" fontSize={11} fontFamily={FONT} fill="currentColor" className="text-text-3">
        0
      </text>
      {weeks.map((w, i) =>
        i % 2 === 0 || i === weeks.length - 1 ? (
          <text
            key={w.weekStart}
            x={x(i)}
            y={CHART_H - 14}
            textAnchor="middle"
            fontSize={10}
            fontFamily={FONT}
            fill="currentColor"
            className="text-text-3"
          >
            {dayWords(w.weekStart)}
            {w.isPartial ? ' so far' : ''}
          </text>
        ) : null,
      )}
      {drawSeries('checked', (w) => w.avgWvfd, 'text-text-1')}
      {drawSeries('self-only', (w) => w.avgSelfOnlyDays, 'text-text-3', '5 4')}
    </svg>
  );
}

export default function NorthStarPage() {
  const { data, isLoading, isError, error, refetch } = useWvfd(WEEKS);
  const answer = data?.data;
  const reason = answer?.notMeasuredReason ?? null;

  const weeks = useMemo(
    () => [...(answer?.weeks ?? [])].sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    [answer],
  );
  const farms = useMemo(() => answer?.farms ?? [], [answer]);
  const lastComplete = useMemo(() => [...weeks].reverse().find((w) => !w.isPartial) ?? null, [weeks]);
  const weeksWithFarms = weeks.filter((w) => w.activeFarms >= 1).length;

  const tierCounts = useMemo(
    () => TIERS.map((t) => ({ tier: t, count: farms.filter((f) => f.engagementTier === t).length })),
    [farms],
  );

  const farmIds = useMemo(() => farms.map((f) => f.farmId), [farms]);
  const { contacts, refused: farmNamesRefused } = useFarmContactsState(farmIds, { namesOnly: true });

  const countedAt = fmt.dateTime(answer?.countedAtUtc);

  const current = answer?.currentWvfd ?? null;
  const prior = answer?.priorWvfd ?? null;
  const selfOnly = answer?.currentSelfOnlyDays ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <Star size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            North Star &middot; WVFD
          </h1>
          <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
            <b>Weekly checked farm-days</b> is the one number this product is steered by. A day counts when
            an entry saved that day was checked by a person within 48 hours. Counted when this page opened.
            Weeks run Monday to Sunday, India time.
          </p>
        </div>
        <FreshnessChip source="live" lastRefreshed={metaRefreshedAt(data?.meta)} />
      </div>

      {isLoading ? (
        <LoadingState label="Counting checked farm-days…" />
      ) : isError ? (
        <div role="alert" data-state="load-failed" className="rounded-panel bg-tint-red px-5 py-4">
          <p className="text-h3 font-semibold text-text-1">Could not load the checked farm-days.</p>
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
        <>
          <NotMeasuredPanel title="Checked farm-days not counted" why={notMeasuredWords(reason)} />
          <NotBuiltYet metric="wvfd-goal" word="Goal not set yet" />
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Days checked by a person, per farm, last week" metric="wvfd-average">
              <p data-wvfd="checked" className="text-h1 font-bold text-text-1">
                {days(current) ?? <span className="text-body font-normal text-text-3">{NO_ACTIVE_FARM}</span>}
              </p>
              <p className="mt-1 text-caption text-text-3">
                Last full week{lastComplete ? `, starting ${dayWords(lastComplete.weekStart)}` : ''}.
              </p>
              <p className="mt-1 text-caption text-text-3" data-wvfd="can-still-rise">
                Last week&apos;s number can still rise until Tuesday night, while its last entries can still be confirmed.
              </p>
              <div className="mt-3 border-t border-line pt-3" data-wvfd="self-only">
                <p className="text-caption font-semibold text-text-2">
                  Days confirmed only by the person who saved them
                </p>
                <p className="text-h3 font-semibold text-text-1">
                  {days(selfOnly) ?? <span className="text-body font-normal text-text-3">{NO_ACTIVE_FARM}</span>}
                </p>
                <p className="mt-1 text-caption text-text-3">
                  Shown apart. These are not added to the checked days.
                </p>
              </div>
            </Panel>

            <Panel title="Change from the week before" metric="wvfd-change">
              <p data-wvfd="change" className="text-h1 font-bold text-text-1">
                {current !== null && prior !== null ? (
                  signed(current - prior)
                ) : (
                  <span className="text-body font-normal text-text-3">
                    No comparison: a week with no farm saving an entry has no average.
                  </span>
                )}
              </p>
              {prior !== null && (
                <p className="mt-1 text-caption text-text-3">The week before averaged {days(prior)} checked days.</p>
              )}
            </Panel>

            <Panel title="Farms that saved an entry, last week" metric="wvfd-farms">
              <p data-wvfd="active-farms" className="text-h1 font-bold text-text-1">
                {lastComplete ? (
                  fmt.num(lastComplete.activeFarms)
                ) : (
                  <span className="text-body font-normal text-text-3">No full week to count yet.</span>
                )}
              </p>
            </Panel>

            <Panel title="Weeks with at least one farm saving an entry" metric="wvfd-weeks">
              <p data-wvfd="weeks-with-farms" className="text-h1 font-bold text-text-1">
                {fmt.num(weeksWithFarms)}
                <span className="ml-2 text-body font-normal text-text-3">of {fmt.num(weeks.length)} weeks shown</span>
              </p>
            </Panel>
          </div>

          <section aria-label="Checked days by week" className="flex flex-col gap-2">
            <h2 className="text-h2 font-semibold text-text-1">Average days per farm, by week</h2>
            <p className="text-caption text-text-3">
              Solid line: days checked by a person. Dashed line: days confirmed only by the person who saved
              them. The current week is not over, so it is marked &ldquo;so far&rdquo; and is not joined to the
              line. A week with no farm saving an entry has no point.
            </p>
            <WeeksChart weeks={weeks} />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body">
                <caption className="sr-only">Average days per farm, by week</caption>
                <thead>
                  <tr className="text-caption text-text-3">
                    <th scope="col" className="py-1 pr-4 font-semibold">Week starting</th>
                    <th scope="col" className="py-1 pr-4 font-semibold">Checked days</th>
                    <th scope="col" className="py-1 pr-4 font-semibold">Self-confirmed only</th>
                    <th scope="col" className="py-1 font-semibold">Farms</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => (
                    <tr key={w.weekStart} className="border-t border-border" data-week={w.weekStart}>
                      <td className="py-1.5 pr-4 text-text-1">{weekLabel(w)}</td>
                      <td className="py-1.5 pr-4 text-text-2">{days(w.avgWvfd) ?? 'No farm saved an entry'}</td>
                      <td className="py-1.5 pr-4 text-text-2">{days(w.avgSelfOnlyDays) ?? 'No farm saved an entry'}</td>
                      <td className="py-1.5 text-text-2">{fmt.num(w.activeFarms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <NotBuiltYet metric="wvfd-goal" word="Goal not set yet" />

          <section aria-label="Farms by tier" className="flex flex-col gap-2">
            <h2 className="text-h2 font-semibold text-text-1">Farms by tier, last week</h2>
            <p className="text-body text-text-2" data-wvfd="tier-rule">{TIER_RULE}</p>
            <ul className="grid gap-2 sm:grid-cols-4">
              {tierCounts.map((t) => (
                <li key={t.tier} data-tier-count={t.tier} className="rounded-panel bg-tint-grey px-4 py-3 text-body text-text-2">
                  <span className="font-semibold text-text-1">Tier {t.tier}</span>: {fmt.num(t.count)}{' '}
                  {t.count === 1 ? 'farm' : 'farms'}
                </li>
              ))}
            </ul>
            <MetricLines metric="wvfd-tiers" />
          </section>

          <section aria-label="Every farm" className="flex flex-col gap-2">
            <h2 className="text-h2 font-semibold text-text-1">Every farm, last week</h2>
            {farms.length === 0 ? (
              <p className="text-body text-text-2" data-wvfd="no-farms">
                No farm saved an entry last week{countedAt ? `, counted ${countedAt}` : ''}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <FarmNamesNeedTick refused={farmNamesRefused} />
                <table className="w-full text-left text-body">
                  <caption className="sr-only">Checked days last week, by farm</caption>
                  <thead>
                    <tr className="text-caption text-text-3">
                      <th scope="col" className="py-1 pr-4 font-semibold">Farm</th>
                      <th scope="col" className="py-1 pr-4 font-semibold">Checked days</th>
                      <th scope="col" className="py-1 pr-4 font-semibold">Self-confirmed only</th>
                      <th scope="col" className="py-1 font-semibold">Tier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {farms.map((f) => {
                      const contact = contacts.get(f.farmId.toLowerCase());
                      return (
                        <tr key={f.farmId} className="border-t border-border" data-farm={f.farmId}>
                          <td className="py-1.5 pr-4 text-text-1">
                            {contact ? (
                              <PersonName name={contact.name} fallback="Name not fetched" />
                            ) : farmNamesRefused ? (
                              <span className="text-text-3">{f.farmId.slice(0, 8)}</span>
                            ) : (
                              <span className="text-text-3">Name not fetched</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-4 text-text-2">{fmt.num(f.checkedDays)}</td>
                          <td className="py-1.5 pr-4 text-text-2">{fmt.num(f.selfOnlyDays)}</td>
                          <td className="py-1.5 text-text-2">{f.engagementTier}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <MetricLines metric="wvfd-farm-list" />
          </section>

          <StandingNote
            title="How these days are counted"
            summary="A day counts when an entry saved that day was checked by a person within 48 hours."
            why={
              <>
                <p>
                  An entry that only the person who saved it confirmed is shown apart, as
                  &ldquo;self-confirmed only&rdquo;. It is not added to the checked days, because whether such
                  days should count is not decided yet.
                </p>
                <p>
                  Test accounts are left out. Only farms that saved at least one entry in a week are in that
                  week&rsquo;s average, so a farm that saved nothing is not counted as zero.
                </p>
              </>
            }
          />
        </>
      )}
    </div>
  );
}
