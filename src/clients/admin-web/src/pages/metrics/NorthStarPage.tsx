import type { ReactNode } from 'react';
import { Star } from 'lucide-react';
import { metaRefreshedAt } from '@/lib/api';
import {
  ChartShell,
  DataList,
  Sparkline,
  TIER_ORDER,
  fillAxis,
  isGap,
  measuredSlots,
} from '@/components/data';
import type { AxisPoint, AxisSlot, ChartDataTable, DataListColumn } from '@/components/data';
import { NotMeasured, NotMeasuredPanel, StandingNote } from '@/components/state';
import { Button } from '@/components/ui/Button';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { KpiCard } from '@/components/ui/KpiCard';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useListUrlState } from '@/lib/useListUrlState';
import {
  WVFD_FARM_LIMIT,
  WVFD_MAX_WEEKS,
  WVFD_MIN_WEEKS,
  useWvfd,
} from '@/hooks/useWvfd';
import type { WvfdFarmRow, WvfdWeek } from '@/hooks/useWvfd';

/**
 * NORTH STAR — WVFD. The number the product is steered by, and therefore the
 * screen where a fabricated figure costs the most.
 *
 * ── WHAT `/shramsafal/admin/metrics/wvfd` ACTUALLY MEASURES ──────────────
 * Read in the backend on 2026-09-01, not taken from the plan or from the
 * prototype. `GetWvfdHistoryAsync` (`AdminMisRepository.cs:15-80`) is two
 * `GROUP BY`s over one matview, `mis.wvfd_weekly`
 * (`20260817150453_WvfdWeekBoundaryToIst.cs:473-509`):
 *
 *     wvfd = COUNT of IST DAYS in the week on which this farm has at least
 *            one daily log that was confirmed within 48 hours, capped at 7
 *
 * Eight properties follow from that, and six of them contradict something
 * this screen used to say.
 *
 *  (1) 🛑 THE AVERAGE'S DENOMINATOR IS FARMS THAT LOGGED, NOT FARMS.
 *      `farm_week` is grouped out of `day_log`, which is grouped out of
 *      `ssf.daily_logs`. A farm that logged NOTHING in a week produces no
 *      row for that week at all, so it is not in `AVG(wvfd)` — while a farm
 *      that logged and had nothing confirmed IS in it, with a 0. The tile is
 *      therefore "verified farm-days per farm THAT LOGGED", and the metric
 *      RISES when the least engaged farms stop using the app altogether.
 *      That is the direction that matters: the number this product is
 *      steered by improves on churn. Said on screen; not fixable here,
 *      because the denominator is a property of the matview.
 *
 *  (2) 🛑 THE NEWEST WEEK IS ALWAYS A PARTIAL WEEK, AND IT IS THE HEADLINE.
 *      `week_start` is a Monday (`date_trunc('week', … AT TIME ZONE
 *      'Asia/Kolkata')`) and the matview is rebuilt nightly at 02:00 UTC
 *      (`MisRefreshJob.cs:125`), so the current week's figure covers only the
 *      days elapsed so far. On a Tuesday the maximum any farm can score is 1.
 *      The headline therefore falls every Monday and climbs through the week
 *      — a sawtooth that is an artefact of the calendar, not a change in the
 *      business. Both the hero figure and the week-on-week delta carry it.
 *
 *  (3) 🛑 THE GOAL IS A HARDCODED CONSTANT, AND IT WAS DEFINED ON A
 *      DIFFERENT WINDOW. `GoalWvfd: 4.5m` is a C# literal
 *      (`AdminMisRepository.cs:74`), repeated in the failure path at `:78`.
 *      The only other record of it in the platform is a doc-comment —
 *      `FarmWeekMisDto.cs:9`, *"Rolling 7-day verified farm-days (0-7). North
 *      Star target >= 4.5"* — which names a ROLLING seven days, while every
 *      figure here is a CALENDAR week. So the target is real and declared
 *      (unlike the 90% line Task 19 deleted from `/ops/voice`, which came
 *      from the client with nothing behind it), but it is stated against a
 *      window this endpoint does not measure. The bar is kept, the constant
 *      is named, and the mismatch is on screen rather than in a ticket.
 *
 *  (4) 🛑 THE CLIENT USED TO PRINT THE GOAL EVEN WHEN THE SERVER SENT
 *      NOTHING. `h?.goalWvfd.toFixed(1) ?? '4.5'` appeared three times
 *      (`NorthStarPage.tsx:97,125,126`) and `h?.currentWvfd?.toFixed(1) ??
 *      '0.0'` once (`:84`), over a `ReferenceLine y={4.5}` hardcoded into the
 *      chart. A failed request therefore rendered "0.0" under "goal 4.5" and
 *      a progress bar at 0% — four fabricated figures describing a request
 *      that never returned. Every one of them now goes through `fmt` and a
 *      null renders through `NotMeasured`.
 *
 *  (5) 🛑 `currentWvfd` IS A SENTINEL WHEN THERE ARE NO WEEKS.
 *      `weekRows.Count > 0 ? weekRows[^1].AvgWvfd : 0m` (`:68`). A 0 from this
 *      field is the server's substitution as often as it is a reading, so it
 *      is only believed when a week on the axis carries one. Same rescue as
 *      the `COALESCE(…, 0)` latency on `/ops/voice`.
 *
 *  (6) 🛑 `priorWvfd` IS THE PREVIOUS ROW, NOT THE PREVIOUS WEEK.
 *      `weekRows[^2].AvgWvfd` (`:69`). When a week in between has no row, the
 *      old label "vs last week" named a comparison that was not made. The
 *      week actually compared against is read off the axis and printed by
 *      name, and a non-adjacent comparison says so.
 *
 *  (7) 🛑 THE PER-FARM LIST IS A TRUNCATED PREFIX, WORST-FIRST.
 *      `ORDER BY w.wvfd DESC LIMIT 50` over the single latest week
 *      (`:49-58`). Because `engagement_tier` is derived from the same count
 *      (A >= 5, B 3-4, C 1-2, D 0), tier is a MONOTONE function of `wvfd` —
 *      so at 50 rows the cut falls at the BOTTOM and the tier counts under
 *      it are floors, not counts. The old page computed its tier chips from
 *      this list and presented them as the distribution: a "Tier D: 0" that
 *      is systematically the first thing truncated away.
 *
 *  (8) 🔴 AN ELEVENTH SWALLOW SITE, AND THE WORST ONE FOUND SO FAR.
 *      `catch { return new WvfdHistoryDto(0m, null, 4.5m, [], []); }`
 *      (`AdminMisRepository.cs:78`) — beside `:145`, `:219`, `:245`, `:287`
 *      and the five in `AdminOpsRepository`. A dropped connection, a missing
 *      matview or a permission failure on `mis.*` arrives with HTTP 200 AND
 *      A COMPLETE SET OF NUMBERS: a current WVFD of 0 and a goal of 4.5. It
 *      is the only swallow site in this console that fabricates the figures
 *      rather than emptying them, so `measuredZero.unproven` is supplied and
 *      an empty answer is never reported as a measured zero.
 *
 * ── THE ENDPOINT TAKES NO ORGANISATION ───────────────────────────────────
 * `AdminEndpoints.cs:155-171` takes `weeks` and nothing else — the seventh
 * admin endpoint checked and the seventh that is platform-wide. The org in
 * the query key separates the CACHE; it does not scope the DATA. No sentence
 * on this screen says "in this organisation".
 *
 * ── THE WINDOW SELECTOR, WHICH THE DESIGN CANNOT SHOW ────────────────────
 * v3's `wvfd.html` is headed "Twelve-week trend" with twelve weeks hardcoded
 * in `data.js`, so it has no week control and a design-led port deletes one
 * that works. It is kept (A18, A19, B5), and the value reaches ALL FOUR of
 * the places it has to:
 *
 *   1. the hook argument            `useWvfd(weeks)`
 *   2. the QUERY KEY                `['metrics','wvfd',org,weeks]` — miss this
 *                                   and 8, 12 and 24 share one cache entry,
 *                                   which is a wrong number with no error
 *   3. the API query string         `?weeks=<n>`
 *   4. the interpolated card title  "WVFD — last N weeks"
 */

/* ────────────────────────────────────────────────────────────── THE WINDOW */

const WINDOWS = [8, 12, 24] as const;
const DEFAULT_WEEKS = 12;

/**
 * `?weeks`, read strictly — the same rule Task 19 applied to `?days`.
 *
 * The old page did `Number(searchParams.get('weeks') ?? 12)` and passed the
 * result on unchecked, so `?weeks=x` produced the literal request
 * `?weeks=NaN` against a non-nullable `int` (`AdminEndpoints.cs:159`), and
 * `?weeks=2` was silently answered as 4 because the server clamps to 4-52
 * (`:167`) and does not say so. Both end with the address bar naming a window
 * the figures do not have.
 */
function readWeeks(raw: string | null): { weeks: number; unusable: string | null } {
  if (raw === null) return { weeks: DEFAULT_WEEKS, unusable: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < WVFD_MIN_WEEKS || n > WVFD_MAX_WEEKS) {
    return { weeks: DEFAULT_WEEKS, unusable: raw };
  }
  return { weeks: n, unusable: null };
}

/* ──────────────────────────────────────────────────────────────── THE AXIS */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The date the window is measured back from, taken from the SERVER and never
 * from this browser's clock. `new Date()` at render is the fabricated-
 * freshness defect (D5) and the impurity `react-hooks/purity` flags on
 * `HomePage.tsx:19`.
 *
 * `meta.lastRefreshedUtc` is `DateTime.UtcNow` taken as the request is served
 * (`GetWvfdHistoryHandler.cs:19`), which is the same clock and the same zone
 * as the `CURRENT_DATE` the SQL window is measured from. If the envelope
 * carries no stamp, the newest week in the answer is used instead — a real
 * reading rather than a guess. If there is neither, there is no axis, and the
 * shell says so.
 */
function anchorDateOf(readAtIso: string | undefined, rows: WvfdWeek[]): string | null {
  const stamped = readAtIso?.slice(0, 10);
  if (stamped && ISO_DATE.test(stamped)) return stamped;

  const starts = rows.map((r) => r.weekStart).filter((d) => ISO_DATE.test(d)).sort();
  return starts.length > 0 ? starts[starts.length - 1] : null;
}

/** The Monday on or before `ms`. Postgres `date_trunc('week', …)` starts on
 *  Monday, so every `week_start` this feed sends is one. */
function mondayOnOrBefore(ms: number): number {
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  return ms - ((dow + 6) % 7) * DAY_MS;
}

/**
 * THE FIXED AXIS OF WEEK STARTS, oldest first — built to reach exactly what
 * the SQL reaches and not one slot more.
 *
 * The query is `WHERE week_start >= CURRENT_DATE - INTERVAL '{weeks * 7}
 * days'` (`AdminMisRepository.cs:33`), so the oldest slot is the FIRST MONDAY
 * on or after that date and the newest is the Monday of the anchor's own
 * week. That is `weeks` slots on most days and `weeks + 1` when the anchor
 * itself falls on a Monday — arithmetic, not an off-by-one, and it is worth
 * being exact about: `fillAxis` IGNORES a row whose key is not on the axis,
 * so an axis one slot short would drop the server's oldest week in silence.
 */
function axisFor(anchorDate: string | null, span: number): AxisPoint[] {
  if (anchorDate === null) return [];
  const anchor = Date.parse(`${anchorDate}T00:00:00Z`);
  if (!Number.isFinite(anchor)) return [];

  const newest = mondayOnOrBefore(anchor);
  const cutoff = anchor - span * 7 * DAY_MS;
  const oldestCandidate = mondayOnOrBefore(cutoff);
  const oldest = oldestCandidate < cutoff ? oldestCandidate + WEEK_MS : oldestCandidate;

  const points: AxisPoint[] = [];
  for (let at = oldest; at <= newest; at += WEEK_MS) {
    const key = new Date(at).toISOString().slice(0, 10);
    points.push({ key, label: fmt.date(key, DATE_FORMATS.nsmWeek) ?? key });
  }
  return points;
}

/* ───────────────────────────────────────────────────────────── THE VALUES */

/** The most verified days a week can hold — `LEAST(verified_farm_days, 7)` in
 *  the matview. An average outside 0-7 is not a possible reading, so it is
 *  reported as missing rather than pulled to the nearest bound. */
const WVFD_MAX = 7;

function readingIn(v: unknown, hi: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= hi ? v : null;
}

function avgOf(week: WvfdWeek): number | null {
  return readingIn(week.avgWvfd, WVFD_MAX);
}

/** The average's own denominator — `COUNT(DISTINCT farm_id)` in that week. */
function farmsOf(week: WvfdWeek): number | null {
  const v = week.activeFarms;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** v3's threshold, and the only thing on this screen that earns a leading
 *  edge (`wvfd.html:174`). Under one verified day in seven is the row that
 *  needs a person — and because tier is a monotone function of the same
 *  count, it is exactly the set of tier-D farms. */
const ATTENTION_BELOW = 1;

const AVG_UNREADABLE =
  'The server sent an average outside 0-7, which is not a possible reading for a metric capped at seven days. It is reported as missing rather than pulled to the nearest bound.';

const TIER_CLASS: Record<string, string> = {
  A: 'bg-tint-green text-green',
  B: 'bg-tint-blue text-blue',
  C: 'bg-tint-amber text-amber',
  D: 'bg-tint-red text-red',
};

/* ────────────────────────────────────────────────────────────── THE TABLE */

/** The shell's own table — same rows, same order, same gaps as the chart
 *  above it. A gap row is rendered by the shell, so no function here can be
 *  handed an argument that lets it print a 0 for a week nobody measured. */
function weekTable(goal: number | null): ChartDataTable<WvfdWeek> {
  return {
    caption:
      'Every week in this window, with the average verified farm-days across the farms that have a row that week, how many farms that was, and where the average sits against the goal. A week with no row carries one honest cell rather than three zeroes.',
    slotHeader: 'Week of',
    columns: [
      {
        key: 'avg',
        label: 'Average WVFD',
        align: 'right',
        value: (w) => fmt.num(avgOf(w), 2) ?? <NotMeasured why={AVG_UNREADABLE} />,
      },
      {
        key: 'farms',
        /* A MEASURED ZERO CANNOT LAND HERE and that is worth stating: a week
           with no farms produces no row at all, so `activeFarms` is 1 or
           more on every week that exists. A 0 in this column would mean the
           feed sent a row it could not have built. */
        label: 'Farms with a row',
        align: 'right',
        value: (w) => fmt.num(farmsOf(w)) ?? <NotMeasured />,
      },
      {
        key: 'goal',
        label: 'Share of goal',
        align: 'right',
        value: (w) => {
          const avg = avgOf(w);
          if (avg === null) return <NotMeasured why={AVG_UNREADABLE} />;
          if (goal === null || goal <= 0) return <NotMeasured why={NO_GOAL} />;
          return fmt.pct((avg / goal) * 100, 1);
        },
      },
    ],
  };
}

const NO_GOAL =
  'The answer carried no usable goal, so there is nothing to state a share of. The goal is not computed here — it arrives from the API.';

/* ───────────────────────────────────────────────────────── THE FARM TABLE */

const FARM_SEARCH_KEYS = (f: WvfdFarmRow) => [f.farmId, f.engagementTier];

function farmColumns(goal: number | null): DataListColumn<WvfdFarmRow>[] {
  return [
    {
      key: 'farm',
      /* NOT "Farm". `WvfdFarmRowDto` carries `FarmId` and nothing else that
         identifies a farm — no name, no owner, no phone, no village
         (`AdminMisRepository.cs:49-58`). v3's design puts the farm name,
         owner and phone in this cell; there is nothing in this payload to
         put there, so the header says what the cell actually holds rather
         than promising a name. Same call Task 14 made on "Owner phone". */
      label: 'Farm id',
      render: (f) => <span className="text-caption [overflow-wrap:anywhere]">{f.farmId}</span>,
      sortType: 'text',
      sortValue: (f) => f.farmId,
      defaultDir: 'asc',
    },
    {
      key: 'tier',
      label: 'Tier',
      render: (f) => (
        <span
          data-tier={f.engagementTier}
          className={cn(
            'inline-grid size-8 place-items-center rounded-chip text-caption font-bold',
            TIER_CLASS[f.engagementTier] ?? 'bg-tint-grey text-text-2',
          )}
        >
          {f.engagementTier}
        </span>
      ),
      sortType: 'text',
      sortValue: (f) => f.engagementTier,
      defaultDir: 'asc',
    },
    {
      key: 'wvfd',
      label: 'WVFD',
      align: 'right',
      render: (f) => fmt.num(readingIn(f.wvfd, WVFD_MAX), 1) ?? <NotMeasured why={AVG_UNREADABLE} />,
      sortType: 'num',
      sortValue: (f) => readingIn(f.wvfd, WVFD_MAX),
      state: (f) => (readingIn(f.wvfd, WVFD_MAX) === null ? 'unmeasured' : null),
      defaultDir: 'desc',
    },
    {
      key: 'share',
      label: 'Share of goal',
      align: 'right',
      render: (f) => {
        const wvfd = readingIn(f.wvfd, WVFD_MAX);
        if (wvfd === null) return <NotMeasured why={AVG_UNREADABLE} />;
        if (goal === null || goal <= 0) return <NotMeasured why={NO_GOAL} />;
        return fmt.pct((wvfd / goal) * 100, 1);
      },
      sortType: 'num',
      sortValue: (f) => {
        const wvfd = readingIn(f.wvfd, WVFD_MAX);
        return goal === null || goal <= 0 || wvfd === null ? null : wvfd / goal;
      },
      state: () => (goal === null || goal <= 0 ? 'unmeasured' : null),
      defaultDir: 'desc',
    },
  ];
}

/* ───────────────────────────────────────────────────────────── THE SCREEN */

/** The index of the newest slot at or below `from` that carries a reading. */
function lastMeasuredAtOrBefore<V>(slots: readonly AxisSlot<V>[], from: number): number {
  for (let i = Math.min(from, slots.length - 1); i >= 0; i--) {
    if (!isGap(slots[i])) return i;
  }
  return -1;
}

/** The slot at `index`, but ONLY if it carries a reading. */
function valueSlotAt<V>(
  slots: readonly AxisSlot<V>[],
  index: number,
): Extract<AxisSlot<V>, { kind: 'value' }> | null {
  const slot = index >= 0 ? slots[index] : undefined;
  return slot === undefined || isGap(slot) ? null : slot;
}

export default function NorthStarPage() {
  /* `?weeks` goes through the ONE url-state hook, which writes through the
     functional updater and therefore cannot drop `?org` on the way (A18,
     A20). The old page hand-rolled that write at `NorthStarPage.tsx:35-37`. */
  const url = useListUrlState();
  const { weeks, unusable } = readWeeks(url.get('weeks'));

  const { data, isLoading, isFetching, isError, error, refetch } = useWvfd(weeks);

  const history = data?.data;
  const rows = history?.weeks ?? [];
  const farms = history?.topFarms ?? [];

  /* THE ENVELOPE SENDS `lastRefreshedUtc`. Read through the one accessor that
     knows both spellings — a fixture stubbing `lastRefreshed` is why an
     inverted type survived on every screen until `7a742b05`. */
  const lastRefreshed = metaRefreshedAt(data?.meta);
  const readAt = fmt.dateTime(lastRefreshed, DATE_FORMATS.usersLastLogin);
  const checkedAt = readAt ?? 'a time the server did not report';

  const anchor = anchorDateOf(lastRefreshed, rows);
  const axis = axisFor(anchor, weeks);
  const axisKeys = new Set(axis.map((p) => (typeof p === 'string' ? p : p.key)));

  /* NOTHING FALLS OFF THE AXIS SILENTLY. `fillAxis` ignores a row it has no
     slot for, which is right — a feed that starts returning an extra week
     must not widen a chart the reader has learned the shape of — but the
     reader is owed the fact that it happened. */
  const offAxis = rows.filter((r) => !axisKeys.has(r.weekStart)).length;

  const slots = fillAxis<WvfdWeek, WvfdWeek>(axis, rows, {
    keyOf: (r) => r.weekStart,
    valueOf: (r) => r,
  });

  const measured = measuredSlots(slots);
  const measuredCount = measured.length;
  const nothingMeasured = measuredCount === 0;

  /* THE TWO WEEKS THE HEADLINE IS ABOUT, READ OFF THE AXIS.
     Property (6): the server's `priorWvfd` is the previous ROW. Which WEEK
     that was is only knowable from the axis, and naming it is the difference
     between a true label and "vs last week". */
  const newestIdx = lastMeasuredAtOrBefore(slots, slots.length - 1);
  const priorIdx = newestIdx > 0 ? lastMeasuredAtOrBefore(slots, newestIdx - 1) : -1;
  /* Narrowed through `isGap` rather than asserted: the gap branch has no
     `value` property at all, so a cast here would be the one place on this
     screen where `slot.value` could be reached for a week nobody measured. */
  const currentWeek = valueSlotAt(slots, newestIdx);
  const priorWeek = valueSlotAt(slots, priorIdx);
  const weeksApart = newestIdx >= 0 && priorIdx >= 0 ? newestIdx - priorIdx : null;
  /* The newest week ON THE AXIS has no row: the headline is not this week's. */
  const headlineIsStale = newestIdx >= 0 && newestIdx < slots.length - 1;

  /* Property (5): a 0 from `currentWvfd` is the server's substitution unless
     a week on the axis carries a reading it could have been the average of. */
  const current = nothingMeasured ? null : readingIn(history?.currentWvfd, WVFD_MAX);
  const prior = nothingMeasured ? null : readingIn(history?.priorWvfd, WVFD_MAX);
  /* Property (3) and (4): routed through the same sanitiser as every other
     figure, so a missing goal is an absence and never a client-side 4.5. */
  const goal = readingIn(history?.goalWvfd, WVFD_MAX);
  const hasGoal = goal !== null && goal > 0;

  const delta = current !== null && prior !== null ? current - prior : null;
  const goalPct = current !== null && hasGoal ? (current / goal) * 100 : null;
  const goalMet = goalPct !== null && goalPct >= 100;

  const currentWeekLabel =
    currentWeek === null ? null : fmt.date(currentWeek.key, DATE_FORMATS.nsmWeekFull);
  const priorWeekLabel =
    priorWeek === null ? null : fmt.date(priorWeek.key, DATE_FORMATS.nsmWeekFull);

  /* The denominator, MEASURED rather than assumed — `COUNT(DISTINCT farm_id)`
     for the headline week. It is the only figure this feed carries about how
     many farms the average is over. */
  const farmsThisWeek = currentWeek === null ? null : farmsOf(currentWeek.value);

  /* Property (7): at the server's LIMIT the list is a truncated prefix of a
     WVFD-descending order, so every tier count below the cut is a floor. */
  const capped = farms.length >= WVFD_FARM_LIMIT;
  const tierCounts = TIER_ORDER.map((tier) => ({
    tier,
    count: farms.filter((f) => f.engagementTier === tier).length,
  }));
  const attentionFarms = farms.filter((f) => {
    const wvfd = readingIn(f.wvfd, WVFD_MAX);
    return wvfd !== null && wvfd < ATTENTION_BELOW;
  }).length;

  /* The server echoes the window it actually used — `last {weeks} weeks`
     (`GetWvfdHistoryHandler.cs:18`) — AFTER its own clamp. Comparing the two
     is free, and it is the only way this screen can notice it was answered
     about a different window from the one in the address bar. */
  const echoed = /last (\d+) weeks/.exec(data?.meta?.window ?? '');
  const serverWeeks = echoed ? Number(echoed[1]) : null;
  const windowMismatch = serverWeeks !== null && serverWeeks !== weeks;

  /* Never "0 of 0 weeks measured": with no axis there is no denominator, and
     a ratio invented to fill a caption is the same fabrication as a zero. */
  const windowWords =
    axis.length === 0
      ? 'no weeks could be placed on this axis'
      : `${measuredCount} of ${axis.length} weeks have a row`;

  const unproven: ReactNode = (
    <>
      This feed answers its own database failures with a complete-looking result and a success code
      (<code>catch {'{'} return new WvfdHistoryDto(0m, null, 4.5m, [], []) {'}'}</code>,{' '}
      <code>AdminMisRepository.cs:78</code>), so a broken query arrives here carrying a WVFD of 0
      and a goal of 4.5 rather than an error. Nothing was received at {checkedAt}, and that is all
      this screen can honestly say.
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <Star size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            North Star &middot; WVFD
          </h1>
          {/* Property (1) and the endpoint's scope, in the two sentences that
              stop every figure below from being read as something it is not. */}
          <p className="mt-1 text-body text-text-2">
            Weekly Verified Farm-Days is the number the product is steered by: how many days in a
            week a farm closed with work that someone confirmed, averaged across{' '}
            <b>the farms that logged something that week</b> &mdash; platform-wide. A farm that
            logged nothing has no row and is left out of the average entirely, so this figure rises
            when the least engaged farms stop using the app.
          </p>
        </div>
        <FreshnessChip
          source={data?.meta?.source ?? 'materialized'}
          lastRefreshed={lastRefreshed}
        />
      </div>

      {/* ── A19 / B5 — the control v3 has no design for ─────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption font-semibold text-text-2" id="nsm-window-label">
            Window
          </span>
          <div
            role="group"
            aria-labelledby="nsm-window-label"
            className="flex flex-wrap items-center gap-2"
          >
            {WINDOWS.map((w) => (
              <Button
                key={w}
                variant="outline"
                size="sm"
                aria-pressed={w === weeks}
                className={w === weeks ? 'border-blue text-blue' : undefined}
                onClick={() => url.set('weeks', w)}
              >
                {w} weeks
              </Button>
            ))}
          </div>
        </div>
        <p className="text-caption text-text-3">
          {unusable === null ? (
            <>
              The window is in the address bar, so a link to this screen carries it. Weeks start on
              a Monday in India time, and the newest one is still in progress &mdash; its figure
              covers only the days elapsed so far.
            </>
          ) : (
            <>
              The address bar asked for <b>{unusable}</b> weeks, which is outside the{' '}
              {WVFD_MIN_WEEKS} to {WVFD_MAX_WEEKS} the server accepts. Showing {weeks} weeks
              instead &mdash; the server would have quietly clamped it and answered a different
              window from the one the link named.
            </>
          )}
        </p>
        {windowMismatch && (
          <p className="text-caption text-text-3">
            The server says it measured <b>{serverWeeks} weeks</b> while this page asked for{' '}
            {weeks}. The figures below are the server&rsquo;s window, not this page&rsquo;s.
          </p>
        )}
      </div>

      {/* ── the four tiles ─────────────────────────────────────────────── */}
      <div data-kpis="wvfd" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Verified farm-days per farm"
          value={fmt.num(current, 1)}
          state={current === null ? 'unmeasured' : 'ok'}
          /* v3's rule, carried over: the only thing that takes a colour of its
             own is meeting the goal. Everything else is neutral blue, because
             no other rule on this platform names a line for this figure. */
          tone={goalMet ? 'green' : 'blue'}
          caption={
            currentWeekLabel
              ? `week of ${currentWeekLabel} · read at ${checkedAt}`
              : `${windowWords} · read at ${checkedAt}`
          }
          note={
            headlineIsStale
              ? 'This is not the current week. The newest week on the axis has no row in the aggregate, so this figure is the most recent week that does.'
              : 'The newest week is still in progress and the aggregate is rebuilt once a night, so this covers only the days elapsed so far.'
          }
        />
        <KpiCard
          label="Change from the week before"
          value={delta === null ? null : `${delta > 0 ? '+' : ''}${fmt.num(delta, 2)}`}
          state={delta === null ? 'unmeasured' : 'ok'}
          tone={delta === null || delta === 0 ? 'blue' : delta > 0 ? 'green' : 'red'}
          caption={
            priorWeekLabel
              ? `against the week of ${priorWeekLabel}, which was ${fmt.num(prior, 2)}`
              : 'no earlier week in this window carries a reading'
          }
          note={
            weeksApart !== null && weeksApart > 1
              ? `That week is ${weeksApart} weeks back, not one: the weeks between it and the headline have no row. This is not a week-on-week change.`
              : 'Both weeks are calendar weeks and the newer one is partial, so part of any fall is the days it has not reached yet.'
          }
        />
        <KpiCard
          label="Farms with a row that week"
          value={fmt.num(farmsThisWeek)}
          state={farmsThisWeek === null ? 'unmeasured' : 'ok'}
          tone="blue"
          caption={
            currentWeekLabel ? `week of ${currentWeekLabel}` : 'no week carries a reading'
          }
          note="This is the average's own denominator. How many farms exist in total is not in this answer, so the share of farms that logged cannot be stated here."
        />
        <KpiCard
          label="Weeks with a row"
          value={axis.length === 0 ? null : `${measuredCount} of ${axis.length}`}
          state={axis.length === 0 ? 'unmeasured' : 'ok'}
          tone={measuredCount < axis.length ? 'amber' : 'blue'}
          caption={`read at ${checkedAt}`}
          note={
            measuredCount < axis.length
              ? 'The weeks without a row are drawn as gaps in the chart, not as troughs. The series breaks rather than dropping to zero.'
              : 'Every week in this window has a row in the aggregate.'
          }
        />
      </div>

      {/* ── the goal, and where it comes from ──────────────────────────── */}
      <section
        data-goal="wvfd"
        aria-labelledby="nsm-goal-title"
        className="glass-panel flex flex-col gap-3 rounded-panel px-5 py-4"
      >
        <h2 id="nsm-goal-title" className="text-h3 font-semibold text-text-1">
          Against the goal
        </h2>

        {current === null || !hasGoal ? (
          /* Property (4). The old page drew this bar at 0% under a hardcoded
             "4.5" whenever the request returned nothing. */
          <NotMeasuredPanel
            title="There is no share of the goal to draw"
            why={
              current === null ? (
                <>
                  No week in this window carries an average, so there is no figure to place against
                  a goal. Nothing was received at {checkedAt}. The bar is not drawn at zero, and no
                  goal figure is printed from this screen&rsquo;s own code.
                </>
              ) : (
                <>
                  The answer carried no usable goal. The goal is not computed here &mdash; it
                  arrives from the API, and this screen has no fallback value of its own to print
                  in its place.
                </>
              )
            }
          />
        ) : (
          <>
            <p className="text-body text-text-1">
              <b>{fmt.num(current, 1)}</b> verified farm-days per farm in the week of{' '}
              {currentWeekLabel}, against a goal of <b>{fmt.num(goal, 1)}</b>.
            </p>
            <div
              role="img"
              aria-label={`${fmt.num(current, 1)} of a goal of ${fmt.num(goal, 1)}, which is ${fmt.pct(goalPct, 0)}`}
              className="h-4 w-full overflow-hidden rounded-chip border border-line bg-wash"
            >
              <div
                data-goal-fill=""
                className={cn(
                  'h-full rounded-chip',
                  goalMet ? 'bg-green-vivid' : 'bg-blue-vivid',
                )}
                style={{ width: `${Math.min(100, goalPct ?? 0)}%` }}
              />
            </div>
            <p className="text-caption text-text-3">
              {fmt.pct(goalPct, 0)} of the goal. The bar is the share of the goal, so full width
              would be {fmt.num(goal, 1)}.
            </p>
          </>
        )}

        <p className="text-caption text-text-3">
          {/* Property (3), on screen rather than in a ticket. */}
          <b>Where the goal comes from.</b> It is a constant written into the API
          (<code>AdminMisRepository.cs:74</code>) &mdash; there is no setting for it, no table
          behind it and no screen that changes it. The only other record of it in this platform
          describes a <b>rolling seven days</b>, while every figure here is a calendar week, so the
          target and the measurement are not defined over the same window.
        </p>
      </section>

      {/* ── the note v3 puts under the goal, verified against the code ── */}
      <section
        data-note="verified"
        aria-labelledby="nsm-verified-title"
        className="glass-panel flex flex-col gap-2 rounded-panel px-5 py-4"
      >
        <h2 id="nsm-verified-title" className="text-h3 font-semibold text-text-1">
          &ldquo;Verified&rdquo; does not yet mean independently verified
        </h2>
        <p className="text-caption text-text-2">
          A day counts towards this number when a log is confirmed within 48 hours. That transition
          is gated on the confirming person&rsquo;s <b>role on the farm</b> and on nothing else
          &mdash; <code>VerificationStateMachine.cs</code> never reads who recorded the log, so a
          farm owner confirming their own entry counts exactly like a supervisor confirming it.
          Read this as confirmed activity, not as independent confirmation. It is a known gap in
          the metric, and this screen will not imply otherwise until the check exists.
        </p>
      </section>

      {/* ── the chart, the gaps and the table ──────────────────────────── */}
      <ChartShell<WvfdWeek>
        id="wvfd-weeks"
        /* A19's fourth place. `weeks` is interpolated HERE, and a test breaks
           if the title and the request ever disagree. */
        title={`WVFD — last ${weeks} weeks`}
        subtitle={
          <span className="text-caption text-text-2">
            {windowWords} &middot; read at {checkedAt}
          </span>
        }
        slots={slots}
        dataTable={weekTable(goal)}
        states={{
          isLoading,
          isFetching,
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: 'No week in this window carries a reading',
            checkedAt,
            /* Property (8) — the eleventh swallow site, and the only one that
               fabricates figures rather than emptying them. */
            unproven,
          },
        }}
      >
        <div className="flex flex-col gap-4">
          <Sparkline<WvfdWeek>
            slots={slots}
            valueOf={avgOf}
            tone="green"
            size="lg"
            label={`Average verified farm-days for each of the ${axis.length} weeks in this window. The exact figures are in the data table below.`}
          />
          <p className="text-caption text-text-3">
            Bar height is in proportion to the highest reading in the window. Older weeks are drawn
            fainter; a hatched week has no row in the aggregate and takes no fade, because an
            absence has no recency worth reading. The newest bar is a week still in progress, so it
            is lower than a finished week for a reason that is not about the farms.
          </p>
          {offAxis > 0 && (
            <p className="text-caption text-text-3">
              The server also returned {fmt.num(offAxis)}{' '}
              {offAxis === 1 ? 'week that is' : 'weeks that are'} outside this axis, so{' '}
              {offAxis === 1 ? 'it is' : 'they are'} not drawn above and not counted in any figure
              on this screen.
            </p>
          )}
        </div>
      </ChartShell>

      {/* ── the tier chips (register: keep them) ───────────────────────── */}
      {farms.length > 0 && (
        <section
          data-tiers="wvfd"
          aria-labelledby="nsm-tiers-title"
          className="flex flex-col gap-2"
        >
          <h2 id="nsm-tiers-title" className="text-h3 font-semibold text-text-1">
            Tiers among the farms this feed returns
          </h2>
          <div className="flex flex-wrap gap-2">
            {tierCounts.map(({ tier, count }) => (
              <span
                key={tier}
                data-tier={tier}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-chip px-3 py-1.5 text-caption font-bold',
                  TIER_CLASS[tier] ?? 'bg-tint-grey text-text-2',
                )}
              >
                <span>Tier {tier}</span>
                <span className="tabular-nums">
                  {capped ? 'at least ' : ''}
                  {fmt.num(count)}
                </span>
              </span>
            ))}
          </div>
          <p className="text-caption text-text-3">
            {capped ? (
              <>
                {/* Property (7), stated as the provable thing rather than a hedge. */}
                <b>These are floors, not counts.</b> The feed returns at most{' '}
                {fmt.num(WVFD_FARM_LIMIT)} farms, ordered by WVFD highest first, and a farm&rsquo;s
                tier is derived from the same figure &mdash; so the farms cut off are always the
                lowest-scoring ones. A tier D count read from this list is the number that fitted,
                not the number that exists.
              </>
            ) : (
              <>
                Counted over the {fmt.num(farms.length)}{' '}
                {farms.length === 1 ? 'farm' : 'farms'} this feed returns for the latest week in the
                aggregate. Farms with no row that week are not here and are not in any tier.
              </>
            )}
          </p>
        </section>
      )}

      <DataList<WvfdFarmRow>
        id="wvfd-farms"
        label="Every farm's contribution"
        caption="Each farm returned for the latest week in the aggregate, with its engagement tier, its verified farm-days and where that sits against the goal."
        noun={{ one: 'farm', many: 'farms' }}
        rows={farms}
        rowKey={(f) => f.farmId}
        columns={farmColumns(goal)}
        /* No pagination — the endpoint has no pages, only a LIMIT. */
        pagination={{ mode: 'none' }}
        defaultSort={{ key: 'wvfd', dir: 'desc' }}
        search={{
          mode: 'client',
          commit: 'submit',
          paramKey: 'search',
          placeholder: 'Search by farm id…',
          label: 'Search the farms',
          keys: FARM_SEARCH_KEYS,
          searchesOver:
            'Farm id and tier. This feed carries no farm name, owner, phone, village, crop or plan, so none of them can be searched.',
        }}
        /* The only leading edge on this screen, and it marks exactly one
           thing: a farm that closed under one verified day in seven. */
        rowEdge={(f) => {
          const wvfd = readingIn(f.wvfd, WVFD_MAX);
          return wvfd !== null && wvfd < ATTENTION_BELOW ? 'red' : null;
        }}
        collapsible={{
          defaultOpen: false,
          summary: () => (
            <p>
              {attentionFarms > 0 ? (
                <>
                  <b>
                    {fmt.num(attentionFarms)}{' '}
                    {attentionFarms === 1 ? 'farm closed' : 'farms closed'}
                  </b>{' '}
                  the latest week with no verified day at all. Those are the rows with a red edge.
                </>
              ) : (
                <>
                  <b>No farm in this list</b> closed the latest week without a verified day.
                </>
              )}{' '}
              This list is the latest week only, it carries no farm name, and it is capped at{' '}
              {fmt.num(WVFD_FARM_LIMIT)} rows ordered by WVFD highest first.
            </p>
          ),
        }}
        states={{
          isLoading,
          isFetching,
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: 'No farm has a row in the latest week of the aggregate',
            checkedAt,
            unproven,
          },
        }}
        /* B12 — shaped like the real thing: 4 columns. */
        skeleton={{ rows: 8, cells: 4 }}
      />

      <StandingNote
        title="What this screen cannot tell you"
        why={
          <>
            <p>
              <b>How many farms are missing from the average.</b> A farm only has a row in a week
              it logged something, so the denominator is the farms that logged &mdash; not the
              farms that exist. This answer carries no total, so the share cannot be stated, and
              the figure moves up when a farm goes quiet.
            </p>
            <p className="mt-2">
              <b>Whether the newest week is comparable to the ones before it.</b> Weeks are
              calendar weeks starting on a Monday in India time, and the aggregate is rebuilt once
              a night, so the newest column covers only the days elapsed so far. It is lower than a
              finished week for a reason that has nothing to do with the farms.
            </p>
            <p className="mt-2">
              <b>Whether a confirmed day was confirmed by anyone but the farmer.</b> The check is
              on the confirming person&rsquo;s role, not on whether they are the person who
              recorded the work.
            </p>
            <p className="mt-2">
              <b>Whether a week with no bar was a quiet week.</b> A week with no row in the
              aggregate and a week nobody has computed arrive here looking identical. Those weeks
              are drawn as holes and left out of every figure &mdash; they are not zeros, and they
              are not proof of a zero.
            </p>
            <p className="mt-2">
              <b>Whether an empty answer means anything.</b> When this endpoint&rsquo;s own query
              fails it returns a WVFD of 0 and a goal of 4.5 with a success code, so a database
              problem arrives looking like a real reading. A failure this screen CAN see &mdash; a
              broken request, a timeout, a refused permission &mdash; is always named as one.
            </p>
            <p className="mt-2">
              <b>Anything about one organisation.</b> This endpoint takes only the number of weeks;
              every figure is platform-wide.
            </p>
          </>
        }
      />
    </div>
  );
}
