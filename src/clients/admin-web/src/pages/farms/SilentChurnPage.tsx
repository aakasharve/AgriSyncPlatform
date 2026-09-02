import { metaRefreshedAt } from '@/lib/api';
import { TrendingDown } from 'lucide-react';
import { DataList, facetOptionsFrom } from '@/components/data';
import type { DataListColumn, FacetConfig, FacetOption } from '@/components/data';
import { Masked, NotMeasured, NotMeasuredPanel, StandingNote } from '@/components/state';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { PersonName } from '@/components/ui/PersonName';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { partitionSilentChurn, useSilentChurn } from '@/hooks/useFarms';
import type { SilentChurnItem } from '@/hooks/useFarms';

/**
 * SILENT CHURN — the watchlist, and the farms it is not allowed to count.
 *
 * ── WHAT THIS FEED ACTUALLY IS, measured in the repo on 2026-09-01 ────────
 * Six fields and no more (`SilentChurnItemDto`, `FarmsAdminDto.cs:20-26`):
 * farm id, farm name, owner phone, plan, weeks silent, last log. Everything
 * below is built from those six; nothing is inferred from the v3 mock-up's
 * richer sample rows.
 *
 * The rows come from `mis.silent_churn_watchlist`
 * (`AdminMisRepository.cs:179-221`), and three properties of that query
 * decide most of this file:
 *
 *   1. `LIMIT 50` (`AdminMisRepository.cs:206`). The server sends AT MOST
 *      fifty rows, longest silence first. There is no pager and no `page`
 *      parameter — asking for page 2 is not a thing this endpoint can answer
 *      — so the whole answer is in hand, and every filter, sort and count
 *      below is client-side and exact.
 *      Fifty rows is nowhere near the 3,000-row set where Task 8 measured a
 *      keystroke at ~70 ms, so no virtualisation and no debounce.
 *
 *   2. `JOIN last_log ll ON ll.farm_id = sf.farm_id
 *       WHERE ll.last_log_at < NOW() - INTERVAL '14 days'`
 *      (migration `20260502010000_AddSubscriptionFarmsAndChurnMatviews`).
 *      An INNER join plus a comparison against NULL: **a farm that has never
 *      logged cannot appear in this result at all.** See THE HOLD-OUT below —
 *      this is the single most important fact on the screen.
 *
 *   3. `GREATEST(1, days_since_last_log / 7)` (`:198`) — integer division, so weeks
 *      are FLOORED. A farm quiet for twenty days reads "2w", not three. That
 *      is why every sentence here says "N full weeks": floor is exactly the
 *      claim the arithmetic supports. (The C# doc-comment above the query
 *      says `ceil`; the SQL says floor. The SQL wins.)
 *
 * ── THE HOLD-OUT (Task 15 Step 3) ────────────────────────────────────────
 * The old screen rendered `f.lastLogAt ? format(...) : 'Never'`
 * (`SilentChurnPage.tsx:41` before this change) — one column, one list, and
 * therefore one claim covering two completely different farmers. A farm that
 * logged for months and stopped has walked away. A farm that has never logged
 * never started. Counting the second as a long silence overstates the churn
 * list; flattening it to zero weeks understates it. It is neither: with no
 * last log there is nothing to count back from, so the silence is
 * UNMEASURABLE.
 *
 * So the rows are partitioned before anything else happens, and a row with no
 * last log is held OUT of the watchlist, out of the summary, out of every
 * facet count and out of the sort. That is `partition()` below and it is what
 * `SilentChurnPage.test.tsx` breaks on purpose to prove.
 *
 * AND THE PARTITION IS EMPTY TODAY, BY CONSTRUCTION — property (2) above.
 * Never-logged farms are not "absent from the page", they are absent from the
 * FEED: they live in a second matview, `mis.zero_engagement_farms`, which the
 * same migration creates and which has NO repository method, NO endpoint and
 * NO hook (grepped repo-wide, 2026-09-01 — the only references are the
 * migration, the nightly `MisRefreshJob` that refreshes it, and a migration
 * test asserting its columns).
 *
 * That is why the panel below says the count is NOT MEASURED rather than
 * printing 0. "Nought farms are too new to judge" would be a measurement this
 * console has never taken, which is the exact defect (P4, D5) the redesign
 * exists to remove. The partition still ships, and still runs, because it is
 * a guard: the DTO's `LastLogAt` is nullable, the reader handles `DBNull`,
 * and the day this feed changes the conflation must not come back with it.
 *
 * ── WHAT CHANGED IN THE RULE-DEFINITION SUBTITLE (A57) ────────────────────
 * The old subtitle read: *"Paid farms with WVFD = 0 for 2+ consecutive weeks.
 * Act before renewal."* Register row A57 records it as the ONLY place this
 * list's definition is stated on screen, so it is preserved — but three of
 * its four clauses are false against the query:
 *
 *   "Paid"          — the matview takes subscription status IN (1,2,3) =
 *                     Trialing, Active, PastDue (`SubscriptionStatus.cs`).
 *                     A trial is not a payment and past-due is not either.
 *   "WVFD = 0"      — WVFD is never consulted. The signal is the absence of a
 *                     `log.created` event in `analytics.events`.
 *   "2+ weeks"      — the threshold is 14 DAYS. Two weeks is what 14 days
 *                     floors to, so this clause survives, restated in the
 *                     unit the query actually uses.
 *
 * The subtitle now states the rule the code applies, and adds the cap, which
 * nothing on the old screen mentioned: an operator reading "50 farms" had no
 * way to know 50 was a ceiling rather than a count.
 *
 * ── WHAT IS DELIBERATELY NOT PORTED FROM v3 ──────────────────────────────
 *  · The "call today" flag and its red row edge. v3 fires them at
 *    `silentChurnCallWeeks` (`silent-churn.html:189-190`), a threshold that
 *    lives in the prototype's own `data.js` and has no counterpart anywhere
 *    in this product. Shipping it would put a red "call today" beside a
 *    farmer's name on a rule nobody has agreed. Founder decision, raised in
 *    the run report, not invented here.
 *  · Quiet acreage, village, crop, tier and WVFD in the expanded row. None of
 *    the five is on this endpoint. Stated in the panel rather than left as a
 *    blank the reader has to explain to themselves.
 *  · v3's search copy, "Search phone, village or name" — village is not here.
 */

/** The em dash the query COALESCEs a missing owner phone to
 *  (`AdminMisRepository.cs:196`), turned back into the absence it stands for
 *  so `Masked` can say "not measured" instead of printing a bare character
 *  whose meaning the reader has to supply. Same sentinel as All Farms. */
const NO_PHONE_SENTINEL = '—';
function ownerPhoneOf(row: SilentChurnItem): string | null {
  const value = row.ownerPhone?.trim();
  return !value || value === NO_PHONE_SENTINEL ? null : value;
}

/** Digits only, so a phone typed without spaces still finds a row stored with
 *  them. v3's `digits()` (`silent-churn.html:205`) strips WHITESPACE only;
 *  this strips every non-digit, so a phone stored as `+91 98765-43210` is
 *  also found by `9876543210`. A deliberate widening — the founder's standing
 *  preference on this index is to match MORE spellings, not fewer. */
function digitsOf(value: string | null): string | null {
  return value === null ? null : value.replace(/\D/g, '');
}

const NO_OUTREACH_RECORD =
  'Nothing in this product records a call to a farmer, so there is no date to show. Read it as an absent record — not as a call that was never made, and never as a zero.';

const NO_LAST_LOG =
  'This farm has no last log to count back from, so its silence has no value at all — not a long one and not a zero.';

/* ───────────────────────────────────────────────────────── THE PARTITION */

/**
 * THE PARTITION MOVED TO `@/hooks/useFarms` IN TASK 26 (`partitionSilentChurn`),
 * and it is the same function — same one line, same reason, same guard.
 *
 * It used to live here, NOT exported, on the grounds that "the tests break it
 * by editing this line" and a value export from a page file costs a
 * `react-refresh/only-export-components` warning. Both were true. What changed
 * is that Home now merges this feed with Suffering and needs the identical
 * split, so keeping it here would have meant TWO copies of one product rule —
 * and the conflation Task 15 deleted ("never logged" and "logged and stopped"
 * printed as the same thing) would have come back on whichever screen was
 * edited second.
 *
 * It now lives beside the FEED it partitions rather than beside either screen.
 * The proof stays where it was: it is the SUMMARY, the COUNT and the ROWS on
 * this screen that must not contain a never-logged farm, and this screen's test
 * still breaks the rule at its source and asserts all three.
 */

/* ─────────────────────────────────────────────────────────── THE COLUMNS */

const COLUMNS: DataListColumn<SilentChurnItem>[] = [
  {
    key: 'farm',
    label: 'Farm',
    render: (f) => <PersonName name={f.name} fallback={f.farmId} />,
    sortType: 'text',
    /* A withheld name sorts as ABSENT rather than under `*` — an order
       derived from the permission is not an order derived from the data. */
    sortValue: (f) => (f.name === '**redacted**' ? null : f.name),
    defaultDir: 'asc',
  },
  {
    key: 'phone',
    label: 'Phone',
    render: (f) => <Masked value={ownerPhoneOf(f)} />,
    sortType: 'text',
    sortValue: (f) => digitsOf(ownerPhoneOf(f)),
    defaultDir: 'asc',
  },
  {
    key: 'plan',
    label: 'Plan',
    /* The plan CODE, as sent. `plan_code` is a real column here — unlike
       `/admin/farms`, where the same field is the SQL literal `'trial'`
       (`AdminMisRepository.cs:108`) — so it is worth showing and worth
       filtering on. Prettifying `trial` into a plan NAME would be inventing a
       product catalogue this console cannot see. */
    render: (f) => f.plan?.trim() || <NotMeasured why="The subscription carries no plan code." />,
    sortType: 'text',
    sortValue: (f) => f.plan,
    state: (f) => (f.plan?.trim() ? null : 'unmeasured'),
    defaultDir: 'asc',
  },
  {
    key: 'weeksSilent',
    label: 'Weeks Silent',
    align: 'right',
    /* No tone and no threshold colour: see "call today" in the file header.
       The column is already the sort, and the list is already longest-first. */
    render: (f) => <span className="font-semibold">{fmt.num(f.weeksSilent)}w</span>,
    sortType: 'num',
    sortValue: (f) => f.weeksSilent,
    /* Weeks are FLOORED from days, so ties are the common case, not the edge
       one: 14 to 20 days all read "2w". The server ordered by
       `days_since_last_log DESC` and the flooring threw that precision away —
       this puts it back, by breaking a tie on the older last log. Not flipped
       by direction (see `sortRows.ts` §4), which is right: within one week
       band, longest-silent-first is the reading either way. */
    tiebreak: (a, b) => Date.parse(a.lastLogAt ?? '') - Date.parse(b.lastLogAt ?? ''),
    defaultDir: 'desc',
  },
  {
    key: 'lastLog',
    label: 'Last Log',
    /* A51 — `dd MMM yyyy` on this screen, deliberately different from the
       `dd MMM` on All Farms: a silence measured in weeks needs the year.
       Named in `DATE_FORMATS` rather than left a loose literal.

       The `never` branch is UNREACHABLE from this feed and is kept anyway: it
       is what a held-out row would render if one ever arrived, and its
       absence is what let the old screen print the word "Never" in a
       watchlist cell. */
    render: (f) =>
      fmt.date(f.lastLogAt, DATE_FORMATS.churnLastLog) ?? (
        <NotMeasured state="never" why={NO_LAST_LOG} />
      ),
    sortType: 'date',
    sortValue: (f) => f.lastLogAt,
    state: (f) => (f.lastLogAt ? null : 'never'),
    defaultDir: 'desc',
  },
];

/* ──────────────────────────────────────────────────────────── THE FACETS */

/**
 * The silence bands, in FIXED order — longest first, which is the order an
 * operator reads a watchlist in. `facetOptionsFrom` orders by count and is
 * therefore wrong here: a band row that reshuffled as the counts moved would
 * be unusable, and v3 fixes the same order for the same reason
 * (`silent-churn.html:266`, `BAND_ORDER`).
 *
 * The four bands cover the whole number line, so no row can fall outside all
 * of them and vanish from every count. `under-2` cannot occur today — the
 * matview's 14-day floor plus `GREATEST(1, …)` puts every row at 2 or more —
 * and it is carried for the same reason the `never` branch above is: a band
 * that silently drops rows is worse than a band that is empty.
 */
const BANDS: FacetOption<SilentChurnItem>[] = [
  { value: '8+', label: '8 weeks or more', test: (f) => f.weeksSilent >= 8 },
  { value: '5-7', label: '5 to 7 weeks', test: (f) => f.weeksSilent >= 5 && f.weeksSilent <= 7 },
  { value: '2-4', label: '2 to 4 weeks', test: (f) => f.weeksSilent >= 2 && f.weeksSilent <= 4 },
  { value: 'under-2', label: 'Under 2 weeks', test: (f) => f.weeksSilent < 2 },
];

/**
 * Both facets CROSS-FILTER their counts (Task 15 Step 5, and v3 does the same
 * here and on All Farms — `pass(f, g.key)`, `silent-churn.html:389`). The
 * number on a button is the number of rows you get by pressing it, which is
 * the right contract on a watchlist you are working THROUGH. Suffering (T16)
 * deliberately does the opposite, because there the count answers "how many
 * are there".
 *
 * A facet with fewer than two options is not shipped. One button holding
 * every row is a control that filters nothing — the reason Task 14 shipped no
 * facets at all on All Farms — and it is also what an empty `rows` produces
 * while the request is in flight.
 */
function facetsFor(rows: SilentChurnItem[]): FacetConfig<SilentChurnItem>[] {
  const band: FacetConfig<SilentChurnItem> = {
    key: 'band',
    label: 'By silence',
    crossFiltered: true,
    options: BANDS.filter((option) => rows.some(option.test)),
  };

  const plan: FacetConfig<SilentChurnItem> = {
    key: 'plan',
    label: 'By plan',
    crossFiltered: true,
    options: facetOptionsFrom(rows, (f) => f.plan?.trim()),
  };

  return [band, plan].filter((facet) => facet.options.length >= 2);
}

/* ────────────────────────────────────────────────────── THE EXPANDED ROW */

/** Every sentence is derived from a field on the row. Nothing here is typed
 *  prose about a farm, and nothing is a threshold this product has not set. */
function churnDetail(row: SilentChurnItem) {
  const weeks = fmt.num(row.weeksSilent) ?? String(row.weeksSilent);
  const lastLog = fmt.date(row.lastLogAt, DATE_FORMATS.churnLastLog);
  const plan = row.plan?.trim();

  return (
    <div className="flex flex-col gap-3">
      <p>
        Silent for {weeks} full {row.weeksSilent === 1 ? 'week' : 'weeks'}
        {plan ? ` on the ${plan} plan` : ''}
        {lastLog ? `. The last log landed ${lastLog}.` : `. ${NO_LAST_LOG}`} Weeks are counted in
        whole weeks from that date, so the true silence is that many weeks or a few days more.
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-caption">
        <dt className="text-text-3">Farm id</dt>
        {/* The identifier an operator files a ticket with, and the only value
            on the row that names no person. */}
        <dd className="tabular-nums text-text-2">{row.farmId}</dd>
        <dt className="text-text-3">Phone</dt>
        <dd className="text-text-2">
          <Masked value={ownerPhoneOf(row)} />
        </dd>
        {/*
         * TASK 15 STEP 4 — a true sentence this product has never said.
         *
         * We do not record outreach. Anywhere. So every expanded row reads
         * "Last contacted — not measured", and it is NOT softened into "no
         * recent contact" or "not contacted": both of those claim we looked.
         * An operator who reads "not contacted" and calls a farmer their
         * colleague phoned an hour ago has been misled by this console.
         */}
        <dt className="text-text-3">Last contacted</dt>
        <dd className="text-text-2">
          <NotMeasured why={NO_OUTREACH_RECORD} />
        </dd>
      </dl>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── THE SCREEN */

export default function SilentChurnPage() {
  const { data, isLoading, isFetching, isError, error, refetch } = useSilentChurn();

  /*
   * NO `keepPreviousDataWithinOrg` ON THIS HOOK, and that is correct rather
   * than an oversight (confirmed in Task 14). `keepPreviousData` exists to
   * hold the previous PAGE's rows while the next page loads; this endpoint
   * has no pages. Adding it here for symmetry with the paginated hooks would
   * buy nothing and would hold one organisation's watchlist on screen across
   * an org switch.
   */
  const items = data?.data ?? [];
  const lastRefreshed = metaRefreshedAt(data?.meta);

  /** Step 3. Before the summary, before the facets, before the sort. */
  const { watchlist, heldOut } = partitionSilentChurn(items);

  /**
   * NEVER `new Date()`. The window this list was checked over is the server's
   * own `meta.lastRefreshed` — computing one at render is the fabricated
   * freshness D5 records against `HomePage.tsx:18-19`.
   */
  const checkedAt =
    fmt.dateTime(lastRefreshed, DATE_FORMATS.usersLastLogin) ??
    'a time the server did not report';

  const longest = watchlist.reduce<number | null>(
    (worst, f) => (worst === null || f.weeksSilent > worst ? f.weeksSilent : worst),
    null,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <TrendingDown size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Silent Churn Watchlist
          </h1>
          {/* A57 — the rule, restated so it matches the query. See the file
              header for the three clauses that were false. */}
          <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
            Farms that have <b>gone quiet</b>: nobody has recorded anything on them for more than 14
            days, and they are still paying, still in a trial, or behind on payment &mdash; a
            trialing, active or past-due subscription. The quietest come first. The server sends
            50 farms and no more, so read this as today&rsquo;s call list rather than a total.
          </p>
        </div>
        <FreshnessChip source="materialized" lastRefreshed={lastRefreshed} />
      </div>

      <DataList<SilentChurnItem>
        id="silent-churn"
        label="Silent churn watchlist"
        caption="Farms that have stopped recording work, longest silence first, with the phone number to call, the plan, the number of whole silent weeks and the date of the most recent log. Select a row to open its detail."
        noun={{ one: 'farm', many: 'farms' }}
        /* The WATCHLIST, never `items`. A held-out farm is not on this list,
           is not in its count and is not in a facet total. */
        rows={watchlist}
        rowKey={(f) => f.farmId}
        columns={COLUMNS}
        /* No pagination — the endpoint has no pages (see the file header). */
        pagination={{ mode: 'none' }}
        facets={facetsFor(watchlist)}
        /* THE v3 SUMMARY-FIRST GATE STAYS HERE. Task 14 dropped it on All
           Farms because that screen has no facets to read first, so the gate
           would have hidden the table for no reason and added a click to
           every visit. This screen is a watchlist: how many farms have gone
           quiet and how long the worst one has been quiet ARE the answer, and
           the rows are the follow-up. */
        collapsible={{
          defaultOpen: false,
          summary: () => (
            <p>
              Longest silence{' '}
              {longest === null ? (
                <NotMeasured why="No farm on this list, so there is no longest silence." />
              ) : (
                <b>
                  {fmt.num(longest)} {longest === 1 ? 'week' : 'weeks'}
                </b>
              )}
              . Quiet acreage is not shown: this feed carries no land area.
            </p>
          ),
        }}
        defaultSort={{ key: 'weeksSilent', dir: 'desc' }}
        search={{
          /* CLIENT-side, and it can be: the whole answer is in hand, capped
             at 50 rows by the server. `searchHaystack` adds the romanised
             index, so a support worker who hears "Bhosale" on a call finds
             भोसले मळा. */
          mode: 'client',
          commit: 'submit',
          paramKey: 'search',
          placeholder: 'Search by farm name, phone or plan…',
          label: 'Search the watchlist',
          keys: (f) => [f.name, f.ownerPhone, digitsOf(ownerPhoneOf(f)) ?? '', f.plan, f.farmId],
          searchesOver:
            'Farm name, owner phone and plan. Village and crop are not in this feed, so they cannot be searched.',
        }}
        expand={churnDetail}
        states={{
          isLoading,
          isFetching,
          /* D9 — "No farms in silent churn" was rendered over a 500, a
             timeout and a 403 alike, and on THIS screen an unqualified empty
             reads as good news. */
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: 'No farm this feed returns has stopped logging',
            checkedAt,
          },
        }}
        /* B12 — shaped like the real thing: 5 columns. */
        skeleton={{ rows: 8, cells: 5 }}
      />

      {/* ── THE HOLD-OUT ────────────────────────────────────────────────
          Step 3's panel. It never prints a count, because the count is not
          measured — see the file header. When a held-out row does arrive it
          is named here, with the two values it genuinely has, and with no
          week number beside it. */}
      <NotMeasuredPanel
        title="Too new to judge"
        why={
          <>
            <p>
              A farm that has never logged has no last log to count back from, so its silence has no
              value at all. It is held out of the watchlist above rather than folded in as a long
              silence or flattened to zero weeks — those are different farmers, and one list cannot
              describe both.
            </p>
            <p className="mt-2">
              How many such farms there are is <b>not measured here</b>, and it is not zero: this
              feed cannot see them. The watchlist is built by joining farms to their most recent log
              and keeping the ones older than 14 days, so a farm with no log is dropped before the
              list is made. They are counted in a second table, <code>zero_engagement_farms</code>,
              which nothing in this console reads.
            </p>
            {heldOut.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {heldOut.map((f) => (
                  <li key={f.farmId} className="flex flex-wrap items-baseline gap-x-3">
                    <PersonName name={f.name} fallback={f.farmId} />
                    <Masked value={ownerPhoneOf(f)} />
                    <NotMeasured state="never" why={NO_LAST_LOG} />
                  </li>
                ))}
              </ul>
            )}
          </>
        }
      />

      <StandingNote
        title="What this screen cannot tell you"
        summary="Who has already been phoned. Nothing in the product records that, so this list cannot avoid repeat calls for you."
        why={
          <>
            <p>
              <b>Nowhere in this product records that somebody called a farmer.</b> This screen can
              tell you who has gone quiet. It cannot tell you who has already been rung about it,
              which is why every opened row says &ldquo;Last contacted &mdash; not
              measured&rdquo;. Read that as <b>we have no record of a call</b> &mdash; never as
              proof that nobody called. Those are different things, and only the first one is
              true here.
            </p>
            <p>
              The server also sends no village, no crop, no land area and no engagement level for
              these farms. So there is nothing to filter by, and the summary at the top cannot tell
              you how many acres have gone quiet.
            </p>
          </>
        }
      />
    </div>
  );
}
