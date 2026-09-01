import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryCache } from '@tanstack/react-query';
import { DataList } from '@/components/data';
import type { DataListColumn } from '@/components/data';
import { FeedDown, LoadFailed, NotMeasured, NotMeasuredPanel } from '@/components/state';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { KpiCard } from '@/components/ui/KpiCard';
import { metaRefreshedAt, type AdminResponse } from '@/lib/api';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOpsHealth } from '@/hooks/useOpsHealth';
import type { OpsErrorEvent, OpsFarmError, OpsHealthData } from '@/hooks/useOpsHealth';

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

/** BREACH / CLEAR / NOT CHECKED — three states, and the third is not a shade
 *  of the second. `null` is what the endpoint sends when it could not read
 *  the view at all; `undefined` is a rule this endpoint never reads. */
type RuleState = 'breach' | 'clear' | 'unread' | 'not-checked';

const RULE_WORD: Record<RuleState, string> = {
  breach: 'BREACH',
  clear: 'CLEAR',
  unread: 'N/A',
  'not-checked': 'NOT CHECKED',
};

interface RuleRow {
  id: string;
  name: string;
  /** The rule in the words of the SQL that defines it. */
  rule: string;
  state: RuleState;
  meta: string;
}

function ruleStateOf(breached: boolean | null | undefined): RuleState {
  if (breached === true) return 'breach';
  if (breached === false) return 'clear';
  return 'unread';
}

/** The verdict's provenance, in one line under the rule. Property (3): a
 *  matview verdict has no age this endpoint reports, so none is implied. */
const FROM_A_NIGHTLY_VIEW =
  'read from a materialized view rebuilt once a day at 02:00 UTC — this feed does not report when';

function rulesFrom(data: OpsHealthData | undefined): RuleRow[] {
  return [
    {
      id: 'R9',
      name: 'API error spike',
      rule: 'more than 30 API errors in 1 hour',
      state: data ? ruleStateOf(data.apiErrorSpike) : 'unread',
      meta:
        data && data.apiErrorSpike !== null
          ? FROM_A_NIGHTLY_VIEW
          : 'mis.alert_r9_api_error_spike could not be read on this request',
    },
    {
      id: 'R10',
      name: 'Voice degraded',
      rule: 'voice failure rate above 20% in 6 hours',
      state: data ? ruleStateOf(data.voiceDegraded) : 'unread',
      meta:
        data && data.voiceDegraded !== null
          ? FROM_A_NIGHTLY_VIEW
          : 'mis.alert_r10_voice_degraded could not be read on this request',
    },
    {
      /* D8, in one row. Property (5) is why the sentence is about THIS
         endpoint rather than about the platform. */
      id: 'R1–R8',
      name: 'Sync, engagement, correction and referral rules',
      rule: 'eight named rules with eight views of their own',
      state: 'not-checked',
      meta:
        'this endpoint reads two views and these are not among them, so this screen has no state to report for them',
    },
  ];
}

function AlertBadge({ row }: { row: RuleRow }) {
  /* THREE TONES, NOT TWO. The old badge chose between red and green on
     `breached === true`, so `null` — the value the endpoint sends when the
     view is missing — was painted green with a tick beside the word "N/A".
     Unknown is grey here, and grey is not a quieter green. */
  const tone =
    row.state === 'breach'
      ? 'bg-tint-red text-red'
      : row.state === 'clear'
        ? 'bg-tint-green text-green'
        : 'bg-tint-grey text-text-3';

  return (
    <div
      data-rule={row.id}
      data-rule-state={row.state}
      className={cn('flex flex-col gap-1 rounded-panel px-5 py-4 shadow-raised', tone)}
    >
      <div className="flex items-baseline gap-3">
        <p className="min-w-0 flex-1 text-[15px] font-semibold text-text-1">
          {row.id} · {row.name}
        </p>
        <span className="flex-none text-[13px] font-semibold tabular-nums">
          {RULE_WORD[row.state]}
        </span>
      </div>
      <p className="text-[13px] text-text-2">{row.rule}</p>
      <p className="text-[13px] text-text-3">{row.meta}</p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── THE FIGURES */

/** Property (7). Five zeroes are what the `catch` sends, so nothing in the
 *  block is claimed as a reading when they all arrive together. */
function voiceIsUnreadable(d: OpsHealthData): boolean {
  return (
    d.voiceInvocations24h === 0 &&
    d.voiceFailures24h === 0 &&
    d.voiceFailureRatePct === 0 &&
    d.voiceAvgLatencyMs === 0 &&
    d.voiceP95LatencyMs === 0
  );
}

/** A duration of 0ms is the server's `COALESCE`, not a measurement — the same
 *  rule Task 19 applies to `avgLatencyMs` on `/ops/voice`. */
function latencyOf(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/* ─────────────────────────────────────────────────── THE EVENTS TABLE */

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
          'inline-block rounded-chip px-2 py-0.5 text-[13px] font-medium',
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

/**
 * 🛑 PROPERTY (10) — WHAT CAN REACH THIS PANEL, AND WHAT ITS THREE
 * BREAKDOWN COLUMNS CAN SAY. Traced through the backend on 2026-09-01.
 *
 * The query is `WHERE event_type IN ('api.error','client.error') AND
 * occurred_at_utc >= NOW() - INTERVAL '24 hours' AND farm_id IS NOT NULL
 * GROUP BY farm_id HAVING COUNT(*) >= 2 ORDER BY error_count DESC LIMIT 10`
 * (`AdminOpsRepository.cs:128-150`). Three consequences:
 *
 *  A. `farm_id IS NOT NULL` IS A NARROW DOOR. The middleware reads the farm
 *     off a `farm_id` claim (`RequestObservabilityMiddleware.cs:161-162`) and
 *     no token this platform issues carries one — Task 18 verified that on
 *     the issuer, and `/telemetry/client-error` reads the same absent claim
 *     (`Program.cs:684`). A row is attributed only when the mobile client
 *     posts it through `/analytics/ingest`, which lifts `props.farmId` out of
 *     the body (`IngestEventsHandler.cs:114-123`). In `mobile-web` exactly
 *     one `emitClientError` call site supplies that prop: the voice-clip
 *     archive failure (`VoiceClipRetention.ts:376`). So in practice a farm
 *     appears here by failing to archive a voice clip twice in a day, and an
 *     empty panel is not evidence that no farmer is suffering.
 *
 *  B. THE THREE COLUMNS ARE `LIKE` MATCHES ON THE ENDPOINT, NOT A SPLIT.
 *     `FILTER (WHERE props->>'endpoint' LIKE '%sync%')`, `'%log%'`,
 *     `'%voice%'`. An endpoint containing two of those words is counted
 *     twice, an endpoint containing none is in the total and in no column,
 *     and a row with no `endpoint` prop at all — which is every row the one
 *     attributed emitter in (A) produces — scores 0 in all three. They do not
 *     sum to the total and are not meant to be read as parts of it.
 *
 *  C. THE `voice` COLUMN HAS A DEAD BRANCH. Its filter reads
 *     `endpoint LIKE '%voice%' OR event_type = 'ai.invocation' AND
 *     props->>'outcome' = 'failure'`, and `AND` binds tighter than `OR`, so
 *     the second half is `(ai.invocation AND failure)` — a combination the
 *     outer `WHERE event_type IN ('api.error','client.error')` has already
 *     excluded. It can never contribute. Whoever wrote it meant failed AI
 *     calls to count; they do not.
 */
const SUFFERING_COLUMNS: DataListColumn<OpsFarmError>[] = [
  {
    key: 'farm',
    label: 'Farm',
    /* A52 — farm id and NOTHING ELSE. This feed carries no name; the one on
       `/farms/suffering` does. Inventing one here would need a second call
       per row. */
    render: (f) => (
      <span title={f.farmId} className="break-all">
        {f.farmId.slice(0, 8)}…
      </span>
    ),
    sortType: 'text',
    sortValue: (f) => f.farmId,
  },
  {
    key: 'errorCount',
    label: 'Events',
    align: 'right',
    render: (f) => <span className="font-semibold text-red">{fmt.num(f.errorCount)}</span>,
    sortType: 'num',
    sortValue: (f) => f.errorCount,
    defaultDir: 'desc',
  },
  {
    key: 'syncErrors',
    label: 'Sync',
    align: 'right',
    render: (f) => fmt.num(f.syncErrors),
    sortType: 'num',
    sortValue: (f) => f.syncErrors,
    defaultDir: 'desc',
  },
  {
    key: 'logErrors',
    label: 'Logs',
    align: 'right',
    render: (f) => fmt.num(f.logErrors),
    sortType: 'num',
    sortValue: (f) => f.logErrors,
    defaultDir: 'desc',
  },
  {
    key: 'voiceErrors',
    label: 'Voice',
    align: 'right',
    render: (f) => fmt.num(f.voiceErrors),
    sortType: 'num',
    sortValue: (f) => f.voiceErrors,
    defaultDir: 'desc',
  },
  {
    key: 'lastErrorAt',
    label: 'Last event',
    /* A51's other half — minutes, not seconds. This is a summary column over
       a 24-hour window, not a log line. */
    render: (f) => (
      <span className="tabular-nums">
        {fmt.time(f.lastErrorAt, DATE_FORMATS.opsLiveLastErr) ?? <NotMeasured />}
      </span>
    ),
    sortType: 'date',
    sortValue: (f) => f.lastErrorAt,
    defaultDir: 'desc',
  },
];

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
  'ops/voice': 'Voice Pipeline',
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
          'inline-block rounded-chip px-2 py-0.5 text-[13px] font-medium',
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
      <p className="text-[15px] text-text-2">{row.detail}</p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {row.facts.map(([term, value]) => (
          <div key={term}>
            <dt className="text-[13px] text-text-3">{term}</dt>
            <dd className="text-[15px] text-text-1">{value}</dd>
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

  const rules = useMemo(() => rulesFrom(data), [data]);
  const readHere = rules.filter((r) => r.state !== 'not-checked');
  const breached = rules.filter((r) => r.state === 'breach');
  const unread = readHere.filter((r) => r.state === 'unread');

  const events = data?.recentErrors ?? [];
  const farms = data?.topSufferingFarms ?? [];
  /* Property (9). 50 is the server's LIMIT, so a full page is the one case
     where this table is a sample rather than the answer. */
  const eventsCapped = events.length >= 50;

  const unreadable = data ? voiceIsUnreadable(data) : false;
  const invocations = data && !unreadable ? data.voiceInvocations24h : null;
  const failures = data && !unreadable ? data.voiceFailures24h : null;
  /* A rate needs a denominator. With no calls the server sends 0 because of
     its own `COALESCE`, not because nothing failed. */
  const failureRate = data && !unreadable && data.voiceInvocations24h > 0 ? data.voiceFailureRatePct : null;
  const p95 = data && !unreadable ? latencyOf(data.voiceP95LatencyMs) : null;

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
          id: 'voice-counters',
          name: 'analytics.events · AI calls, 24h',
          feeds: 'The four tiles above',
          stateText: unreadable ? 'No reading' : 'Reporting',
          tone: unreadable ? 'grey' : 'green',
          lastHeard: readAt,
          detail: unreadable
            ? 'Every one of the five figures came back as zero. That is also exactly what this query returns when it throws — the catch block substitutes (0, 0, 0, 0, 0) — so the tiles above report no reading rather than a quiet day.'
            : 'Counts every ai.invocation row in the trailing 24 hours. It is not only voice: receipt photos and patti photos are the same kind of call and are counted here too, because the feed records the call and not what it was for.',
          facts: [
            ['Window', 'trailing 24 hours'],
            ['Filter', "event_type = 'ai.invocation'"],
            ['Calls', fmt.num(invocations) ?? 'no reading'],
            ['On failure', 'returns five zeroes with HTTP 200'],
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
          id: 'suffering-24h',
          name: 'analytics.events · attributed errors, 24h',
          feeds: 'The suffering watchlist, below',
          stateText: farms.length > 0 ? 'Reporting' : 'Nothing received',
          tone: farms.length > 0 ? 'green' : 'grey',
          lastHeard: readAt,
          detail:
            'Farms with two or more attributed error events in a day, worst ten first. Attribution needs a farm id on the row, and almost nothing the server emits carries one, so this list is much narrower than its title suggests.',
          facts: [
            ['Window', 'trailing 24 hours'],
            ['Entry', '2 or more events'],
            ['Cap', 'top 10 farms'],
            ['Farms listed', fmt.num(farms.length) ?? '0'],
          ],
        },
        {
          id: 'alert-r9',
          name: 'mis.alert_r9_api_error_spike',
          feeds: 'The R9 badge above',
          stateText: data.apiErrorSpike === null ? 'Not readable' : 'Read',
          tone: data.apiErrorSpike === null ? 'grey' : 'blue',
          lastHeard: null,
          lastHeardWhy:
            'A materialized view holds the answer from its last rebuild. This endpoint reports the state and not the rebuild time, so this screen cannot say how old the verdict is.',
          detail:
            'A materialized view counting api.error rows in one hour, breaching above thirty. Rebuilt once a day at 02:00 UTC by MisRefreshJob, which is the only thing in this repository that refreshes it.',
          facts: [
            ['Rule', 'more than 30 API errors in 1 hour'],
            ['Rebuild', 'daily, 02:00 UTC'],
            ['Verdict', data.apiErrorSpike === null ? 'not readable' : data.apiErrorSpike ? 'BREACH' : 'CLEAR'],
            ['Delivery on breach', 'one line in the API host log'],
          ],
        },
        {
          id: 'alert-r10',
          name: 'mis.alert_r10_voice_degraded',
          feeds: 'The R10 badge above',
          stateText: data.voiceDegraded === null ? 'Not readable' : 'Read',
          tone: data.voiceDegraded === null ? 'grey' : 'blue',
          lastHeard: null,
          lastHeardWhy:
            'A materialized view holds the answer from its last rebuild. This endpoint reports the state and not the rebuild time, so this screen cannot say how old the verdict is.',
          detail:
            'A materialized view over ai.invocation rows in six hours, breaching above a 20% failure rate. Rebuilt once a day at 02:00 UTC. The tiles above cover 24 hours, so their failure rate is not the number this rule reads.',
          facts: [
            ['Rule', 'voice failure rate above 20% in 6 hours'],
            ['Rebuild', 'daily, 02:00 UTC'],
            ['Verdict', data.voiceDegraded === null ? 'not readable' : data.voiceDegraded ? 'BREACH' : 'CLEAR'],
            ['Delivery on breach', 'one line in the API host log'],
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
            'Eight more detector views exist and AlertDispatcherJob reads all ten once a day. This endpoint reads two. That is why the R1–R8 row above says NOT CHECKED rather than CLEAR: this screen has no state for them, and a rule this screen never ran cannot be reported as passing.',
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
          <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.01em] text-text-1">
            <Activity size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Live Health
          </h1>
          <p className="mt-1 text-[15px] text-text-2">
            The two rules this endpoint really reads, the AI pipeline over the last 24 hours, and
            the state of every feed behind them &mdash; platform-wide. This endpoint takes no
            organisation, so nothing here is scoped to one.
          </p>
        </div>
        {/* A chip may only state an age it actually has, and the age it states
            is the SERVER's (A27). With no stamp there is no chip — "Live ·
            now" over a snapshot of unknown age is the D5 defect. */}
        {serverStamp ? (
          <FreshnessChip source="live" lastRefreshed={serverStamp} />
        ) : (
          <span className="text-[13px] text-text-3">no server timestamp</span>
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
          lastGood={`${fmt.num(events.length)} events and ${fmt.num(farms.length)} farms at ${checkedAt}`}
        />
      )}

      {loadFailed && <LoadFailed error={error} onRetry={() => void refetch()} what="Live Health" />}

      {!feedDown && !loadFailed && (
        <>
          {/* ── D8: three states, and eight rules that say so ───────────── */}
          <section className="flex flex-col gap-3" aria-labelledby="ops-live-rules">
            <h2 id="ops-live-rules" className="text-[17px] font-semibold text-text-1">
              Alert rules
            </h2>
            <div data-rules="ops-live" className="grid gap-4 lg:grid-cols-3">
              {rules.map((row) => (
                <AlertBadge key={row.id} row={row} />
              ))}
            </div>

            {/* Plan Step 5, verified in `AlertDispatcherJob.cs` rather than
                carried over from the prototype's copy. */}
            <NotMeasuredPanel
              title="Evaluated, but never delivered"
              why={
                <>
                  A breach writes one line to the API host log and nothing else. The job that reads
                  these views runs once a day at 03:30 UTC, builds an email body and then logs it
                  with the words &ldquo;Would email&rdquo; &mdash; the SMTP wiring is still a TODO.
                  No email, no SMS, no push, no page, and nobody is on call. A breach reaches a
                  person only when somebody opens this page or reads the log, so read the states
                  above as &ldquo;what the rule found&rdquo; and never as &ldquo;somebody was
                  told&rdquo;.
                </>
              }
            />

            <p className="text-[13px] text-text-3">
              {fmt.num(readHere.length)} of the {fmt.num(rules.length)} entries above are rules this
              endpoint reads, and {fmt.num(breached.length)} of those{' '}
              {breached.length === 1 ? 'is' : 'are'} breached.
              {unread.length > 0 && (
                <>
                  {' '}
                  {fmt.num(unread.length)} could not be read on this request at all.
                </>
              )}{' '}
              Both verdicts come from materialized views rebuilt once a day at 02:00 UTC, so a CLEAR
              here describes the window that ended at the last rebuild rather than the last hour.
              The remaining entry stands for eight named rules this endpoint does not read, which is
              why it says NOT CHECKED rather than CLEAR.
            </p>
          </section>

          {/* ── the four tiles ─────────────────────────────────────────── */}
          <section className="flex flex-col gap-3" aria-labelledby="ops-live-voice">
            <h2 id="ops-live-voice" className="text-[17px] font-semibold text-text-1">
              AI pipeline &mdash; last 24 hours
            </h2>
            <div data-kpis="ops-live" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Calls"
                value={fmt.num(invocations)}
                state={invocations === null ? 'unmeasured' : 'ok'}
                tone="blue"
                caption={`read at ${checkedAt}`}
                note="Voice parses, receipt extractions and patti extractions together. The feed records the call, not what it was for."
              />
              <KpiCard
                label="Failed calls"
                value={fmt.num(failures)}
                state={failures === null ? 'unmeasured' : 'ok'}
                tone={failures !== null && failures > 0 ? 'red' : 'blue'}
                caption={`read at ${checkedAt}`}
                note="A failure is a call that did not complete. Nothing here measures whether a call that DID complete understood the farmer."
              />
              <KpiCard
                label="Failure rate"
                value={fmt.pct(failureRate)}
                state={failureRate === null ? 'unmeasured' : 'ok'}
                /* No verdict is painted: R10's line is a different window, so
                   there is nothing on this figure to be right or wrong about. */
                tone="blue"
                caption={
                  invocations !== null && invocations > 0
                    ? `over ${fmt.num(invocations)} calls`
                    : 'no call was measured in this window'
                }
                note="R10 watches a 20% failure rate over 6 hours. This figure covers 24 hours, so it is not the number that rule reads."
              />
              <KpiCard
                label="P95 latency"
                value={fmt.ms(p95)}
                state={p95 === null ? 'unmeasured' : 'ok'}
                tone="blue"
                caption={p95 === null ? 'no duration was recorded' : `read at ${checkedAt}`}
                note="The server sends 0 when it has no latency to send, so a zero is treated as the absence it stands for rather than as an instant reply."
              />
            </div>
            {unreadable && (
              <p className="text-[13px] text-text-3">
                All five figures came back as zero, which is also what this query returns when it
                fails &mdash; its catch block substitutes zeroes and the request still succeeds. The
                tiles report no reading rather than a quiet day.
              </p>
            )}
          </section>

          {/* ── recent events ──────────────────────────────────────────── */}
          <section className="flex flex-col gap-3" aria-labelledby="ops-live-events">
            <h2 id="ops-live-events" className="text-[17px] font-semibold text-text-1">
              Recent events &mdash; last 2 hours
            </h2>
            <p className="text-[13px] text-text-2">
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
              <p className="text-[13px] text-text-3">
                The server returns at most fifty rows and sent fifty, so this is the newest fifty
                and not the whole window. API Errors pages through the wider window.
              </p>
            )}
          </section>

          {/* ── A52 / B10: kept, because it is not the other one ────────── */}
          <section className="flex flex-col gap-3" aria-labelledby="ops-live-suffering">
            <h2 id="ops-live-suffering" className="text-[17px] font-semibold text-text-1">
              Farmer suffering watchlist &mdash; last 24 hours
            </h2>
            <p className="text-[13px] text-text-2">
              Farms with two or more attributed error events in the last 24 hours, worst ten first,
              computed live on this request. This is <b>not</b> the Farmer Suffering screen: that
              one reads a nightly view over seven days, needs three events, counts failed AI calls
              too, and can name the farm. This one carries the farm id and nothing else.
            </p>
            <DataList<OpsFarmError>
              id="ops-live-suffering"
              urlNamespace="suffering"
              label="Farmer suffering watchlist"
              caption="Farms with repeated attributed errors in the last 24 hours, with the endpoint words their errors matched."
              noun={{ one: 'farm', many: 'farms' }}
              rows={farms}
              rowKey={(f) => f.farmId}
              columns={SUFFERING_COLUMNS}
              defaultSort={{ key: 'errorCount', dir: 'desc' }}
              skeleton={{ rows: 4, cells: 6 }}
              states={{
                isLoading,
                isFetching,
                error: null,
                onRetry: () => void refetch(),
                measuredZero: {
                  what: 'No farm reached two attributed errors in the last 24 hours',
                  checkedAt,
                  unproven: (
                    <>
                      A row needs a farm id, and no token this platform issues carries a farm claim
                      &mdash; so every error the server itself records arrives unattributed and can
                      never appear here. In practice only the mobile client&rsquo;s voice-clip
                      archive failure posts an event with a farm id in its body. This query also
                      answers its own failures with an empty list and a success code
                      (<code>AdminOpsRepository.cs:161</code>). An empty panel is therefore not
                      evidence that no farmer is suffering.
                    </>
                  ),
                },
              }}
            />
            <p className="text-[13px] text-text-3">
              Sync, Logs and Voice are <b>LIKE</b> matches on the endpoint text, not a split of the
              total: an endpoint containing two of those words counts twice, one containing none
              counts in the total only, and an event with no endpoint at all &mdash; which is what
              the one attributed emitter produces &mdash; scores zero in all three.
            </p>
          </section>

          {/* ── plan Step 8: additive, and it goes below ────────────────── */}
          <section className="flex flex-col gap-3" aria-labelledby="ops-live-services">
            <h2 id="ops-live-services" className="text-[17px] font-semibold text-text-1">
              Service health
            </h2>
            <p className="text-[13px] text-text-2">
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

          <NotMeasuredPanel
            title="What this screen cannot tell you"
            why={
              <>
                <p>
                  <b>How old the R9 and R10 verdicts are.</b> Both are read from materialized views
                  rebuilt once a day at 02:00 UTC, and this endpoint sends the verdict without the
                  rebuild time. CLEAR means the rule found nothing when the view was last built.
                </p>
                <p className="mt-2">
                  <b>Anything about R1 to R8.</b> Eight more detector views exist and a daily job
                  reads them; this endpoint does not. NOT CHECKED is the state of this screen&rsquo;s
                  knowledge, not a claim that nothing ran.
                </p>
                <p className="mt-2">
                  <b>Whether an empty table means anything.</b> Four separate queries behind this
                  one request answer their own database failures with an empty or zero result and a
                  success code, so a broken query and a quiet window arrive looking the same. A
                  failure this screen CAN see &mdash; a refused permission, a timeout, a broken
                  request &mdash; is always named as one.
                </p>
                <p className="mt-2">
                  <b>Which farm most errors belong to.</b> Attribution needs a farm id on the event
                  row and almost nothing the server emits carries one, so the watchlist above sees a
                  narrow slice of what farmers actually hit.
                </p>
                <p className="mt-2">
                  <b>Anything about one organisation.</b> This endpoint takes no parameters at all;
                  every figure is platform-wide. The organisation in the address bar scopes the
                  cache, not the data.
                </p>
              </>
            }
          />
        </>
      )}
    </div>
  );
}
