import { Mic } from 'lucide-react';
import { metaRefreshedAt } from '@/lib/api';
import { ChartShell, Sparkline, fillAxis, measuredSlots } from '@/components/data';
import type { AxisPoint, ChartDataTable } from '@/components/data';
import { NotMeasured, NotMeasuredPanel } from '@/components/state';
import { Button } from '@/components/ui/Button';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { KpiCard } from '@/components/ui/KpiCard';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { useListUrlState } from '@/lib/useListUrlState';
import { useOpsVoice } from '@/hooks/useOpsVoice';
import type { OpsVoiceDay } from '@/hooks/useOpsVoice';

/**
 * VOICE PIPELINE — the first screen drawn inside `ChartShell` (T9).
 *
 * ── WHAT `/shramsafal/admin/ops/voice` ACTUALLY RETURNS ──────────────────
 * Read in the backend on 2026-09-01, not taken from the plan. One row per
 * UTC date, five fields and no more (`OpsVoiceTrendDto.cs`):
 * `date`, `invocations`, `failures`, `successRatePct`, `avgLatencyMs`.
 * The whole query is one GROUP BY over `analytics.events`
 * (`AdminOpsRepository.cs:257-295`). Seven properties follow from it, and
 * five of them contradict something this screen used to say.
 *
 *  (1) 🛑 IT IS NOT ONLY VOICE. The filter is `event_type = 'ai.invocation'`
 *      and NOTHING else — no `operation` filter. Three handlers emit that
 *      event: `ParseVoiceInputHandler` (`operation: 'voice.parse'`),
 *      `ExtractReceiptHandler` (`'receipt.extract'`) and
 *      `ExtractPattiImageHandler` (`'patti.extract'`). So every receipt photo
 *      and every patti photo a farmer sends is counted on a screen titled
 *      Voice Pipeline, and inside a figure the old page called "Voice Success
 *      Rate". Said on screen rather than fixed here: filtering is one WHERE
 *      clause in the repository, and this plan changes no backend.
 *
 *  (2) 🛑 THE PROVIDER BREAKDOWN IS NOT BUILDABLE FROM THIS FEED. v3's
 *      "By provider" table is three rows summing to the daily totals; this
 *      endpoint carries no provider column and the DTO has no field for one.
 *      What makes it worth stating rather than dropping quietly: every
 *      `ai.invocation` event DOES carry `providerUsed` in its props (all
 *      three emitters write it), so the breakdown is one `GROUP BY
 *      props->>'providerUsed'` away in the same rows — and, because it would
 *      partition the very events these totals count, it would sum to them
 *      exactly. It is absent from the WIRE, not from the database.
 *      (`/shramsafal/admin/ai-health` does report per-provider health, but
 *      from `ssf.ai_job_attempts` over a fixed 24h window — one row per
 *      ATTEMPT including retries and fallbacks, which is a different
 *      population from one event per call. Joining the two would produce a
 *      "breakdown" that does not add up to the thing it breaks down. Raised
 *      as a founder decision instead of half-built.)
 *
 *  (3) 🛑 A ZERO LATENCY IS THE SERVER'S SUBSTITUTION, NOT A READING.
 *      `COALESCE(ROUND(AVG((props->>'latencyMs')::numeric)), 0)` — when no
 *      call that day recorded a duration the average is NULL and the server
 *      sends `0`. An average of 0ms over a completed round trip to a hosted
 *      model is not a possible reading, so it is turned back into the absence
 *      it stands for. Same move as Silent Churn's `'—'` phone and Suffering's
 *      `COALESCE(f.name, farm_id)`: a sentinel is not data. D18 catalogued
 *      the CLIENT half of this defect (`avgLatency = 0`, `?? 0ms`); this is
 *      its server-side twin, and it survives every client-side fix.
 *
 *  (4) 🛑 A DATE WITH NO ROW IS NOT A ZERO — AND IT IS NOT PROVABLY A GAP
 *      EITHER. `GROUP BY day` emits nothing at all for a date with no events,
 *      so "nobody spoke to the app that day" and "nothing was recorded that
 *      day" arrive identically: as an absent row. The axis is therefore
 *      fixed, the absence is drawn as a full-height hatch, and the reason is
 *      stated in words as the ambiguity it is. Drawing it at zero would pick
 *      one of the two readings and print it as fact.
 *
 *  (5) 🛑 NO RULE NAMES A DAILY SUCCESS-RATE LINE. The old chart drew a
 *      hardcoded `ReferenceLine y={90}` labelled "90% target" and painted the
 *      KPI green or red against it. Nothing in this platform defines that
 *      line. The ONE rule about voice success is R10, and it reads
 *      `failure rate > 20% in 6 hours` over `ai.invocation`
 *      (`20260502000000_AnalyticsRewrite.cs:443-454`) — a different threshold
 *      (80%) over a different window (6 hours, not a UTC day). So the 90%
 *      line was a fabricated threshold and every verdict drawn against it was
 *      a claim with nothing behind it. Both are gone; R10 is stated in words,
 *      with the reason no row here can be read against it.
 *
 *  (6) THE ENDPOINT TAKES NO ORGANISATION. `AdminEndpoints.cs:137-152` takes
 *      `days` and nothing else — the sixth admin endpoint checked and the
 *      sixth that is platform-wide. The org in the query key separates the
 *      CACHE; it does not scope the DATA. No sentence here says "in this
 *      organisation".
 *
 *  (7) 🔴 A FIFTH SWALLOW SITE. `GetVoiceTrendAsync` ends
 *      `catch { return new OpsVoiceTrendDto([]); }` (`AdminOpsRepository.cs:293`),
 *      beside `AdminMisRepository.cs:219/:245/:287` and
 *      `AdminOpsRepository.cs:253`. A dropped connection or a permission
 *      failure on `analytics.events` reaches this screen as an empty list
 *      with HTTP 200. So `measuredZero.unproven` is supplied: an empty answer
 *      here cannot be claimed as a measurement.
 *
 * ── THE WINDOW SELECTOR, WHICH THE DESIGN CANNOT SHOW ────────────────────
 * v3 hardcodes 14 days in `data.js`, so `voice-pipeline.html` has no day
 * control at all and a design-led port deletes one that works. It is kept
 * (A19, B5), and the value reaches ALL FOUR of the places it has to:
 *
 *   1. the hook argument            `useOpsVoice(days)`
 *   2. the QUERY KEY                `['ops','voice',org,days]` — miss this and
 *                                   7, 14 and 30 share one cache entry, which
 *                                   is a wrong number with no error anywhere
 *   3. the API query string         `?days=<n>`
 *   4. the interpolated card title  "Voice success rate — last N days"
 *
 * ── WHY ONE SHELL AND NOT TWO ────────────────────────────────────────────
 * Both series — the rate and the volume — are read off the SAME axis of
 * dates and share the same gaps, so they belong to one `slots` array, one
 * gap note and one data table of four columns. Two shells would print the
 * same fifteen dates twice and could disagree about which of them was
 * measured. `DataList` is deliberately not used for that table either: a
 * chart's summary is the shell's own table, built from the chart's own slots
 * (ChartShell §2).
 */

/* ────────────────────────────────────────────────────────────── THE WINDOW */

const WINDOWS = [7, 14, 30] as const;
const DEFAULT_DAYS = 14;

/** The server's own clamp, `Math.Clamp(days, 7, 30)` (`AdminEndpoints.cs:149`). */
const MIN_DAYS = 7;
const MAX_DAYS = 30;

/**
 * `?days`, read strictly.
 *
 * The old page did `Number(searchParams.get('days') ?? 14)` and passed the
 * result on unchecked. `?days=x` therefore produced the literal request
 * `?days=NaN`, which cannot bind to the endpoint's non-nullable `int` and
 * comes back 400; and `?days=3` was silently answered as 7, because the
 * server clamps and does not say so. Both end with the address bar naming a
 * window the figures do not have.
 *
 * Anything outside the server's own 7-30 range falls back to the default AND
 * is reported, so the URL and the screen can never quietly disagree.
 */
function readDays(raw: string | null): { days: number; unusable: string | null } {
  if (raw === null) return { days: DEFAULT_DAYS, unusable: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_DAYS || n > MAX_DAYS) {
    return { days: DEFAULT_DAYS, unusable: raw };
  }
  return { days: n, unusable: null };
}

/* ──────────────────────────────────────────────────────────────── THE AXIS */

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The right-hand edge of the axis, taken from the SERVER and never from this
 * browser's clock. `new Date()` at render is the fabricated-freshness defect
 * (D5) and the impurity `react-hooks/purity` flags on `HomePage.tsx:19`.
 *
 * `meta.lastRefreshedUtc` is `DateTime.UtcNow` taken as the request is served
 * (`GetOpsVoiceHandler.cs:20`), so its DATE is the last date the window can
 * reach. If the envelope carries no stamp, the newest date in the answer is
 * used instead — a real reading rather than a guess. If there is neither,
 * there is no axis, and the shell says so.
 */
function anchorDateOf(readAtIso: string | undefined, rows: OpsVoiceDay[]): string | null {
  const stamped = readAtIso?.slice(0, 10);
  if (stamped && ISO_DATE.test(stamped)) return stamped;

  const dates = rows.map((r) => r.date).filter((d) => ISO_DATE.test(d)).sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

/**
 * The FIXED axis of dates, oldest first.
 *
 * It carries `span + 1` slots, not `span`, and that is arithmetic rather than
 * an off-by-one: the SQL window is `occurred_at_utc >= NOW() - INTERVAL 'N
 * days'`, which starts part-way through the date N days back, so a 14-day
 * window spans 15 dates and its oldest one is partial. An axis of exactly 14
 * would leave the server's oldest row with no slot to land in, and `fillAxis`
 * IGNORES a row whose key is not on the axis — the loss would be silent, and
 * silent loss is the whole thing this console is being rebuilt to stop.
 */
function axisFor(anchorDate: string | null, span: number): AxisPoint[] {
  if (anchorDate === null) return [];
  const end = Date.parse(`${anchorDate}T00:00:00Z`);
  if (!Number.isFinite(end)) return [];

  const points: AxisPoint[] = [];
  for (let back = span; back >= 0; back--) {
    const key = new Date(end - back * DAY_MS).toISOString().slice(0, 10);
    points.push({ key, label: fmt.date(key, DATE_FORMATS.voiceDay) ?? key });
  }
  return points;
}

/* ───────────────────────────────────────────────────────────── THE VALUES */

/** Property (3). A zero average latency is the server's `COALESCE`, not a
 *  measurement — and a negative or non-finite one is not a duration at all. */
function latencyOf(day: OpsVoiceDay): number | null {
  const v = day.avgLatencyMs;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * A percentage outside 0-100 is not a noisy edge, it is an unbelievable
 * reading — the decision recorded in the Task 4 report: an out-of-range rate
 * renders as "not measured", never as a clamped 0% or 100%. "0%" here would
 * read as *the AI failed every single call today*, which is a fabricated
 * finding rather than a missing one.
 */
function rateOf(day: OpsVoiceDay): number | null {
  const v = day.successRatePct;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

/** A count we can add up. A junk value is not carried into a total as a zero. */
function counted(day: OpsVoiceDay): boolean {
  return Number.isFinite(day.invocations) && Number.isFinite(day.failures);
}

const LATENCY_SENTINEL =
  'No call on this date recorded a duration, and the server sends 0 when it has no average to send. A zero here is that substitution, not a measurement.';

const RATE_UNREADABLE =
  'The server sent a success rate outside 0-100%, which is not a possible reading. It is reported as missing rather than pulled to the nearest bound.';

/* ────────────────────────────────────────────────────────────── THE TABLE */

/** The v3 "By day" table, as the shell's own — same rows, same order, same
 *  gaps as the chart above it. A gap row is rendered by the shell, so there
 *  is no argument any of these functions can be handed that lets it print a
 *  0 for a date nobody measured. */
const DAY_TABLE: ChartDataTable<OpsVoiceDay> = {
  caption:
    'Every date on this window, with the number of AI calls, how many of them failed, the success rate and the average latency. A date with no reading carries one honest cell rather than four zeroes.',
  slotHeader: 'Date',
  columns: [
    {
      key: 'invocations',
      label: 'Calls',
      align: 'right',
      value: (d) => fmt.num(d.invocations) ?? <NotMeasured />,
    },
    {
      key: 'failures',
      /* A MEASURED ZERO LANDS HERE AND KEEPS ITS 0. `COUNT(*) FILTER (WHERE
         outcome = 'failure')` is legitimately 0 on a good day — that is a
         fact about the pipeline, and blurring it into the gap would be the
         same collapse running the other way. */
      label: 'Failed',
      align: 'right',
      value: (d) => fmt.num(d.failures) ?? <NotMeasured />,
    },
    {
      key: 'rate',
      label: 'Success rate',
      align: 'right',
      value: (d) => fmt.pct(rateOf(d)) ?? <NotMeasured why={RATE_UNREADABLE} />,
    },
    {
      key: 'latency',
      label: 'Avg latency',
      align: 'right',
      value: (d) => fmt.ms(latencyOf(d)) ?? <NotMeasured why={LATENCY_SENTINEL} />,
    },
  ],
};

/* ───────────────────────────────────────────────────────────── THE SCREEN */

export default function OpsVoicePage() {
  /* `?days` goes through the ONE url-state hook, which writes through the
     functional updater and therefore cannot drop `?org` on the way (A18,
     A20). The old page hand-rolled that write at `OpsVoicePage.tsx:29-31`. */
  const url = useListUrlState();
  const { days, unusable } = readDays(url.get('days'));

  const { data, isLoading, isFetching, isError, error, refetch } = useOpsVoice(days);

  const rows = data?.data?.days ?? [];

  /* THE ENVELOPE SENDS `lastRefreshedUtc`. Read through the one accessor that
     knows both spellings — a fixture stubbing `lastRefreshed` is why an
     inverted type survived on every screen until `7a742b05`. */
  const lastRefreshed = metaRefreshedAt(data?.meta);
  const readAt = fmt.dateTime(lastRefreshed, DATE_FORMATS.usersLastLogin);
  const checkedAt = readAt ?? 'a time the server did not report';

  const anchor = anchorDateOf(lastRefreshed, rows);
  const axis = axisFor(anchor, days);
  const axisKeys = new Set(axis.map((p) => (typeof p === 'string' ? p : p.key)));

  /* NOTHING FALLS OFF THE AXIS SILENTLY. `fillAxis` ignores a row it has no
     slot for, which is right — an API that starts returning an extra bin must
     not widen a chart the reader has learned the shape of — but the reader is
     owed the fact that it happened. */
  const offAxis = rows.filter((r) => !axisKeys.has(r.date)).length;

  const slots = fillAxis<OpsVoiceDay, OpsVoiceDay>(axis, rows, {
    keyOf: (r) => r.date,
    valueOf: (r) => r,
  });

  /* Every figure below is computed over the MEASURED slots only. A gap
     contributes nothing — not a zero — to any total, any average or any
     denominator. */
  const measured = measuredSlots(slots).map((s) => s.value);
  const addable = measured.filter(counted);
  const invocations = addable.reduce((sum, d) => sum + d.invocations, 0);
  const failures = addable.reduce((sum, d) => sum + d.failures, 0);

  /* Derived from the two counts beside it, never averaged from the daily
     rates: a mean of percentages weights a 4-call day the same as a 400-call
     one. The old page averaged the rates (`OpsVoicePage.tsx:21-23`). */
  const successRate = invocations > 0 ? ((invocations - failures) / invocations) * 100 : null;

  const latencies = measured.map(latencyOf).filter((v): v is number => v !== null);
  const avgLatency =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  const measuredCount = measured.length;
  const nothingMeasured = measuredCount === 0;

  /* The server echoes the window it actually used — `last {days} days`
     (`GetOpsVoiceHandler.cs:19`) — after its own clamp. Comparing the two is
     free, and it is the only way this screen can notice that it was answered
     about a different window from the one in the address bar. */
  const echoed = /last (\d+) days/.exec(data?.meta?.window ?? '');
  const serverDays = echoed ? Number(echoed[1]) : null;
  const windowMismatch = serverDays !== null && serverDays !== days;

  /* Never "0 of 0 dates measured": with no axis there is no denominator, and
     a ratio invented to fill a caption is the same fabrication as a zero. */
  const windowWords =
    axis.length === 0
      ? 'no dates could be placed on this axis'
      : `${measuredCount} of ${axis.length} dates measured`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.01em] text-text-1">
            <Mic size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Voice Pipeline
          </h1>
          {/* Property (1) and property (6), in the two sentences that stop
              every figure below from being read as something it is not. */}
          <p className="mt-1 text-[15px] text-text-2">
            Every AI call the platform made, by UTC date &mdash; platform-wide. It is not only
            voice: receipt photos and patti photos are the same kind of call and are counted here
            too, because the feed records the call and not what it was for.
          </p>
        </div>
        <FreshnessChip
          source={data?.meta?.source ?? 'live-aggregated'}
          lastRefreshed={lastRefreshed}
        />
      </div>

      {/* ── A19 / B5 — the control v3 has no design for ─────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-text-2" id="ops-voice-window-label">
            Window
          </span>
          <div
            role="group"
            aria-labelledby="ops-voice-window-label"
            className="flex flex-wrap items-center gap-2"
          >
            {WINDOWS.map((w) => (
              <Button
                key={w}
                variant="outline"
                size="sm"
                aria-pressed={w === days}
                className={w === days ? 'border-blue text-blue' : undefined}
                onClick={() => url.set('days', w)}
              >
                {w} days
              </Button>
            ))}
          </div>
        </div>
        <p className="text-[13px] text-text-3">
          {unusable === null ? (
            <>
              The window is in the address bar, so a link to this screen carries it. The server
              measures back from the moment it answers rather than from midnight, so a {days}-day
              window spans {axis.length || days + 1} dates and its oldest one is partial.
            </>
          ) : (
            <>
              The address bar asked for <b>{unusable}</b> days, which is outside the {MIN_DAYS} to{' '}
              {MAX_DAYS} the server accepts. Showing {days} days instead &mdash; the server would
              have quietly clamped it and answered a different window from the one the link named.
            </>
          )}
        </p>
        {windowMismatch && (
          <p className="text-[13px] text-text-3">
            The server says it measured <b>{serverDays} days</b> while this page asked for {days}.
            The figures below are the server&rsquo;s window, not this page&rsquo;s.
          </p>
        )}
      </div>

      {/* ── the four tiles ─────────────────────────────────────────────── */}
      <div data-kpis="voice" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Calls"
          value={fmt.num(invocations)}
          state={nothingMeasured ? 'unmeasured' : 'ok'}
          tone="blue"
          caption={`${windowWords} · read at ${checkedAt}`}
          note="Voice parses, receipt extractions and patti extractions together. The feed does not separate them."
        />
        <KpiCard
          label="Failed calls"
          value={fmt.num(failures)}
          state={nothingMeasured ? 'unmeasured' : 'ok'}
          tone={failures > 0 ? 'red' : 'blue'}
          caption={windowWords}
          note="A failure is a call that did not complete. Nothing on this screen measures whether a call that DID complete understood the farmer correctly."
        />
        <KpiCard
          label="Success rate"
          value={fmt.pct(successRate)}
          state={successRate === null ? 'unmeasured' : 'ok'}
          /* Property (5). Blue is the neutral-informational colour: no rule
             names a line for this window, so there is no verdict to paint. */
          tone="blue"
          caption={
            /* Never "0 of 0 calls completed" under an em dash: with nothing
               measured there is no denominator, and printing one would be a
               fabricated zero wearing a caption. */
            nothingMeasured
              ? windowWords
              : `${fmt.num(invocations - failures)} of ${fmt.num(invocations)} calls completed`
          }
          note="No rule sets a success line for this window. The one rule that exists, R10, watches a 20% failure rate over 6 hours — a different threshold over a different window."
        />
        <KpiCard
          label="Avg latency"
          value={fmt.ms(avgLatency)}
          state={avgLatency === null ? 'unmeasured' : 'ok'}
          tone="blue"
          caption={
            latencies.length > 0
              ? `mean of ${latencies.length} daily averages, not of the calls themselves`
              : 'no date in this window reported a duration'
          }
          note="No rule sets a latency line either. A date whose calls recorded no duration is left out rather than counted as 0ms."
        />
      </div>

      {/* ── the chart, the gaps and the table ──────────────────────────── */}
      <ChartShell<OpsVoiceDay>
        id="voice-days"
        /* A19's fourth place. `days` is interpolated HERE, and a test breaks
           if the title and the request ever disagree. */
        title={`Voice success rate — last ${days} days`}
        subtitle={
          <span className="text-[13px] text-text-2">
            {windowWords} · read at {checkedAt}
          </span>
        }
        slots={slots}
        dataTable={DAY_TABLE}
        states={{
          isLoading,
          isFetching,
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: 'No date in this window carries a reading',
            checkedAt,
            /* Property (7) — the fifth swallow site. An empty answer from this
               endpoint is not evidence of a quiet fortnight. */
            unproven: (
              <>
                This feed answers its own database failures with an empty list and a success code
                (<code>catch {'{'} return empty {'}'}</code>, <code>AdminOpsRepository.cs:293</code>
                ), so a broken query and a genuinely silent window arrive here looking the same.
                Nothing was received at {checkedAt}, and that is all this screen can honestly say.
              </>
            ),
          },
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-semibold text-text-2">Success rate, by date</p>
            <Sparkline<OpsVoiceDay>
              slots={slots}
              valueOf={rateOf}
              tone="green"
              size="lg"
              label={`Success rate for each of the ${axis.length} dates in this window. The exact figures are in the data table below.`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-semibold text-text-2">Calls, by date</p>
            <Sparkline<OpsVoiceDay>
              slots={slots}
              valueOf={(d) => (Number.isFinite(d.invocations) ? d.invocations : null)}
              tone="blue"
              size="lg"
              label={`Number of AI calls on each of the ${axis.length} dates in this window.`}
            />
          </div>
          <p className="text-[13px] text-text-3">
            Both series are drawn on the same axis of dates, so a date missing from one is missing
            from the other. Bar height is in proportion to the highest reading in the window, which
            compresses small differences in a success rate &mdash; the exact figures are in the
            table below. Older dates are drawn fainter; a hatched date has no reading and takes no
            fade, because an absence has no recency worth reading.
          </p>
          {offAxis > 0 && (
            <p className="text-[13px] text-text-3">
              The server also returned {fmt.num(offAxis)}{' '}
              {offAxis === 1 ? 'date that is' : 'dates that are'} outside this axis, so{' '}
              {offAxis === 1 ? 'it is' : 'they are'} not drawn above and not counted in any figure
              on this screen.
            </p>
          )}
        </div>
      </ChartShell>

      <NotMeasuredPanel
        title="What this screen cannot tell you"
        why={
          <>
            <p>
              <b>Which provider served which call.</b> Every call records the provider that
              answered it, but this feed groups by date alone and carries no provider column, so
              there is no breakdown to show and no per-provider latency or failure rate. Adding it
              is a change to the query behind this endpoint, not to this screen.
            </p>
            <p className="mt-2">
              <b>Whether a call that succeeded was any good.</b> A failure is a call that did not
              complete. Nothing here measures whether a completed call understood the farmer, and a
              parse that returned confident nonsense is counted as a success.
            </p>
            <p className="mt-2">
              <b>Whether a quiet date was quiet.</b> A date with no calls produces no row at all,
              which is the same thing the feed sends when nothing was recorded. Those dates are
              drawn as holes and left out of every figure &mdash; they are not zeros, and they are
              not proof of a zero.
            </p>
            <p className="mt-2">
              <b>Whether an empty answer means anything.</b> When this endpoint&rsquo;s own query
              fails it returns an empty list with a success code, so a database problem arrives
              looking like a silent fortnight. A failure this screen CAN see &mdash; a broken
              request, a timeout, a refused permission &mdash; is always named as one.
            </p>
            <p className="mt-2">
              <b>Anything about one organisation.</b> This endpoint takes only the number of days;
              every figure is platform-wide. Dates are UTC dates, so a day here begins at 05:30 in
              India and ends at 05:30 the next morning.
            </p>
          </>
        }
      />
    </div>
  );
}
