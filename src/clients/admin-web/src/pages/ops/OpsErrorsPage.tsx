import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DataList } from '@/components/data';
import type { DataListColumn } from '@/components/data';
import { NotMeasured, StandingNote } from '@/components/state';
import { Button } from '@/components/ui/Button';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { metaRefreshedAt } from '@/lib/api';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useListUrlState } from '@/lib/useListUrlState';
import { useOpsErrors, type OpsErrorEvent } from '@/hooks/useOpsErrors';

/**
 * API ERRORS — the operator's log of what the platform did to a farmer, and
 * the one screen in this console that carries a capability nothing else has.
 *
 * ── WHAT SURVIVES EXACTLY ────────────────────────────────────────────────
 *  A16  `?since` — read, threaded to the server, and until now reachable ONLY
 *       by hand-editing the address bar. It keeps working AND finally has a
 *       control. See "THE WINDOW" below.
 *  A17  server pagination at 50 per page; `totalPages` from the SERVER's
 *       totalCount. The client holds one page and never slices a set.
 *  A18  `?page`, `?endpoint` and `?since` URL-synced.
 *  A20  the functional updater (never the object form, which drops `?org=`)
 *       and page reset to 1 on every filter change.
 *  A21  THE BLUR-OR-ENTER CONTRACT. The endpoint box is UNCONTROLLED
 *       (`defaultValue`), trimmed, and commits when you leave it as well as on
 *       Enter, with a Clear filter button that appears only when a filter is
 *       applied. Farms and Users use the draft contract and commit on Enter or
 *       a Search button and at NO other moment. The two look identical in a
 *       screenshot and are not the same product behaviour: an on-call engineer
 *       types here and tabs away. `commit: 'blur-or-enter'` is what picks it.
 *  A24  the AdminResponse envelope behind the freshness chip.
 *  A25  `keepPreviousData` (narrowed to the org in `lib/orgQuery.ts`) plus the
 *       "Refreshing…" swap that replaces the row count.
 *  A50  MANUAL PAGINATION — see "THE LIBRARY" below.
 *  A51  `DATE_FORMATS.opsErrorsRow` — the full date WITH seconds, because an
 *       operator reading this screen may be looking days back. Ops Live shows
 *       time only. They differ on purpose.
 *  B4   the pager, hidden entirely when there is one page.
 *  B12  a skeleton shaped like this table.
 *  B13  the background-fetch indicator.
 *  D9   "No errors found. The system is healthy." is gone — the single worst
 *       sentence in the console after Suffering's, because on this screen a
 *       500 from the analytics database renders as a clean bill of health.
 *
 * ── THE LIBRARY (A50), AND WHY IT IS GONE ────────────────────────────────
 * This was the only file in the console importing `@tanstack/react-table`,
 * for `manualPagination` plus a server-driven `pageCount`. The BEHAVIOUR that
 * row registers — the server decides how many pages there are, the client
 * never slices — is preserved exactly by `DataList`'s pager and asserted in
 * this screen's test. The library is not.
 *
 * That is a measurement, not a preference. `npm run lint` reported
 * `react-hooks/incompatible-library` on the old line 74: "TanStack Table's
 * useReactTable() API returns functions that cannot be memoized safely", so
 * the React Compiler SKIPPED COMPILING this entire component. What the API
 * contributed over a paginated list was `getCanNextPage()` — one division.
 * Task 8 shipped the shared pager on arithmetic for that reason and recorded
 * that if this task also dropped the library, A50 needs the founder's tick.
 * It is dropped, the row is flagged, and `@tanstack/react-table` now has zero
 * importers — removing it from `package.json` belongs to Task 27 (the dead
 * code sweep), not here.
 *
 * ── THE WINDOW (A16) ─────────────────────────────────────────────────────
 * `?since` was read at the old line 65, passed at 67 and threaded through
 * `useOpsErrors.ts:18,33` into the query string — with no control anywhere. A
 * screen-by-screen port from a prototype that has no such param deletes it,
 * and nobody notices until an on-call engineer's saved link stops filtering.
 *
 * It now has buttons. What they write is an ABSOLUTE ISO instant, because
 * that is the only thing the server can read: `AdminEndpoints.cs:123` is
 * `DateTime.TryParse(since, out var dt) ? dt : null`, and a value it cannot
 * parse falls silently back to the endpoint's own 24-hour default
 * (`AdminOpsRepository.cs:204-205`). A relative token like `6h` would put a
 * window in the URL that the server ignores — the address bar and the answer
 * disagreeing, quietly, which is worse than having no control at all.
 *
 * The buttons therefore carry NO selected state, and that is honest rather
 * than unfinished. A link written at 09:00 asking for the last hour still
 * says `since=08:00` at noon, by which time its window is four hours wide.
 * Highlighting "Last hour" then would be a claim about the data that stopped
 * being true the moment the reader stopped looking. What the screen shows
 * instead is the instant the URL actually asks for, in words, read straight
 * back out of the param.
 *
 * ── 🛑 WHAT THIS FEED CARRIES. Verified in backend code 2026-09-01 ────────
 * `OpsErrorEventDto` (`AdminOpsHealthDto.cs:30-36`) is SIX fields:
 * EventType, Endpoint, StatusCode, LatencyMs, FarmId, OccurredAtUtc. The
 * errorCode, message, appVersion, workKept, meaning and usualCause that
 * Steps 5-7 of this task want are delivered by a DIFFERENT plan
 * (`2026-08-30-error-capture-engine.md`, its Task 8), which is code-complete
 * on an unmerged branch. They do not exist in this tree, so those steps are
 * BLOCKED and nothing here stubs them.
 *
 * THREE event types reach this list, and only one of them is an API error:
 *   `api.error`   5xx, or a 4xx on a write to a path a farmer cannot work
 *                 around (`RequestObservabilityMiddleware.cs:68-72`).
 *   `api.slow`    a write that SUCCEEDED and took over two seconds (`:73`).
 *                 Not a failure. The old screen coloured it beside a 500 and
 *                 the page title called it an error.
 *   `client.error` the farmer's own device reporting a script error or a
 *                 failed fetch. Not an API call at all.
 *
 * 🔴 A FOURTH TYPE IS EMITTED AND THIS FEED CANNOT SHOW IT. RG5 added
 * `sync.mutation_rejected` for a 200 that refused work inside it — a farmer's
 * mutation silently dropped by `POST /sync/push`. It is deliberately NOT
 * `api.error` (`AnalyticsEventType.cs:61-62`: overloading that string would
 * fire `mis.alert_r9_api_error_spike`), and this query's
 * `event_type IN ('api.error','api.slow','client.error')`
 * (`AdminOpsRepository.cs:231`) does not include it. So the failure shape the
 * observability rulebook added last month is invisible on the screen built to
 * show failures. Stated at the foot of the page; fixing it is one string in a
 * backend SQL list.
 *
 * 🔴 A DATABASE FAILURE IS ANSWERED AS AN EMPTY LIST WITH HTTP 200.
 * `GetErrorsPagedAsync` ends `catch { return new OpsErrorsPageDto([], 0, page,
 * pageSize); }` (`AdminOpsRepository.cs:253`) — the same shape Task 17 found
 * on the three MIS methods. So an empty answer here CANNOT be called a
 * measured zero, and this screen supplies `measuredZero.unproven`. Note the
 * difference from Users: there the query is provably broken. Here nothing is
 * known to be wrong with it — what is missing is any way to tell a quiet
 * window from an unreachable analytics database.
 *
 * 🔴 NO SERVER-SIDE ROW CAN EVER NAME A FARM. `farmId` is nullable in the
 * DTO, which is why Step 7's "not attributable" half is buildable. What the
 * plan did not know is how OFTEN: the middleware reads the farm off a
 * `farm_id` claim (`RequestObservabilityMiddleware.cs:161-162`) and NO TOKEN
 * THIS PLATFORM ISSUES CARRIES ONE. `JwtTokenIssuer` is the only issuer
 * (`DependencyInjection.cs:86`) and neither of its two paths stamps it
 * (`:26-40`, `:75-79`); `Claim("farm…` appears nowhere in the repository. So
 * every `api.error` and every `api.slow` row lands unattributed, and so does
 * every `client.error` posted to `/telemetry/client-error`, which reads the
 * same absent claim (`Program.cs:684`). Only the mobile client's own outbox
 * can attribute a row, because `/analytics/ingest` lifts `props.farmId` out
 * of the body instead (`IngestEventsHandler.cs:114-123`).
 *
 * ── NO FACETS, AND NO SUMMARY-FIRST GATE ─────────────────────────────────
 * v3 offers two filter groups, by endpoint and by status. A `DataList` facet
 * is CLIENT-side: over a server-paginated list it would filter the fifty rows
 * in hand and present the result as the answer. That is the same reason the
 * tier filter on All Farms is a screen control (T14) and why Users ships
 * none (T17). The endpoint filter here IS server-side and is the search box.
 * A status filter has no server parameter to write to, so it is not offered
 * rather than offered over one page in fifty.
 *
 * With no facets to read first, a "Show all" gate would hide the table for no
 * reason and add a click to every visit — Task 14's finding, applied again.
 *
 * ── NO EXPANDABLE ROW ────────────────────────────────────────────────────
 * Step 6 is the row detail, and every field in it is one of the six this tree
 * does not have. A detail built from the columns already on the row would be
 * the same facts twice; a detail with placeholder text would be the thing the
 * plan's rule names in as many words. There is no `expand`, so `DataList`
 * renders no chevron and the rows do not pretend to open onto anything.
 */

/** 50 per page (A17, B4). The server clamps to 10..200 (`AdminEndpoints.cs:127`,
 *  `Math.Clamp(pageSize, 10, 200)`), so 50 is inside its range at both ends. */
const PAGE_SIZE = 50;

/**
 * The window buttons. Hours, because the value written is an instant computed
 * from them — see the file header on why a relative token cannot be used.
 *
 * 24 hours is included even though it equals the server's own default: a
 * reader who has narrowed to an hour needs a way back to the default width
 * that is a window in its own right, not a "clear" that looks like an undo.
 */
const WINDOWS: { hours: number; label: string }[] = [
  { hours: 1, label: 'Last hour' },
  { hours: 6, label: 'Last 6 hours' },
  { hours: 24, label: 'Last 24 hours' },
  { hours: 24 * 7, label: 'Last 7 days' },
];

/** The endpoint the server writes when an event carries no `endpoint` prop —
 *  `COALESCE(props->>'endpoint', 'unknown')` (`AdminOpsRepository.cs:225`).
 *  It is a sentinel, not an endpoint, and it is turned back into an absence
 *  the way `FarmsListPage` turns the COALESCEd em dash back into one. */
const UNKNOWN_ENDPOINT = 'unknown';

const NO_ENDPOINT =
  'No endpoint was recorded for this row. The server writes the literal "unknown" when the event carries no endpoint property, and an error reported by the farmer\'s own device never carries one — its vocabulary requires only a message. It also means this row can never be reached by the endpoint filter above, which matches on that same missing property.';

const NO_STATUS =
  'No HTTP status was written for this row. The request middleware always records one, so a blank here is an event that did not come from a request at all — an error the farmer\'s device reported after the fact.';

const NO_LATENCY =
  'No duration was written for this row. Only the request middleware times a call; an error reported by the farmer\'s device carries no latency to record.';

const NOT_ATTRIBUTABLE =
  'No farm is recorded against this call, and on this feed that is the normal case rather than the exception. The middleware that writes these rows takes the farm from a farm_id claim on the signed-in token, and no token this platform issues carries one — so every server-side row lands unattributed. A farm can appear here only when the farmer\'s own app reported the error and sent its farm id with it.';

/**
 * What each event type IS, in words. The badge, its colour and the sentence
 * behind it all come from here, so this screen cannot call `api.slow` a
 * failure in one place and a slow success in another.
 *
 * `api.slow` is NOT red. It is a write that succeeded (`status < 400`,
 * `RequestObservabilityMiddleware.cs:73`) and took over two seconds — on the
 * screen titled API Errors, painting it the colour of a 500 is a verdict the
 * data does not support.
 */
const TYPE_INFO: Record<string, { className: string; what: string }> = {
  'api.error': {
    className: 'bg-tint-red text-red',
    what: 'The server answered 5xx, or refused a write on a path the farmer cannot work around.',
  },
  'api.slow': {
    className: 'bg-tint-amber text-amber',
    what: 'A write that SUCCEEDED and took more than two seconds. It is here for its duration, not for a failure.',
  },
  'client.error': {
    className: 'bg-tint-blue text-blue',
    what: "The farmer's own device reported this — a script error or a failed request inside the app. It is not an API call.",
  },
};

/** An endpoint that is really the sentinel reads as absent everywhere: in the
 *  cell, and in the sort order. */
function endpointOf(row: OpsErrorEvent): string | null {
  const value = row.endpoint?.trim();
  return !value || value === UNKNOWN_ENDPOINT ? null : value;
}

/**
 * ROW IDENTITY IS NOT ON THE ROW.
 *
 * `analytics.events` has an `event_id` — `RequestObservabilityMiddleware.cs:121`
 * writes `Guid.NewGuid()` into it — and the SELECT behind this screen does not
 * project it (`AdminOpsRepository.cs:222-229`). So no row here can be pointed
 * at in a ticket, and two genuinely identical events could collide on any key
 * composed from the fields that DID come back.
 *
 * The position within the page is therefore attached here, once, rather than
 * inside a `rowKey` that cannot see it. It is a key, not a fact, and nothing
 * on screen reads it.
 */
interface OpsErrorRow extends OpsErrorEvent {
  key: string;
}

const COLUMNS: DataListColumn<OpsErrorRow>[] = [
  {
    key: 'time',
    label: 'Time',
    /* A51 — the full date AND seconds. Ops Live shows time only because its
       whole window is two hours; this screen's window is whatever `?since`
       says, and an operator may be looking days back. */
    render: (e) => (
      <span className="font-mono text-caption tabular-nums text-text-2">
        {fmt.dateTime(e.occurredAtUtc, DATE_FORMATS.opsErrorsRow) ?? (
          <NotMeasured why="This row carries no time. Every row the server writes has one, so a blank here is a value that did not survive the journey." />
        )}
      </span>
    ),
    sortType: 'date',
    sortValue: (e) => e.occurredAtUtc,
    /* Newest first is what a log is read in. */
    defaultDir: 'desc',
  },
  {
    key: 'type',
    label: 'Type',
    render: (e) => {
      const info = TYPE_INFO[e.eventType];
      return (
        <span
          data-type={e.eventType}
          title={info?.what}
          className={cn(
            'inline-block rounded-chip px-2 py-0.5 font-mono text-caption font-semibold',
            /* An unknown type gets the honesty grey rather than a guessed
               verdict: a colour we cannot explain is one we must not draw. */
            info?.className ?? 'bg-tint-grey text-text-2',
          )}
        >
          {e.eventType}
        </span>
      );
    },
    sortType: 'text',
    sortValue: (e) => e.eventType,
    defaultDir: 'asc',
  },
  {
    key: 'endpoint',
    label: 'Endpoint',
    width: '30%',
    render: (e) => {
      const endpoint = endpointOf(e);
      return endpoint ? (
        <span className="font-mono text-caption break-all text-text-1">{endpoint}</span>
      ) : (
        <NotMeasured why={NO_ENDPOINT} />
      );
    },
    sortType: 'text',
    /* Absent sorts as absent — `sortRows` parks a null at the bottom in BOTH
       directions, which is where "we have no reading" belongs. No `state` is
       declared: the value is already missing, and a second declaration saying
       so would be configuration that looks load-bearing and is not (T17). */
    sortValue: endpointOf,
    defaultDir: 'asc',
  },
  {
    key: 'status',
    label: 'Status',
    align: 'right',
    /* An HTTP status is a CODE, not a quantity, so it does not go through
       `fmt.num` — the same reason a phone number is never grouped. 500 reads
       as 500 wherever it appears. */
    render: (e) =>
      e.statusCode === null ? (
        <NotMeasured why={NO_STATUS} />
      ) : (
        <span
          className={cn(
            'font-mono text-caption font-semibold',
            e.statusCode >= 500 ? 'text-red' : e.statusCode >= 400 ? 'text-amber' : 'text-text-2',
          )}
        >
          {e.statusCode}
        </span>
      ),
    sortType: 'num',
    sortValue: (e) => e.statusCode,
    /* Worst first is the reading an operator wants. */
    defaultDir: 'desc',
  },
  {
    key: 'latency',
    label: 'Latency',
    align: 'right',
    render: (e) => fmt.ms(e.latencyMs) ?? <NotMeasured why={NO_LATENCY} />,
    sortType: 'num',
    sortValue: (e) => e.latencyMs,
    defaultDir: 'desc',
  },
  {
    key: 'farm',
    label: 'Farm',
    /**
     * STEP 7's ATTRIBUTION HALF — the part that is NOT blocked, because
     * `farmId` is already nullable on the DTO.
     *
     * "not attributable" is the fourth word in the honest-state vocabulary
     * (`honestState.ts:56`) and it exists for exactly this: a value that is
     * absent because nothing tied the record to a subject, which is a
     * different fact from "not measured". Guessing a farm from the endpoint,
     * or from whoever else was active, is the fabrication this console exists
     * to refuse.
     *
     * The id is printed WHOLE. The old cell showed `slice(0, 8) + '…'`, and a
     * truncated identifier is one an operator cannot paste into a query or a
     * ticket — the only two things this value is for. No farm NAME comes back
     * on this feed at all; that is stated once, at the foot of the screen.
     */
    render: (e) =>
      e.farmId ? (
        <span className="font-mono text-caption break-all text-text-2">{e.farmId}</span>
      ) : (
        <NotMeasured state="unattributed" why={NOT_ATTRIBUTABLE} />
      ),
    sortType: 'text',
    sortValue: (e) => e.farmId,
    defaultDir: 'asc',
  },
];

export default function OpsErrorsPage() {
  /* `?page` and `?since`. `DataList` runs its own instance of this hook for
     `?endpoint`, `?sort` and `?dir`; both read the same router params and both
     write through the same functional updater, which is the only reason two
     instances are safe (A20). */
  const url = useListUrlState({ draftKey: 'endpoint' });
  const page = url.page;
  const endpoint = url.get('endpoint') ?? undefined;
  const since = url.get('since') ?? undefined;

  const { data, isLoading, isFetching, isError, error, refetch } = useOpsErrors({
    page,
    pageSize: PAGE_SIZE,
    endpoint,
    since,
  });

  const totalCount = data?.data?.totalCount ?? 0;

  /* The `?? []` lives INSIDE the memo: as a separate const it is a new array
     on every render that has no answer yet, which makes the memo's dependency
     change every time and defeats it (`react-hooks/exhaustive-deps`). */
  const rows = useMemo<OpsErrorRow[]>(
    () => (data?.data?.items ?? []).map((e, i) => ({ ...e, key: `${i}|${e.occurredAtUtc}` })),
    [data],
  );

  /* THE ENVELOPE SENDS `lastRefreshedUtc`. Read it through the one accessor
     that knows both spellings — `lib/api.ts:177`. Reading either field
     directly is how every chip in this console fell through to "Live · now"
     over data it had no age for. */
  const lastRefreshed = metaRefreshedAt(data?.meta);

  /* NEVER `new Date()` — that is D5, the fabricated freshness. When the server
     sends no time the screen says so rather than filling the gap. */
  const checkedAt =
    fmt.dateTime(lastRefreshed, DATE_FORMATS.opsErrorsRow) ?? 'a time the server did not report';

  /**
   * THE WINDOW, READ BACK OUT OF THE URL AND NOT OUT OF A BUTTON PRESS.
   *
   * Three readings, and the third is the one that matters. `?since` is parsed
   * by `DateTime.TryParse` on the server and a value it cannot read falls
   * silently back to 24 hours, so a link carrying a malformed `since` shows a
   * 24-hour answer under a URL claiming something else. This console cannot
   * know whether .NET would accept a string its own parser rejected — so it
   * says what it knows and names the consequence rather than asserting one.
   */
  const sinceLabel = since ? fmt.dateTime(since, DATE_FORMATS.opsErrorsRow) : null;
  const windowWords = !since
    ? "the server's own default window, the last 24 hours"
    : sinceLabel
      ? `everything recorded since ${sinceLabel}`
      : `a start time this console cannot read (${since})`;

  /** True when the client is holding one page of a larger set. */
  const pageScoped = totalCount > rows.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <AlertTriangle size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            API Errors
          </h1>
          {/* No "in this organisation". `/shramsafal/admin/ops/errors` takes
              page, pageSize, endpoint and since and no organisation
              (`AdminEndpoints.cs:109-117`) — the fifth admin endpoint checked
              and the fifth that is platform-wide. The org in the query key
              separates the cache; it does not scope the data. */}
          <p className="mt-1 text-body text-text-2">
            Every call the API failed or refused, every write that succeeded but took over two
            seconds, and every error the farmer&rsquo;s own app reported — platform-wide, newest
            first. Three different things, and the Type column is what tells them apart.
          </p>
        </div>
        <FreshnessChip source={data?.meta?.source ?? 'live'} lastRefreshed={lastRefreshed} />
      </div>

      {/* A16 — the control this param has never had. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption font-semibold text-text-2" id="ops-errors-window-label">
            Window
          </span>
          <div
            role="group"
            aria-labelledby="ops-errors-window-label"
            className="flex flex-wrap items-center gap-2"
          >
            {WINDOWS.map((w) => (
              <Button
                key={w.hours}
                variant="outline"
                size="sm"
                /* `Date.now()` lives in the HANDLER, never in render — a
                   render-phase clock read is the impurity `react-hooks/purity`
                   flags on HomePage and the fabricated-freshness defect in its
                   original form. */
                onClick={() =>
                  url.set('since', new Date(Date.now() - w.hours * 3_600_000).toISOString())
                }
              >
                {w.label}
              </Button>
            ))}
            {since && (
              <Button variant="ghost" size="sm" onClick={() => url.set('since', null)}>
                Back to the default window
              </Button>
            )}
          </div>
        </div>
        <p className="text-caption text-text-3">
          Showing {windowWords}.{' '}
          {since
            ? 'A start time is a fixed instant, so a link that carried this window keeps its start and grows wider as time passes — which is what a saved link should do.'
            : 'The server chooses this when the address bar names no start time.'}
          {since && !sinceLabel
            ? ' The server may not be able to read it either, and when it cannot it falls back to the last 24 hours without saying so.'
            : ''}
        </p>
      </div>

      {pageScoped && (
        /* The scope of the SORT, said once. Over a server-paginated list a
           column sort orders the rows in hand; the total beside it comes from
           the server and is exact for the window above. */
        <p className="text-caption text-text-3">
          Sorting a column orders the {fmt.num(rows.length)} calls on this page, not all{' '}
          {fmt.num(totalCount)}.
        </p>
      )}

      <DataList<OpsErrorRow>
        id="ops-errors"
        label="API errors"
        caption="Every recorded call in the window, with the time, the event type, the endpoint, the HTTP status, the latency and the farm the call could be attributed to."
        noun={{ one: 'call', many: 'calls' }}
        rows={rows}
        rowKey={(e) => e.key}
        columns={COLUMNS}
        /* A17 / A50 / B4 — the page count is derived from the SERVER's
           totalCount. The client holds fifty rows and never slices a set. */
        pagination={{
          mode: 'server',
          page,
          pageSize: PAGE_SIZE,
          totalCount,
          onPage: url.setPage,
        }}
        /* The server composes the page `ORDER BY occurred_at_utc DESC`
           (`AdminOpsRepository.cs:234`), so the order the reader lands on
           agrees with the order the page was built in rather than quietly
           contradicting it. */
        defaultSort={{ key: 'time', dir: 'desc' }}
        search={{
          mode: 'server',
          /* A21 — THE OTHER CONTRACT. Uncontrolled, trimmed, commits on blur
             AND on Enter. Changing this one word would make the filter apply
             at a different moment, which is invisible in review. */
          commit: 'blur-or-enter',
          paramKey: 'endpoint',
          placeholder: 'Filter by endpoint…',
          label: 'Filter by endpoint',
          /* From the query behind the box: `props->>'endpoint' ILIKE @ep` with
             `%term%` either side (`AdminOpsRepository.cs:214,217,233,240`).
             Case-insensitive, any part, and the value it matches is the whole
             "METHOD /path" string the middleware writes. */
          searchesOver:
            'The filter matches any part of the endpoint, ignoring case, against the method and path together — so "sync" and "POST /sync" both find the same calls. It matches nothing else on the row, and a row with no endpoint recorded can never match it.',
        }}
        /* NO ROW EDGE. v3 marks the one row whose measurement failed; here
           every row is an error, a refusal or a slow write, so an edge on all
           of them would be decoration. */
        states={{
          isLoading,
          isFetching,
          /* D9 — "No errors found. The system is healthy." was rendered over a
             500, a timeout and a 403 alike, on the screen whose whole job is
             to show failures. */
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: 'No call came back for this window',
            checkedAt,
            /* THE FIFTH CAUSE (T17). `MeasuredZero` closes with "This is a
               measured zero, not a missing feed" — and this endpoint answers
               a database failure with an empty list and a success code, so
               that sentence is one this screen cannot stand behind. */
            unproven: (
              <>
                <p>
                  The request succeeded and carried no calls. On this screen that is usually the
                  good reading — a window in which nothing failed — but it cannot be proved,
                  because a database failure arrives looking exactly the same: the query behind
                  this feed ends in a bare catch that returns an empty list with a success code, so
                  an analytics database this API could not reach is reported as a quiet platform.
                </p>
                <p className="mt-2">
                  Nothing is known to be wrong with the query itself. What is missing is any way
                  for this console to tell the two apart, and until the server distinguishes them
                  the zero will not be called a measurement.
                </p>
                <p className="mt-2">
                  The window asked for was {windowWords}, and the server reported this answer at{' '}
                  {checkedAt}.
                </p>
              </>
            ),
          },
        }}
        /* B12 — shaped like the real thing: six columns. */
        skeleton={{ rows: 8, cells: 6 }}
      />

      <StandingNote
        title="What this screen does not carry"
        why={
          <>
            <p>
              <b>What the server actually said is not on the row.</b> The message, the error code,
              which app build the farmer was on, and whether their work survived are all being
              built by the error-capture work and are not in this codebase yet. Until they land,
              this list can tell an operator that a call failed and when — not what the person on
              the other end lost. Those columns and the row detail that holds them are the blocked
              part of this screen.
            </p>
            <p className="mt-2">
              <b>Almost nothing here can be traced to a farm.</b> The farm is taken from a claim on
              the signed-in token, and no token this platform issues carries one, so every call
              recorded by the server lands unattributed. Only an error the farmer&rsquo;s own app
              reported can name a farm — and even then it is an identifier, never a name: no farm
              name comes back on this feed at all.
            </p>
            <p className="mt-2">
              <b>There is no error rate.</b> Nothing counts total requests — the middleware writes
              a row only when a call fails, is refused or runs slow — so there is no denominator,
              and any percentage on this screen would be invented.
            </p>
            <p className="mt-2">
              <b>One kind of failure is missing entirely.</b> When a batch write answers 200 and
              refuses some of the work inside it, that is recorded under its own event type, and
              this feed reads three types that do not include it. A farmer&rsquo;s mutation dropped
              that way is counted somewhere and shown nowhere.
            </p>
            <p className="mt-2">
              <b>This list is not scoped to an organisation.</b> The endpoint takes no
              organisation and returns every recorded call on the platform, so switching
              organisation in the top bar does not change what is on this screen.
            </p>
          </>
        }
      />
    </div>
  );
}
