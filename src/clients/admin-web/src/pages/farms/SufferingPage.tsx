import { metaRefreshedAt } from '@/lib/api';
import { Frown } from 'lucide-react';
import { DataList } from '@/components/data';
import type { DataListColumn, FacetConfig, FacetOption } from '@/components/data';
import { NotMeasured, StandingNote } from '@/components/state';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { PersonName } from '@/components/ui/PersonName';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { useSuffering } from '@/hooks/useFarms';
import type { SufferingItem } from '@/hooks/useFarms';

/**
 * SUFFERING — the watchlist whose empty state used to say "great!".
 *
 * ── THE STRING THIS FILE EXISTS TO DELETE (D9, Task 16 Step 2) ───────────
 * The old screen rendered, for every absence it could ever have:
 *
 *     No farms with repeated errors — great!
 *
 * One sentence covering four different facts. A 500 from the API, a request
 * that timed out, a 403 from an admin whose scope does not include this
 * module, and a genuine empty all produced the word GREAT. On a list where
 * "nobody is suffering" is the best possible news, that is the worst possible
 * thing to print over a broken pipe: the reader is not merely uninformed,
 * they are actively reassured. Four causes now, and the failure ones are
 * never the quiet one.
 *
 * ── WHAT THIS FEED ACTUALLY IS, measured in the repo on 2026-09-01 ───────
 * Seven fields and no more (`SufferingItemDto`, `FarmsAdminDto.cs:28-35`):
 * farm id, name, an event count, three channel counts, and the time of the
 * most recent event. No owner, no phone, no village, no crop, no plan, no
 * tier — so five of the six things v3's search box promises are not here to
 * search, and its expanded row's Owner / Phone / Village / Crop / Plan /
 * Tier / WVFD / Last-log block is not buildable at all.
 *
 * The rows come from `mis.farmer_suffering_watchlist`
 * (`AdminMisRepository.cs:223-247`), defined in
 * `20260502000000_AnalyticsRewrite.cs:397-416`. Six properties of that
 * definition decide most of this file:
 *
 *   1. THE WINDOW IS SEVEN DAYS, not twenty-four hours.
 *      `WHERE ... occurred_at_utc >= NOW() - INTERVAL '7 days'`. The old
 *      subtitle said "in the last 24h"; v3's says "in the last 24 hours"; the
 *      API envelope itself says `window: "last 24h"`
 *      (`GetSufferingHandler.cs:16`). All three are wrong by a factor of
 *      seven, and the SQL wins.
 *
 *   2. THE ENTRY CONDITION IS THREE OR MORE FAILED EVENTS.
 *      `HAVING COUNT(*) FILTER (WHERE event_type IN ('api.error',
 *      'client.error') OR (event_type = 'ai.invocation' AND props->>'outcome'
 *      = 'failure')) >= 3`. "Repeated" was right; the number was never on
 *      screen. It is now, because it is the whole definition of the list.
 *
 *   3. THEY ARE NOT ALL "API ERRORS". Three event types qualify: a server
 *      error (`api.error`), an error thrown in the farmer's own browser
 *      (`client.error`), and an AI call that failed (`ai.invocation` with
 *      `outcome = 'failure'`). Calling the whole set API errors names one of
 *      the three and hides the two that are about the farmer's device and the
 *      farmer's voice.
 *
 *   4. 🛑 THE EVENT COUNT IS NOT A COUNT OF ERRORS, AND THE LIST IS ORDERED
 *      BY IT. The column is `COUNT(*)` with NO filter, over a WHERE clause
 *      that admits `event_type = 'ai.invocation'` in full — success and
 *      failure alike. Only the HAVING clause filters to failures. All three
 *      AI handlers emit an `ai.invocation` row on the happy path
 *      (`outcome = success ? "success" : "failure"` —
 *      `ParseVoiceInputHandler.cs:484`, `ExtractReceiptHandler.cs:113`,
 *      `ExtractPattiImageHandler.cs:111`), so **every successful voice parse
 *      and every successful receipt scan is added to a farm's figure on a
 *      screen headed "suffering"** — and `ORDER BY s.error_count DESC` ranks
 *      the list by it. A farm that uses voice heavily climbs.
 *      `last_error_at` is `MAX(occurred_at_utc)` over the SAME unfiltered
 *      group (`:407`), so the "last error" can be the timestamp of a
 *      successful voice parse. Both are renamed on screen for that reason:
 *      **Events counted** and **Last event**, never Total Errors and Last
 *      Error. Nothing on this side can correct either number; the least this
 *      screen can do is not repeat a claim the SQL does not support, and put
 *      the caveat beside the ranking rather than in a footnote.
 *
 *      The three CHANNEL figures are the exception and are clean: an
 *      `ai.invocation` carries no `endpoint` prop (its props key is
 *      `operation`), so a successful AI call matches none of the three
 *      `COUNT(*) FILTER` clauses, and `voice_errors`' second disjunct takes
 *      `ai.invocation` only when `outcome = 'failure'`. Sync, Logs and Voice
 *      are therefore the only figures on this screen that count failures and
 *      nothing else — which is also why they, and not the event total, are
 *      what the one facet filters on.
 *
 *   5. THE THREE CHANNELS ARE FILTERS, NOT A BREAKDOWN. `sync_errors`,
 *      `log_errors` and `voice_errors` are `COUNT(*) FILTER` clauses over
 *      `props->>'endpoint'`; an event matching none of them (a successful AI
 *      call, a `client.error` whose browser payload carries no `endpoint`, a
 *      server error on any other route) is in the total and in no channel.
 *      v3 states the opposite in as many words — "their error counts sum to
 *      the N on the tile above" (`suffering.html:408-410`) — and that is
 *      false here. The screen says so instead of leaving the reader to
 *      discover it by adding up.
 *      (The matview also computes a FOURTH channel, `client_errors`
 *      (`:406`), and the repository's SELECT does not read it. So the one
 *      channel that would explain part of the gap is measured nightly and
 *      reaches no screen — no DTO field, no hook, nothing.)
 *
 *   6. `LIMIT 50`, same hard cap as Silent Churn, two orders of magnitude
 *      below the 3,000-row set where Task 8 measured a keystroke at ~70 ms.
 *      There is no `page` parameter on the endpoint, so the whole answer is
 *      in hand: every filter, sort and count below is client-side and exact
 *      over what the server sent — and the subtitle says 50 is a ceiling,
 *      which the old screen never did.
 *
 * ── THE TWO THINGS THE SERVER DOES THAT THIS SCREEN MUST NOT ECHO ────────
 * 🔴 AN EMPTY LIST IS NOT PROOF THAT NOTHING BROKE. `GetSufferingAsync`
 * closes with `catch { return []; }` (`AdminMisRepository.cs:245`). Any
 * exception — a dropped connection, a missing matview, a permission failure
 * on `mis` — is swallowed and answered as an empty list with HTTP 200. The
 * four causes below are therefore the four causes THIS CLIENT can see; the
 * server can still turn a database failure into a measured zero before the
 * client is ever told. That is named in the standing note rather than
 * quietly inherited. (`GetSilentChurnAsync` has the identical catch.)
 *
 * 🔴 THE FRESHNESS CHIP CANNOT BE TRUSTED TO THE MINUTE. The handler builds
 * `new AdminMetaDto("live-aggregated", "last 24h", DateTime.UtcNow, 60)` —
 * `lastRefreshed` is the moment the REQUEST was served, not the moment the
 * data was computed. The matview behind it is rebuilt by the nightly
 * `MisRefreshJob` (`MisRefreshJob.cs:71`, 02:00 daily), and the endpoint sits
 * behind a 30-second output cache (`Program.cs:131`). So the chip reads
 * "Live · 1s ago" over a list that can be a day old. The chip is left
 * reporting exactly what the server sent — inventing a better timestamp here
 * would be the same defect pointing the other way — and the age it really
 * has is stated in words below it.
 *
 * ── B16 — THIS ENDPOINT CARRIES NO PHONE NUMBER, AND ALSO DOES NOT REDACT ─
 * `GetSufferingHandler` takes `IAdminMisRepository` and nothing else: no
 * `IResponseRedactor`, exactly like `GetFarmsListHandler` (Task 14) and
 * `GetSilentChurnHandler` (Task 15). Repo-wide, only `GetFarmerHealthHandler`
 * and `GetCohortPatternsHandler` redact. The saving grace here is that the
 * SELECT never leaves `mis.farmer_suffering_watchlist` and `ssf.farms`, so
 * there is no phone number in the response to leak. The name is still routed
 * through `PersonName`, which routes a `**redacted**` through `Masked`, so
 * the marker cannot reach the DOM as literal text the day masking arrives.
 * **B16 is not ticked by this task.**
 *
 * ── WHAT IS DELIBERATELY NOT PORTED FROM v3 ──────────────────────────────
 *  · `RED_AT = 5` and everything hanging off it: the red event figure, the
 *    red leading row edge, and the "5 or more" / "1 to 4" filter band
 *    (`suffering.html:222`, `:378-381`). Five is a number that exists in the
 *    prototype and nowhere in this product — the same class as Silent
 *    Churn's `silentChurnCallWeeks`, which Task 15 dropped for the same
 *    reason. The one threshold this product HAS set is the three-event entry
 *    condition, and every row on the list is already past it. Painting a farm
 *    red on a line nobody has drawn, over a figure that counts successful AI
 *    calls, would be a severity claim built on two inventions.
 *    Raised as a founder decision in the run report, not decided here.
 *  · The "N farms clear" summary figure and its "measured zero" line
 *    (`suffering.html:346-359`). It is `D.totals.farms - rows.length`, and
 *    the total number of farms is not on this endpoint. A second query to get
 *    it would be a real change, not a port.
 *  · The cross-reference into the Silent Churn watchlist in the expanded row
 *    (`suffering.html:267-273`). It reads a second dataset the prototype
 *    happens to hold in one file; here it is a second endpoint, a second
 *    cache key and a second failure mode on a screen whose job is one list.
 *  · v3's search copy, "Search farm, owner, village or phone" — one of those
 *    four is on this feed.
 */

/* ─────────────────────────────────────────────────────────── THE VALUES */

/**
 * `COALESCE(f.name, s.farm_id::text)` (`AdminMisRepository.cs:235`) — when a
 * watchlist row has no matching farm in `ssf.farms`, the server sends the farm
 * id STRING as the name. Handing that to `PersonName` as a name would print a
 * guid in the Farm column and quietly claim it is what the farm is called.
 * Turned back into the absence it stands for, so the id renders as the
 * fallback it actually is. Same idea as Silent Churn's `'—'` phone sentinel.
 */
function nameOf(row: SufferingItem): string | null {
  const value = row.name?.trim();
  return !value || value === row.farmId ? null : value;
}

/** The events that fall in NO channel — see property (5) in the file header.
 *  Negative would mean an event counted in two channels at once, which needs
 *  an endpoint path containing two of sync/log/voice; none exists today, and
 *  the guard is here so a future one cannot print a negative. */
function unchannelled(row: SufferingItem): number {
  return Math.max(0, row.errorCount - (row.syncErrors + row.logErrors + row.voiceErrors));
}

const NO_RESOLUTION =
  'Nothing in this product marks an error resolved. A farm leaves this list when its events age out of the seven-day window, whether or not anyone fixed anything — so this is an absent record, never a statement that the problem is still open.';

const NO_LAST_ERROR =
  'This row arrived with no usable time for its most recent event, so there is nothing to report.';

/* ─────────────────────────────────────────────────────────── THE COLUMNS */

const COLUMNS: DataListColumn<SufferingItem>[] = [
  {
    key: 'farm',
    label: 'Farm',
    render: (f) => <PersonName name={nameOf(f)} fallback={f.farmId} />,
    sortType: 'text',
    /* A withheld name sorts as ABSENT rather than under `*`: an order derived
       from the permission is not an order derived from the data. A nameless
       farm sorts as absent for the same reason — its id is an identifier, not
       a position in an alphabet. */
    sortValue: (f) => (f.name === '**redacted**' ? null : nameOf(f)),
    defaultDir: 'asc',
  },
  {
    key: 'events',
    /* NOT "Total Errors". See property (4): this is `COUNT(*)` over three
       event types, one of which is admitted in full including its successes.
       The header names what the figure counts, and the summary and the
       expanded row say the rest. */
    label: 'Events counted',
    align: 'right',
    /* No tone, no severity colour and no leading edge — v3's `RED_AT = 5` is
       a prototype number (file header). The column is already the default
       sort and the list is already worst-first. */
    render: (f) => <span className="font-semibold">{fmt.num(f.errorCount)}</span>,
    sortType: 'num',
    sortValue: (f) => f.errorCount,
    /* The server ordered by this figure and stopped; when two farms tie, the
       one that broke most recently is the one to look at first. Not flipped by
       direction (`sortRows.ts` §4), which is right — within a tie, most-recent
       first is the reading either way. */
    tiebreak: (a, b) => Date.parse(b.lastErrorAt ?? '') - Date.parse(a.lastErrorAt ?? ''),
    defaultDir: 'desc',
  },
  {
    key: 'sync',
    label: 'Sync',
    align: 'right',
    render: (f) => fmt.num(f.syncErrors),
    sortType: 'num',
    sortValue: (f) => f.syncErrors,
    defaultDir: 'desc',
  },
  {
    key: 'logs',
    label: 'Logs',
    align: 'right',
    render: (f) => fmt.num(f.logErrors),
    sortType: 'num',
    sortValue: (f) => f.logErrors,
    defaultDir: 'desc',
  },
  {
    key: 'voice',
    label: 'Voice',
    align: 'right',
    render: (f) => fmt.num(f.voiceErrors),
    sortType: 'num',
    sortValue: (f) => f.voiceErrors,
    defaultDir: 'desc',
  },
  {
    key: 'lastError',
    /* NOT "Last Error", for the same reason the column before it is not
       "Total Errors": `MAX(occurred_at_utc)` is taken over the unfiltered
       group, so the newest row in it can be a successful AI call (file
       header, property 4). */
    label: 'Last event',
    /* A51 — `HH:mm, dd MMM`, the hour FIRST, and deliberately not the
       `dd MMM yyyy` on Silent Churn: a seven-day window makes the time of day
       the signal and the year noise. Named in `DATE_FORMATS` rather than left
       a loose literal.

       The DTO types `LastErrorAt` non-nullable — it is `MAX(occurred_at_utc)`
       over a group that must hold at least three rows — so the absence branch
       is a guard, not a case. It is here because a bare unformattable date is
       exactly how a screen starts printing "Invalid Date" at an operator. */
    render: (f) =>
      fmt.date(f.lastErrorAt, DATE_FORMATS.sufferLastErr) ?? (
        <NotMeasured why={NO_LAST_ERROR} />
      ),
    sortType: 'date',
    sortValue: (f) => f.lastErrorAt,
    state: (f) => (fmt.date(f.lastErrorAt, DATE_FORMATS.sufferLastErr) ? null : 'unmeasured'),
    defaultDir: 'desc',
  },
];

/* ──────────────────────────────────────────────────────────── THE FACETS */

/**
 * ONE facet group, and its counts DO NOT CROSS-FILTER (Task 16 Step 4).
 *
 * Verified in the prototype rather than assumed from Silent Churn's opposite:
 * `suffering.html:428-441` builds every option count from `rows`, and
 * `paintOptions()` (`:543-550`) only ever flips `aria-pressed` — the numbers
 * are computed once and never recomputed. Its own comment says why: "Counts
 * are of the whole list, not of the current selection, so they never move
 * under the reader." `pass(` — the cross-filter helper — appears in
 * `all-farms.html` and `silent-churn.html` and in neither this file nor
 * `users.html` nor `api-errors.html`.
 *
 * That asymmetry is the right way round. Silent Churn is a list you work
 * THROUGH, so a button should promise the rows it will hand you. Here the
 * question is "how many farms are hitting sync errors" — an answer that
 * changed because you had also clicked Voice would stop being an answer.
 *
 * The three options OVERLAP by nature: one farm can break in sync and in
 * voice, so they cannot be pressed as a partition and their counts do not sum
 * to the row count. Stated on screen, in the summary.
 *
 * ⚠️ THE FLAG IS CORRECT AND CURRENTLY INERT, AND THAT IS WORTH KNOWING
 * RATHER THAN DISCOVERING. Cross-filtering means "allow for the OTHER facets'
 * selections": `facetOptionViews` calls `passesFacets(row, facets, selection,
 * facet.key)`, and `passesFacets` SKIPS the facet named in that last argument
 * (`facets.ts:53`). With exactly one facet group there are no others, so the
 * skip covers everything and neither setting can move a number. Setting it
 * explicitly to `false` is therefore documentation today and behaviour the
 * day a second group is added — which is the moment to re-read this. A
 * mutation flipping it to `true` survives the test suite, deliberately and
 * knowingly, because there is no observable difference to assert.
 *
 * THE COUNT BAND IS NOT SHIPPED. v3's second group is "5 or more" / "1 to 4"
 * (`suffering.html:378-381`), and both halves are wrong here: five is a
 * prototype number, and no row can hold fewer than three because three is the
 * entry condition — so "1 to 4" is a label the feed can never satisfy, the
 * same shape as the `under-2` band Task 15 carried only as a guard.
 *
 * The deeper reason is property (4): a band over `error_count` would be a
 * band over a figure that counts successful AI calls, so "10 or more" would
 * sort a farm that uses voice a lot beside a farm that is genuinely broken.
 * Silent Churn could band `weeksSilent` because `weeksSilent` measures one
 * thing. This figure does not. Filtering on the three CLEAN channel counts
 * instead is the same control built on numbers that mean what they say.
 */
const TYPES: FacetOption<SufferingItem>[] = [
  { value: 'sync', label: 'Sync', test: (f) => f.syncErrors > 0 },
  { value: 'logs', label: 'Logs', test: (f) => f.logErrors > 0 },
  { value: 'voice', label: 'Voice', test: (f) => f.voiceErrors > 0 },
];

/** A facet with fewer than two live options is not shipped: one button
 *  holding every row is a control that filters nothing — the reason Task 14
 *  shipped no facets at all — and an empty `rows` produces exactly that while
 *  the first request is in flight. */
function facetsFor(rows: SufferingItem[]): FacetConfig<SufferingItem>[] {
  const options = TYPES.filter((option) => rows.some(option.test));
  if (options.length < 2) return [];
  return [{ key: 'type', label: 'By error type', crossFiltered: false, options }];
}

/* ───────────────────────────────────────────────────────────── THE SEARCH */

/** Module scope, so the memoised index in `searchIndex.ts` keeps its identity
 *  across a render of this screen. Two keys, because two is what the feed
 *  carries: the name and the id an operator files a ticket with. */
const SEARCH_KEYS = (f: SufferingItem): string[] => [f.name, f.farmId];

/* ────────────────────────────────────────────────────── THE EXPANDED ROW */

/** Every sentence is derived from a field on the row. Nothing here is typed
 *  prose about a farm, and nothing is a threshold this product has not set. */
function sufferingDetail(row: SufferingItem) {
  const events = fmt.num(row.errorCount) ?? String(row.errorCount);
  const when = fmt.dateTime(row.lastErrorAt, DATE_FORMATS.usersLastLogin);
  const spare = unchannelled(row);

  const channels = [
    row.syncErrors > 0 ? `${fmt.num(row.syncErrors)} on sync` : null,
    row.logErrors > 0 ? `${fmt.num(row.logErrors)} on logs` : null,
    row.voiceErrors > 0 ? `${fmt.num(row.voiceErrors)} on voice` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <p>
        {events} {row.errorCount === 1 ? 'event was' : 'events were'} counted for this farm in the
        last seven days
        {when ? `, the most recent at ${when}` : ''}.{' '}
        {channels.length > 0
          ? `${channels.join(', ')}.`
          : 'None of them matched the sync, log or voice filters.'}{' '}
        {/* Property (5). Sync, logs and voice are three separate filters over
            the same events, so they do not add up — and the gap is not noise:
            a successful AI call lands in it, and so does a browser error whose
            payload carried no endpoint. */}
        Those three are separate filters over the same events rather than a breakdown of them, so
        they are not expected to add up to {events}.
        {spare > 0
          ? ` ${fmt.num(spare)} of the ${events} match none of the three — that set includes AI calls that SUCCEEDED, which this figure counts.`
          : ''}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-caption">
        <dt className="text-text-3">Farm id</dt>
        {/* The identifier an operator files a ticket with, and the only value
            on this row that names nobody. */}
        <dd className="tabular-nums text-text-2">{row.farmId}</dd>
        {/*
         * TASK 16 STEP 3 — a true sentence this product has never said.
         *
         * Nothing marks an error resolved. Not softened into "still open",
         * "unresolved" or "outstanding": all three claim we looked and found
         * the problem live. An operator who fixed a farm's sync yesterday and
         * reads "unresolved" today has been misled by this console, not by
         * the data. The write surface that would change it is register row
         * B15, and it is a separate plan.
         */}
        <dt className="text-text-3">Resolved</dt>
        <dd className="text-text-2">
          <NotMeasured why={NO_RESOLUTION} />
        </dd>
      </dl>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── THE SCREEN */

export default function SufferingPage() {
  const { data, isLoading, isFetching, isError, error, refetch } = useSuffering();

  /*
   * NO `keepPreviousDataWithinOrg` ON THIS HOOK, and that is correct rather
   * than an oversight (confirmed in Task 14, again in Task 15).
   * `keepPreviousData` exists to hold the previous PAGE's rows while the next
   * page loads; this endpoint has no pages. Adding it for symmetry with the
   * paginated hooks would buy nothing and would hold one organisation's
   * watchlist on screen across an org switch.
   */
  const items = data?.data ?? [];
  const lastRefreshed = metaRefreshedAt(data?.meta);

  /**
   * NEVER `new Date()`. The only time this screen has is the server's own
   * `meta.lastRefreshed` — computing one at render is the fabricated
   * freshness D5 records against `HomePage.tsx:18-19`.
   *
   * And it is qualified, because that value is `DateTime.UtcNow` taken as the
   * request is served (file header): it is when the list was READ, and the
   * list itself is rebuilt once a night. Saying only "checked at 08:30" would
   * claim a seven-day window had been recomputed at 08:30.
   */
  const readAt = fmt.dateTime(lastRefreshed, DATE_FORMATS.usersLastLogin);
  const checkedAt = readAt
    ? `${readAt}, though the list itself is rebuilt only once a night`
    : 'a time the server did not report';

  /** The sum of the reported figures — arithmetic on what the server sent,
   *  not a second measurement. Named "events" everywhere it appears, for the
   *  reason in property (4). */
  const totalEvents = items.reduce((sum, f) => sum + f.errorCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <Frown size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Farmer Suffering Watchlist
          </h1>
          {/* A57's twin. The old line — "Farms hitting repeated API errors in
              the last 24h. Drill into a farm to see error details." — was
              wrong in three of its four clauses: the window is seven days,
              two of the three event types are not API errors, and no row on
              that screen was clickable at all. Only "repeated" survived, and
              it never said what repeated meant. This is the only place either
              watchlist's rule is stated on screen (A57), so it is preserved —
              restated true, and now naming the cap. */}
          <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
            Farms where <b>three or more things have failed in the last seven days</b> &mdash;
            something broke on our servers, something broke in the farmer&rsquo;s own app, or an AI
            request did not complete. The server sends 50 farms and no more, so read this as
            today&rsquo;s call list rather than a total. Select a row to see the detail.
          </p>
        </div>
        {/* Reported as the server reports it, including the source label. The
            age it really has is in the standing note below, because a chip
            cannot carry a caveat. */}
        <FreshnessChip
          source={data?.meta?.source ?? 'live-aggregated'}
          lastRefreshed={lastRefreshed}
        />
      </div>

      <DataList<SufferingItem>
        id="suffering"
        label="Farmer suffering watchlist"
        caption="Farms with three or more failed events in the last seven days, most events first, with the number of events counted, how many of them matched the sync, log and voice filters, and the time of the most recent one. Select a row to open its detail."
        noun={{ one: 'farm', many: 'farms' }}
        rows={items}
        rowKey={(f) => f.farmId}
        columns={COLUMNS}
        /* No pagination — the endpoint has no pages (file header, property 6). */
        pagination={{ mode: 'none' }}
        facets={facetsFor(items)}
        /* THE v3 SUMMARY-FIRST GATE STAYS HERE, as it does on Silent Churn and
           as `suffering.html` itself does (`suffering.html:89,94` — `<div class="as-listwrap"
           id="suffering-list" hidden>` plus `[data-showall]`). How many farms
           are hit and how many events are behind them ARE the answer; the rows
           are the follow-up. Task 14 dropped the gate on All Farms only
           because that screen has no facets to read first. */
        collapsible={{
          defaultOpen: false,
          summary: () => (
            <p>
              <b>
                {fmt.num(totalEvents)} {totalEvents === 1 ? 'event' : 'events'}
              </b>{' '}
              between them. That figure counts every server error, browser error and AI call these
              farms recorded &mdash; <b>including AI calls that succeeded</b> &mdash; so it is not a
              count of failures, and the order of the list inherits the same inflation. Sync, logs
              and voice are three overlapping filters over those events, not a breakdown that adds
              up. How many farms are clear is not measured here: this feed carries only the farms
              that crossed the threshold.
            </p>
          ),
        }}
        defaultSort={{ key: 'events', dir: 'desc' }}
        search={{
          /* CLIENT-side, and it can be: the whole answer is in hand, capped at
             50 rows by the server. `searchHaystack` adds the romanised index,
             so a support worker who hears "Bhosale" on a call finds भोसळे मळा. */
          mode: 'client',
          commit: 'submit',
          paramKey: 'search',
          placeholder: 'Search by farm name or farm id…',
          label: 'Search the watchlist',
          keys: SEARCH_KEYS,
          searchesOver:
            'Farm name and farm id. This feed carries no owner, phone, village, crop or plan, so none of them can be searched.',
        }}
        expand={sufferingDetail}
        states={{
          isLoading,
          isFetching,
          /* D9, Step 2. "No farms with repeated errors — great!" was rendered
             over a 500, a timeout and a 403 alike. */
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: 'No farm reached three failed events in the last seven days',
            checkedAt,
          },
        }}
        /* B12 — shaped like the real thing: 6 columns. */
        skeleton={{ rows: 8, cells: 6 }}
      />

      <StandingNote
        title="What this screen cannot tell you"
        summary="Whether anything was fixed, and how to reach the farmer. Neither is recorded, and these rows are refreshed only overnight."
        why={
          <>
            <p>
              <b>Nothing in this product records that a problem was fixed.</b> A farm drops off this
              list when its failures get older than seven days &mdash; not when somebody sorts them
              out. So a farm you helped yesterday is still here today, and a farm that has gone
              quiet may simply have stopped using the app. That is why every opened row says
              &ldquo;Resolved &mdash; not measured&rdquo;.
            </p>
            <p>
              <b>An empty list is not proof that nothing broke.</b> If the server&rsquo;s own lookup
              fails, it replies with an empty list and calls it a success, so a database problem and
              a genuinely quiet week arrive looking identical. Failures this screen <b>can</b> see
              &mdash; a request that broke, one that timed out, one that was refused &mdash; are
              always named as failures.
            </p>
            <p>
              <b>The freshness badge is the age of the answer, not of the information.</b> The
              server stamps each reply with the moment it sent it, but the list behind that reply
              is put together only once every night. An error from an hour ago will not be on it
              yet.
            </p>
            <p>
              The server also sends no owner name, no phone number, no village, crop or plan. So
              there is nothing to filter or search by, and <b>no way to contact the farmer from this
              screen</b> &mdash; you will need the Farmer Health screen or All Farms for that.
            </p>
          </>
        }
      />
    </div>
  );
}
