import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryCache } from '@tanstack/react-query';
import { DataList } from '@/components/data';
import type { DataListColumn } from '@/components/data';
import {
  FeedDown,
  LoadFailed,
  NotMeasured,
  MetricLines,
  NotBuiltYet,
  StandingNote,
} from '@/components/state';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { metaRefreshedAt, type AdminResponse } from '@/lib/api';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOpsHealth } from '@/hooks/useOpsHealth';
import type { OpsErrorEvent } from '@/hooks/useOpsHealth';

/**
 * LIVE HEALTH — the screen where the console stops contradicting itself.
 *
 * ── THE BUG HIDING INSIDE THE REDESIGN (D8) ──────────────────────────────
 * `HomePage.tsx:34` says "all R1–R10 clear". This page has only ever
 * evaluated TWO of those ten (the old lines 32-42), so eight of them were
 * being reported as clear by a screen that never looked at them — and the
 * two it did look at were painted GREEN when the answer was `null`, because
 * the old badge's colour was two-state (`breached === true ? red : green`)
 * while only its WORD was three-state. An unread rule and a passing rule
 * rendered identically. R1–R8 now read NOT CHECKED, in grey, and unknown is
 * its own state everywhere.
 *
 * ── 🛑 WHAT `/shramsafal/admin/ops/health` ACTUALLY IS. Read in the backend
 *    on 2026-09-01, not taken from the plan ─────────────────────────────
 * One endpoint (`AdminEndpoints.cs:93-106`) over one handler that is a pure
 * pass-through (`GetOpsHealthHandler.cs:20`) over FOUR independent SQL
 * queries (`AdminOpsRepository.cs:19-47`). Ten properties follow, and most of
 * this file is one of them:
 *
 *  (1) 🛑 IT IS THE ONE ENDPOINT WITH NO ENVELOPE (A27). Every other admin
 *      call returns `AdminResponse<T>` with `meta.source`, `meta.window` and
 *      `meta.lastRefreshedUtc`. This one returns the DTO bare, so there is no
 *      `meta` to read and `metaRefreshedAt` is not used on this screen — it
 *      is imported only by the nightly-feed scan at the foot of this file,
 *      which reads OTHER screens' envelopes out of the query cache. A port
 *      that assumed a uniform envelope would render `data.data` (undefined)
 *      and an age from a `meta` that was never sent.
 *
 *  (2) 🛑 THE SERVER STAMPS THE SNAPSHOT AND THE OLD PAGE THREW IT AWAY.
 *      `ComputedAtUtc: DateTime.UtcNow` is set as the DTO is assembled
 *      (`AdminOpsRepository.cs:42`). The old page fetched it
 *      (`useOpsHealth.ts:31`) and then fed the chip `dataUpdatedAt` — the
 *      moment THIS BROWSER received a response (the old line 10). Those are
 *      not the same instant, and the gap is not theoretical: the endpoint
 *      carries `.CacheOutput("AdminLive")`, a 30-second server-side output
 *      cache (`Program.cs:131`), so a response can be handed over a snapshot
 *      computed up to 30 seconds before it. The browser's clock always says
 *      "1s ago". The chip now states the server's age, and when the server
 *      sends no stamp there is no chip at all rather than a "Live · now"
 *      that means "we just asked".
 *
 *  (3) 🛑 R9 AND R10 ARE NOT LIVE. They are read `SELECT breached FROM
 *      mis.alert_r9_api_error_spike` / `..._r10_voice_degraded`
 *      (`AdminOpsRepository.cs:163-186`), and both are MATERIALIZED VIEWS
 *      (`20260502000000_AnalyticsRewrite.cs:424-456`). A matview holds the
 *      answer from the last time it was rebuilt, and the only thing in this
 *      repository that rebuilds them is `MisRefreshJob` — once a day, at
 *      02:00 UTC (`MisRefreshJob.cs:124-129`, views listed at `:72-73`).
 *      So a CLEAR badge means "the rule found nothing when the view was last
 *      built", which is up to a day ago, over a window that ended then. The
 *      endpoint does not report when that was, so this screen cannot state
 *      the age of either verdict and says so instead of implying "now".
 *
 *  (4) THE TWO RULES, IN THE WORDS OF THE SQL THAT DEFINES THEM.
 *      R9  `COUNT(*) > 30` over `event_type = 'api.error'` in `1 hour`.
 *      R10 `failures * 100.0 / NULLIF(COUNT(*),0) > 20` over
 *          `event_type = 'ai.invocation'` in `6 hours`.
 *      R10 is stated here in the same words Task 19 states it in on
 *      `/ops/voice` — one rule, one number, two screens. There is no 90%
 *      target anywhere in this platform; Task 19 deleted that fabricated
 *      line and nothing here reintroduces it.
 *
 *  (5) 🛑 R1–R8 ARE NOT "UNEVALUATED" — THEY ARE NOT READ *HERE*. The v3
 *      prototype's note says nothing evaluates them. In this repository eight
 *      more views exist (`mis.alert_r1_smooth_decay` … `_r8_referral_quality`)
 *      and `AlertDispatcherJob` reads all ten of them once a day
 *      (`AlertDispatcherJob.cs:33-45`). What is true is narrower and is what
 *      the row says: THIS endpoint reads two, so this screen has no state to
 *      report for the other eight, and NOT CHECKED is the only honest word
 *      for that. A rule nobody ran cannot be green — and neither can a rule
 *      somebody ran somewhere this screen cannot see.
 *
 *  (6) 🛑 EVALUATED, BUT NEVER DELIVERED. Verified, because it is the kind of
 *      claim that must not be repeated on trust: `AlertDispatcherJob` runs
 *      once a day at 03:30 UTC (`:66`), collects the breached detectors, and
 *      ends in `SendFounderAlertAsync`, which builds an email body and then
 *      `_logger.LogWarning("… Would email {FounderEmail} …")` above
 *      `// TODO Phase 7 upgrade: wire SMTP/SendGrid here` and
 *      `await Task.CompletedTask` (`:136-162`). No email, no SMS, no push, no
 *      page. A breach reaches a person only when somebody opens this page or
 *      reads the host log.
 *
 *  (7) 🛑 AN ALL-ZERO VOICE BLOCK IS WHAT A FAILED QUERY LOOKS LIKE.
 *      `GetVoiceHealthAsync` ends `catch { } return (0, 0, 0m, 0m, 0m);`
 *      (`AdminOpsRepository.cs:81-82`), and its SQL wraps the rate and both
 *      latencies in `COALESCE(..., 0)`. So five zeroes arrive identically
 *      from a quiet night and from an unreachable analytics database. The
 *      tiles report that as no reading, in words — D18 catalogued the CLIENT
 *      half of this (`?? 0`, `?? 0%`, `?? 0ms` at the old lines 49/55/62/69);
 *      this is the server-side twin, which survives every client-side fix.
 *      A rate over zero calls and a latency of 0ms are not readings either.
 *
 *  (8) 🔴 FOUR MORE SWALLOW SITES, ALL INSIDE THIS ONE ENDPOINT.
 *      `AdminOpsRepository.cs:81` (voice), `:120` (recent errors), `:161`
 *      (suffering) and the two at `:172`/`:181` (the alert views) each answer
 *      a database failure with an empty or zero result and HTTP 200 — beside
 *      the five already catalogued at `AdminMisRepository.cs:219/:245/:287`
 *      and `AdminOpsRepository.cs:253/:293`. Both lists on this screen
 *      therefore supply `states.measuredZero.unproven`: an empty answer here
 *      cannot be claimed as a measured zero.
 *
 *  (9) 🛑 THE RECENT-EVENTS LIST IS NOT ONLY ERRORS, AND IT IS CAPPED AT 50.
 *      `event_type IN ('api.error','api.slow','client.error')` … `LIMIT 50`
 *      (`AdminOpsRepository.cs:104-107`). `api.slow` is a write that
 *      SUCCEEDED and took over two seconds, so a 200 in this table is a
 *      warning and not a failure — the old page coloured it beside a 500 and
 *      called the panel Error Events. The cap is stated when it is reached,
 *      because fifty rows in a two-hour window is the one case where the
 *      table is not the answer.
 *
 * (10) 🛑 THE SUFFERING PANEL CAN ONLY EVER SEE ONE KIND OF ROW (A52). See
 *      the block above its config below — it is the longest finding on this
 *      screen and it belongs beside the table it is about.
 *
 * ── WHY THE SUFFERING PANEL SURVIVES A REDESIGN THAT REPLACES IT (A52, B10)
 * v3's `live-health.html` puts a service-health table in this slot, and a
 * design-led port would call the panel a duplicate of `/farms/suffering` and
 * merge them. It is not a duplicate. Measured against Task 16's screen:
 *
 *                     /ops/live (here)              /farms/suffering
 *   source            live SQL, this request        `mis.farmer_suffering_watchlist`,
 *                                                   a matview rebuilt nightly
 *   window            24 hours                      7 days
 *   entry             2 or more events              3 or more events
 *   counts            api.error, client.error       those two PLUS failed
 *                                                   `ai.invocation` calls
 *   shape             farm id only                  farm id AND farm name
 *   size              top 10                        the whole list
 *
 * Two different questions. Keeping both is the decision (plan Step 7); the
 * service-health table is ADDITIVE and sits below.
 *
 * ── THREE LISTS ON ONE SCREEN — THE COLLISION TASK 8 PREDICTED ───────────
 * `DataList.tsx`'s header recorded, in Task 8, that this screen would need
 * namespaced URL params. It does: without `urlNamespace`, one header click
 * would write `?sort` and reorder all three tables at once. The fix landed in
 * `useListUrlState` (`ns`), not in a second list component.
 */

/* ─────────────────────────────────────────────────────────── THE RULES */


/* ────────────────────────────────────────────────────────── THE FIGURES */


/* ─────────────────────────────────────────────────── THE EVENTS TABLE */

/** A duration of 0ms is the server's `COALESCE`, not a measurement. */
function latencyOf(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

const EVENT_TONE: Record<string, string> = {
  'api.error': 'bg-tint-red text-red',
  'api.slow': 'bg-tint-amber text-amber',
  'client.error': 'bg-tint-blue text-blue',
};

/** Property (9). What each type MEANS, on the row, because "api.slow" beside
 *  a 200 reads as a failure to anyone who has not read the middleware. */
const EVENT_MEANING: Record<string, string> = {
  'api.error': 'a 5xx, or a 4xx on a write the farmer cannot work around',
  'api.slow': 'a write that SUCCEEDED and took over two seconds — a warning, not a failure',
  'client.error': "the farmer's own device reporting a script error or a failed fetch",
};

const UNATTRIBUTED =
  'No token this platform issues carries a farm claim, so a server-side error row has no farm to name. Only an event the mobile client posts with a farmId in its body can be attributed.';

const EVENT_COLUMNS: DataListColumn<OpsErrorEvent>[] = [
  {
    key: 'time',
    label: 'Time',
    /* A51 — seconds, because the whole window is two hours. `/ops/errors`
       shows the full date on purpose; they differ and both are right. */
    render: (e) => (
      <span className="tabular-nums">
        {fmt.time(e.occurredAtUtc, DATE_FORMATS.opsLiveRow) ?? <NotMeasured />}
      </span>
    ),
    sortType: 'date',
    sortValue: (e) => e.occurredAtUtc,
    defaultDir: 'desc',
    width: '11ch',
  },
  {
    key: 'type',
    label: 'Type',
    render: (e) => (
      <span
        title={EVENT_MEANING[e.eventType]}
        className={cn(
          'inline-block rounded-chip px-2 py-0.5 text-caption font-medium',
          EVENT_TONE[e.eventType] ?? 'bg-tint-grey text-text-2',
        )}
      >
        {e.eventType}
      </span>
    ),
    sortType: 'text',
    sortValue: (e) => e.eventType,
  },
  {
    key: 'endpoint',
    label: 'Endpoint',
    render: (e) => <span className="break-all">{e.endpoint}</span>,
    sortType: 'text',
    sortValue: (e) => e.endpoint,
  },
  {
    key: 'status',
    label: 'Status',
    align: 'right',
    /* `client.error` rows carry no status code at all — the column is a real
       absence on them, not a zero. */
    render: (e) => fmt.num(e.statusCode) ?? <NotMeasured why="This event type carries no HTTP status." />,
    sortType: 'num',
    sortValue: (e) => e.statusCode,
    state: (e) => (e.statusCode === null ? 'unmeasured' : null),
  },
  {
    key: 'latency',
    label: 'Latency',
    align: 'right',
    render: (e) => fmt.ms(latencyOf(e.latencyMs)) ?? <NotMeasured why="No duration was recorded for this event." />,
    sortType: 'num',
    sortValue: (e) => latencyOf(e.latencyMs),
    state: (e) => (latencyOf(e.latencyMs) === null ? 'unmeasured' : null),
  },
  {
    key: 'farm',
    label: 'Farm',
    render: (e) =>
      e.farmId ? (
        <span title={e.farmId} className="break-all">
          {e.farmId.slice(0, 8)}…
        </span>
      ) : (
        <NotMeasured state="unattributed" why={UNATTRIBUTED} />
      ),
    sortType: 'text',
    sortValue: (e) => e.farmId,
    state: (e) => (e.farmId ? null : 'unattributed'),
  },
];

/* ──────────────────────────────────────────────── THE SUFFERING TABLE */


/* ────────────────────────────────────── THE NIGHTLY FEEDS, DERIVED */

/**
 * WHAT THE OVERNIGHT JOB FEEDS IS SCANNED, NEVER TYPED (plan Step 8).
 *
 * v3 reads it off its freshness map — "every page whose source is 'nightly'"
 * — with the reason stated in `live-health.html`: a list typed into the page
 * "would quietly drift out of date". This console has no freshness map; what
 * it has is the same metadata arriving per screen, as `meta.source` on the
 * AdminResponse envelope. So the scan runs over the QUERY CACHE: every admin
 * answer this session is holding whose server said `materialized`.
 *
 * That scope is narrower than v3's and is stated on screen rather than
 * glossed: it names the screens this session has actually loaded, and when it
 * has loaded none it says so instead of printing a list it cannot support.
 * The alternative — hard-coding eleven screen names here — is a claim that
 * rots silently the first time an endpoint changes its source.
 */
const SCREEN_LABELS: Record<string, string> = {
  'farms/list': 'All Farms',
  'farms/silent-churn': 'Silent Churn',
  'farms/suffering': 'Farmer Suffering',
  'users/list': 'Users',
  'ops/errors': 'API Errors',
  'ops/health': 'Live Health',
  'metrics/wvfd': 'North Star WVFD',
  'farmer-health/cohort': 'Farmer Health',
  'farmer-health/drilldown': 'Farmer Health drilldown',
  'schedules/templates': 'Schedule Templates',
};

interface NightlyFeeds {
  /** Screen labels, de-duplicated and ordered as the map declares them. */
  labels: string[];
  /** The newest `lastRefreshedUtc` any nightly answer carried — a real "last
   *  heard" for the overnight job, or undefined when none was seen. */
  lastRefreshed?: string;
}

function scanNightly(cache: QueryCache): NightlyFeeds {
  const seen = new Set<string>();
  let newest: string | undefined;

  for (const query of cache.getAll()) {
    const key = query.queryKey;
    if (!Array.isArray(key) || typeof key[0] !== 'string' || typeof key[1] !== 'string') continue;

    const envelope = query.state.data as AdminResponse<unknown> | undefined;
    if (envelope?.meta?.source !== 'materialized') continue;

    seen.add(`${key[0]}/${key[1]}`);
    const stamp = metaRefreshedAt(envelope.meta);
    if (stamp && (!newest || stamp > newest)) newest = stamp;
  }

  const labels = Object.keys(SCREEN_LABELS)
    .filter((id) => seen.has(id))
    .map((id) => SCREEN_LABELS[id]);
  return { labels, lastRefreshed: newest };
}

/** Read through a SUBSCRIPTION rather than during render: the cache is
 *  external mutable state, and a component that reads it while rendering is
 *  the impurity `react-hooks/purity` flags on `HomePage.tsx:19`. */
function useNightlyFeeds(): NightlyFeeds {
  const queryClient = useQueryClient();
  const [feeds, setFeeds] = useState<NightlyFeeds>({ labels: [] });

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const sync = () => {
      const next = scanNightly(cache);
      setFeeds((prev) =>
        prev.labels.join('|') === next.labels.join('|') && prev.lastRefreshed === next.lastRefreshed
          ? prev
          : next,
      );
    };
    sync();
    return cache.subscribe(sync);
  }, [queryClient]);

  return feeds;
}

/* ────────────────────────────────────────────── THE SERVICE-HEALTH TABLE */

type ServiceTone = 'green' | 'red' | 'amber' | 'grey' | 'blue';

interface ServiceRow {
  id: string;
  name: string;
  /** What it feeds, in words. Derived per row from this payload — never a
   *  hand-kept inventory of the console. */
  feeds: string;
  stateText: string;
  tone: ServiceTone;
  /** Formatted, or null when this screen has no way to know. */
  lastHeard: string | null;
  lastHeardWhy?: string;
  detail: string;
  facts: [string, string][];
}

const SERVICE_TONE: Record<ServiceTone, string> = {
  green: 'bg-tint-green text-green',
  red: 'bg-tint-red text-red',
  amber: 'bg-tint-amber text-amber',
  blue: 'bg-tint-blue text-blue',
  grey: 'bg-tint-grey text-text-3',
};

const SERVICE_COLUMNS: DataListColumn<ServiceRow>[] = [
  {
    key: 'name',
    label: 'Feed',
    render: (s) => <span className="font-medium">{s.name}</span>,
    sortType: 'text',
    sortValue: (s) => s.name,
  },
  {
    key: 'feeds',
    label: 'What it feeds',
    render: (s) => <span className="text-text-2">{s.feeds}</span>,
    sortType: 'text',
    sortValue: (s) => s.feeds,
  },
  {
    key: 'state',
    label: 'State',
    render: (s) => (
      <span
        className={cn(
          'inline-block rounded-chip px-2 py-0.5 text-caption font-medium',
          SERVICE_TONE[s.tone],
        )}
      >
        {s.stateText}
      </span>
    ),
    sortType: 'text',
    sortValue: (s) => s.stateText,
  },
  {
    key: 'lastHeard',
    label: 'Last heard',
    render: (s) =>
      s.lastHeard ?? <NotMeasured why={s.lastHeardWhy ?? 'This feed reports no timestamp.'} />,
    sortType: 'text',
    sortValue: (s) => s.lastHeard,
    state: (s) => (s.lastHeard ? null : 'unmeasured'),
  },
];

function serviceDetail(row: ServiceRow) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-text-2">{row.detail}</p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {row.facts.map(([term, value]) => (
          <div key={term}>
            <dt className="text-caption text-text-3">{term}</dt>
            <dd className="text-body text-text-1">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── THE SCREEN */

export default function OpsLivePage() {
  const { data, isLoading, isFetching, isLoadingError, isRefetchError, error, refetch } =
    useOpsHealth();
  const nightly = useNightlyFeeds();

  /* A27, THE SECOND HALF. The server's own stamp, and nothing derived from
     this browser's clock. `dataUpdatedAt` — what the old page used — is the
     moment WE received a response, which is not the moment the snapshot was
     computed and is never older than a few milliseconds. */
  const serverStamp = data?.computedAtUtc;
  const readAt = fmt.dateTime(serverStamp, DATE_FORMATS.usersLastLogin);
  const checkedAt = readAt ?? 'a time the server did not report';


  const events = data?.recentErrors ?? [];
  /* Property (9). 50 is the server's LIMIT, so a full page is the one case
     where this table is a sample rather than the answer. */
  const eventsCapped = events.length >= 50;


  const services: ServiceRow[] = data
    ? [
        {
          id: 'ops-health',
          name: 'AgriSync API · /admin/ops/health',
          feeds: 'Every figure on this screen',
          stateText: 'Answering',
          tone: 'green',
          lastHeard: readAt,
          lastHeardWhy: 'The response carried no computedAtUtc.',
          detail:
            'One request assembles four independent queries against analytics.events plus two reads of the alert views. It answered this request. The endpoint sits behind a 30-second server-side output cache, so the snapshot can be up to half a minute older than the response that carried it — which is why the chip above states the server’s stamp rather than the moment this browser was answered.',
          facts: [
            ['Poll', 'every 30 seconds'],
            ['Server cache', '30 seconds (Program.cs:131)'],
            ['Envelope', 'none — the only admin endpoint without one (A27)'],
            ['Snapshot computed', checkedAt],
          ],
        },
        {
          id: 'events-2h',
          name: 'analytics.events · errors and slow calls, 2h',
          feeds: 'Recent events, below',
          stateText: events.length > 0 ? 'Reporting' : 'Nothing received',
          tone: events.length > 0 ? 'green' : 'grey',
          lastHeard: readAt,
          detail:
            'Three event types, newest first, capped at fifty rows: api.error, api.slow and client.error. A failure inside this query is answered with an empty list and a success code, so an empty table cannot be read as a quiet two hours.',
          facts: [
            ['Window', 'trailing 2 hours'],
            ['Cap', '50 rows'],
            ['Rows', fmt.num(events.length) ?? '0'],
            ['Not included', "sync.mutation_rejected — a 200 that refused a farmer's work"],
          ],
        },
        {
          id: 'alert-r1-r8',
          name: 'mis.alert_r1 … r8 (eight views)',
          feeds: 'The daily alert job only — nothing in this console',
          stateText: 'Not read here',
          tone: 'grey',
          lastHeard: null,
          lastHeardWhy: 'This console never reads these views, so it has never heard from them.',
          detail:
            'Eight more detector views exist and AlertDispatcherJob reads all ten once a day. This endpoint reads two. That is why this screen says NOT CHECKED rather than CLEAR for them: it has no state for them, and a rule this screen never ran cannot be reported as passing.',
          facts: [
            ['Views', 'r1 smooth decay … r8 referral quality'],
            ['Read by', 'AlertDispatcherJob, daily at 03:30 UTC'],
            ['Read here', 'no'],
            ['Delivery on breach', 'one line in the API host log'],
          ],
        },
        {
          id: 'nightly',
          name: 'Nightly metrics rebuild',
          feeds:
            nightly.labels.length > 0
              ? nightly.labels.join(', ')
              : 'no nightly screen has been loaded in this session',
          stateText: nightly.labels.length > 0 ? 'Observed' : 'Not observed',
          tone: nightly.labels.length > 0 ? 'blue' : 'grey',
          lastHeard: fmt.dateTime(nightly.lastRefreshed, DATE_FORMATS.usersLastLogin),
          lastHeardWhy:
            'No screen fed by the overnight job has answered in this session, so nothing has reported its last run.',
          detail:
            'MisRefreshJob rebuilds every materialized view once a day at 02:00 UTC. This row is derived, not typed: it lists the screens whose own freshness metadata said "materialized" in this browsing session, and the newest run time any of them reported. A screen not yet opened is absent from the list rather than assumed.',
          facts: [
            ['Rebuild', 'daily, 02:00 UTC'],
            ['Scope of this row', 'screens loaded in this session'],
            ['Screens observed', fmt.num(nightly.labels.length) ?? '0'],
            ['Newest run reported', fmt.dateTime(nightly.lastRefreshed, DATE_FORMATS.usersLastLogin) ?? 'none'],
          ],
        },
      ]
    : [];

  /* ── the two failure shapes, and they are not the same shape ──────────
     A poll that starts failing while an answer is in hand is a feed that
     STOPPED: React Query keeps the last successful data, so the numbers are
     still there and every one of them is history. That is FeedDown (D7) —
     it names when the feed stopped and refuses to show the last good figure
     as current, which is why nothing below it is drawn.

     A first load that fails has no numbers at all, and calling that a dead
     feed would name a stop time this screen never observed. That is
     LoadFailed, with a retry.

     Both replace "Backend unreachable. Start the .NET API on port 5001." —
     a dev-machine instruction that was rendered to whoever opened
     admin.shramsafal.in.

     The two flags are React Query's own: `isRefetchError` is "errored WITH
     data in hand", `isLoadingError` is "errored with none". Re-deriving them
     from `isError && !!data` would say the same thing today and drift the
     first time the library changes what it keeps. */
  const feedDown = isRefetchError;
  const loadFailed = isLoadingError;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <Activity size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Live Health
          </h1>
          <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
            What the server reported in the last two hours, and whether each of the sources behind it
            answered. This covers the whole platform: the server is never asked about one
            organisation here, so switching organisation in the top bar changes nothing on this
            screen.
          </p>
        </div>
        {/* A chip may only state an age it actually has, and the age it states
            is the SERVER's (A27). With no stamp there is no chip — "Live ·
            now" over a snapshot of unknown age is the D5 defect. */}
        {serverStamp ? (
          <FreshnessChip source="live" lastRefreshed={serverStamp} />
        ) : (
          <span className="text-caption text-text-3">no server timestamp</span>
        )}
      </div>

      {feedDown && (
        <FeedDown
          since={checkedAt}
          what="This feed"
          historyLabel="the state right now"
          /* Rendered ONLY inside the sentence that disowns it — the FeedDown
             contract, asserted in this screen's test: the figure appears in
             that span and nowhere else on the page. */
          lastGood={`${fmt.num(events.length)} events at ${checkedAt}`}
        />
      )}

      {loadFailed && <LoadFailed error={error} onRetry={() => void refetch()} what="Live Health" />}

      {!feedDown && !loadFailed && (
        <>
          {/* L1: an idea (B24). The old badges read a view rebuilt once a day; no verdict is drawn. */}
          <NotBuiltYet metric="live-alert-rules" />

          {/* L2 to L5 (the four AI pipeline tiles) are doubles of Company MIS Quality and are gone (B24). */}

          {/* ── recent events ──────────────────────────────────────────── */}
          <section className="flex flex-col gap-3" aria-labelledby="ops-live-events">
            <h2 id="ops-live-events" className="text-h2 font-bold text-text-1">
              Recent events &mdash; last 2 hours
            </h2>
            <MetricLines metric="live-recent-events" />
            <p className="text-caption text-text-2">
              Not all of these are failures. <b>api.slow</b> is a write that succeeded and took over
              two seconds, and <b>client.error</b> is the farmer&rsquo;s own device reporting a
              problem. A 200 in this table is a warning, not a failure.
            </p>
            <DataList<OpsErrorEvent>
              id="ops-live-events"
              /* THE COLLISION, HANDLED. Three lists, three namespaces —
                 without them one header click reorders all three. */
              urlNamespace="events"
              label="Recent events"
              caption="Every error, slow write and client-reported problem in the last two hours, newest first."
              noun={{ one: 'event', many: 'events' }}
              rows={events}
              rowKey={(e) => `${e.occurredAtUtc}-${e.eventType}-${e.endpoint}`}
              columns={EVENT_COLUMNS}
              defaultSort={{ key: 'time', dir: 'desc' }}
              skeleton={{ rows: 5, cells: 6 }}
              states={{
                isLoading,
                isFetching,
                error: null,
                onRetry: () => void refetch(),
                measuredZero: {
                  what: 'No error, slow call or client report in the last 2 hours',
                  checkedAt,
                  unproven: (
                    <>
                      This query answers its own database failures with an empty list and a success
                      code (<code>catch {'{'} returns empty {'}'}</code>,{' '}
                      <code>AdminOpsRepository.cs:120</code>), so a broken query and a genuinely
                      quiet two hours arrive here looking the same. Nothing was received at{' '}
                      {checkedAt}, and that is all this screen can honestly say.
                    </>
                  ),
                },
              }}
            />
            {eventsCapped && (
              <p className="text-caption text-text-3">
                The server returns at most fifty rows and sent fifty, so this is the newest fifty
                and not the whole window. API Errors pages through the wider window.
              </p>
            )}
          </section>

          {/* L7: an idea (B24). Not built yet, no number, no list. */}
          <NotBuiltYet metric="live-suffering-24h" />

          {/* ── plan Step 8: additive, and it goes below ────────────────── */}
          <section className="flex flex-col gap-3" aria-labelledby="ops-live-services">
            <h2 id="ops-live-services" className="text-h2 font-bold text-text-1">
              Service health
            </h2>
            <MetricLines metric="live-service-health" />
            <p className="text-caption text-text-2">
              These feeds do not share a clock, so this section carries no single freshness chip.
              Each row states when that feed was last heard, and two of them have no timestamp this
              screen can read at all. Open a row for what it is and what it cannot say.
            </p>
            <DataList<ServiceRow>
              id="ops-live-services"
              urlNamespace="services"
              label="Feeds this console depends on"
              caption="Every feed behind this screen, what it feeds, the state it is in and when it was last heard."
              noun={{ one: 'feed', many: 'feeds' }}
              rows={services}
              rowKey={(s) => s.id}
              columns={SERVICE_COLUMNS}
              expand={serviceDetail}
              rowEdge={(s) => (s.tone === 'red' ? 'red' : s.tone === 'grey' ? 'grey' : null)}
              defaultSort={{ key: 'name', dir: 'asc' }}
              skeleton={{ rows: 8, cells: 4 }}
              states={{
                isLoading,
                isFetching,
                error: null,
                onRetry: () => void refetch(),
                measuredZero: {
                  what: 'No feed could be described',
                  checkedAt,
                  unproven: (
                    <>
                      This table is derived from the answer above. With no answer there is nothing
                      to describe &mdash; which is a fact about this request, not about the feeds.
                    </>
                  ),
                },
              }}
            />
          </section>

          <StandingNote
            title="What this screen cannot tell you"
            summary="Whether an empty table means anything, and which farm most errors belong to."
            why={
              <>
                <p>
                  <b>Whether an empty table means anything.</b> The lookup behind the recent events
                  answers its own database failure with an empty result and calls it a success. So a
                  broken lookup and a genuinely quiet two hours arrive looking identical. Failures
                  this screen <b>can</b> see &mdash; a refused permission, a timeout, a request that
                  broke &mdash; are always named as failures.
                </p>
                <p>
                  <b>Which farm most errors belong to.</b> Tying an error to a farm needs the
                  farm&rsquo;s identifier on the error record, and almost nothing the server writes
                  carries one.
                </p>
                <p>
                  <b>Anything about one organisation.</b> The server is asked nothing at all here,
                  so every figure covers the whole platform. Switching organisation in the top bar
                  changes nothing on this screen.
                </p>
              </>
            }
          />
        </>
      )}
    </div>
  );
}
