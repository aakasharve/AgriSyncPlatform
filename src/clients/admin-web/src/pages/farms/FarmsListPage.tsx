import { Wheat } from 'lucide-react';
import { DataList } from '@/components/data';
import type { DataListColumn } from '@/components/data';
import { Masked, NotMeasured, NotMeasuredPanel } from '@/components/state';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { PersonName } from '@/components/ui/PersonName';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { useListUrlState } from '@/lib/useListUrlState';
import { cn } from '@/lib/utils';
import { useFarmsList } from '@/hooks/useFarms';
import type { FarmSummary } from '@/hooks/useFarms';

/**
 * ALL FARMS — the first screen to move onto `DataList`.
 *
 * Thirteen tasks built primitives and deliberately re-pointed no screen, so a
 * mechanical change could never hide a behavioural one. This is where that
 * debt is paid: the hand-rolled table, the hand-rolled pager, the hand-rolled
 * `setSearchParams` calls and the four direct `date-fns` calls are all gone,
 * and nothing below re-implements anything the shared layer already owns.
 *
 * ── WHAT SURVIVES EXACTLY ────────────────────────────────────────────────
 *  A17  server pagination at 40 per page, `?page` in the URL, `totalPages`
 *       derived from the SERVER's totalCount. The client never slices.
 *  A18  `?search` and `?tier` URL-synced.
 *  A20  the functional updater (never the object form, which drops `?org=`)
 *       and page reset to 1 on every filter change.
 *  A21  the search draft is NOT URL-synced until Enter or the Search button.
 *  A24  the AdminResponse envelope and `meta.lastRefreshed` behind the chip.
 *  A25  `keepPreviousData` (narrowed to the org in `lib/orgQuery.ts`) plus
 *       the "Refreshing…" swap that replaces the row count.
 *  A34  a Devanagari farm name renders in Noto Sans Devanagari — through
 *       `PersonName`, not a fifth copy of the script check.
 *  A51  the two per-surface date formats, now named in `DATE_FORMATS`
 *       instead of being loose literals here.
 *  B4   the pager, hidden when there is one page.
 *  B9   the tier A/B/C/D filter — a working SERVER-side capability with a UI
 *       control, which v3 does not have (its facets are crop, village, plan
 *       and land record, and tier is a column only).
 *  B12  a skeleton shaped like this table: 8 rows by 7 cells.
 *  B13  the background-fetch indicator.
 *  B16  every name through `PersonName` and every phone through `Masked`.
 *
 * ── THE FOUR DEFECTS THIS SCREEN CARRIED ─────────────────────────────────
 *  D11  THE DEAD ROW-CLICK. The old line 77 navigated to `/farms/:farmId`,
 *       which is NOT a registered route (`App.tsx:293-299` declares `/farms`,
 *       `/farms/silent-churn` and `/farms/suffering` and nothing else), so
 *       every click fell through the catch-all (`App.tsx`, `<Navigate to="/"
 *       replace/>`) and bounced silently to Home — under a table styled
 *       `cursor-pointer` on every row. Replaced by `DataList`'s expandable
 *       row: the pointer now belongs to something that happens.
 *
 *  THE OWNER COLUMN. Header "Owner", cell `{f.ownerPhone}` — see the note on
 *  `OWNER_COLUMN` below. There is no owner NAME to render, so the header is
 *  what changed.
 *
 *  THE REDACTION MARKER. `{f.name}` and `{f.ownerPhone}` were rendered raw,
 *  so a withheld value would have printed the literal `**redacted**` into a
 *  cell. Both now go through the components that treat a withheld value as a
 *  permission fact rather than as a string.
 *
 *  THE UNTRIMMED SEARCH. Fixed in `useListUrlState` (T7) so it lands on every
 *  screen that uses the draft contract, rather than here for one of them.
 *
 * ── ONE MORE, NOT IN THE PLAN ────────────────────────────────────────────
 * `{f.errors24h||'—'}` printed an em dash for a MEASURED ZERO — the D18
 * defect pointing the other way. Zero errors in the last 24 hours is a
 * reading, and it now says 0.
 */

/**
 * WHAT THIS FEED ACTUALLY CARRIES, measured in the repo on 2026-09-01 —
 * `FarmSummaryDto` (`FarmsAdminDto.cs:9-18`) and the SQL behind it
 * (`AdminMisRepository.cs:100-138`).
 *
 * It matters because v3's four filter rows are crop, village, plan and land
 * record, and THREE OF THOSE FIELDS DO NOT EXIST on this endpoint. The
 * fourth, `plan`, is the SQL literal `'trial'` on every row
 * (`AdminMisRepository.cs:108`), so a "By plan" filter would offer one option
 * holding 100% of the rows — a control that filters nothing.
 *
 * So this screen ships NO `facets`. Building them would mean either inventing
 * the data or shipping four buttons that do nothing, and the second is the
 * exact class of lie the redesign exists to remove. The gap is stated on
 * screen (`WHAT_IS_MISSING` below) rather than left for a reader to discover
 * by looking for a filter that is not there.
 */

/** 40 per page. The server's ceiling is 200 and its floor is 10
 *  (`AdminEndpoints.cs:187`, `Math.Clamp(pageSize, 10, 200)`). */
const PAGE_SIZE = 40;

const TIERS = ['A', 'B', 'C', 'D'] as const;

/** v3 `theme.css:547-550`, on our token layer. Tint background, signal ink;
 *  no raw hex, and none of the four vivid fills — those are bars and dots
 *  only (globals.css §A.5). */
const TIER_CLASS: Record<string, string> = {
  A: 'bg-tint-green text-green',
  B: 'bg-tint-blue text-blue',
  C: 'bg-tint-amber text-amber',
  D: 'bg-tint-red text-red',
};

/**
 * The owner phone, or the ABSENCE it stands for.
 *
 * The query COALESCEs a missing owner phone to the literal em dash
 * (`AdminMisRepository.cs:107`, `COALESCE(u.phone, '—')`) and the reader does
 * it a second time for a null column (`:136`, `r.IsDBNull(2) ? "—"`). A bare
 * dash is the one thing `NotMeasured` exists to forbid — the reader supplies
 * the reason, and the reason they supply is usually "zero". Turning the
 * sentinel back into `null` here is what lets `Masked` say "— not measured"
 * instead of printing a character that means nothing on its own.
 */
const NO_PHONE_SENTINEL = '—';
function ownerPhoneOf(farm: FarmSummary): string | null {
  const value = farm.ownerPhone?.trim();
  return !value || value === NO_PHONE_SENTINEL ? null : value;
}

/**
 * Why a blank tier and a blank WVFD are not a D tier and not a zero.
 *
 * Stated from the SQL rather than from v3's copy. The prototype says the farm
 * is too young; what the query actually says is narrower and provable: tier
 * and WVFD come from a LEFT JOIN onto the most recent week in
 * `mis.wvfd_weekly` (`AdminMisRepository.cs:115-116`), so a farm with no row
 * in THAT week has neither. Too young is one way to have no row; it is not
 * the only one, and asserting it would be inventing a cause.
 */
const NO_WEEKLY_ROW =
  'No row in the most recent week of the WVFD aggregate, so there is no tier and no score to show. That is not a D tier and it is not a zero.';

const NEVER_LOGGED = 'No log has been recorded on this farm.';

/**
 * THE OWNER COLUMN — and the one place this task could not do what the plan
 * asked.
 *
 * The plan (Task 14 Step 4) and CONTRACT.md Appendix 6 both say the header
 * reads "Owner" while the cell renders the owner's phone, and both say the
 * fix is v3's version: the owner's NAME, with the phone as a sub-line.
 *
 * THE NAME IS NOT IN THE PAYLOAD. `FarmSummaryDto` carries `Name` (the
 * FARM's name) and `OwnerPhone`, and the query selects `u.phone` and no other
 * column from `public.users` (`AdminMisRepository.cs:105-118`). There is
 * nothing to route through `PersonName` in this cell.
 *
 * Two ways to stop a header claiming something the cell does not deliver:
 * change the cell, or change the header. Only the second is available without
 * widening a DTO, and widening a DTO is a backend change this plan explicitly
 * does not make ("Change Surface — Backend: no backend changes").
 *
 * So the header says "Owner phone". It is one word longer and it is true.
 * Restoring v3's name-over-phone cell needs `FarmSummaryDto` to gain the
 * owner's display name; that is a separate plan with its own spec, and it is
 * recorded rather than quietly dropped.
 *
 * `PersonName` is not unused on this screen: a farm in this product is named
 * for its farmer and is very often written in Devanagari, which is why the
 * command palette already renders `farm.name` through it
 * (`CommandPalette.tsx:365`). The Farm column does the same.
 */
const COLUMNS: DataListColumn<FarmSummary>[] = [
  {
    key: 'farm',
    label: 'Farm',
    render: (f) => <PersonName name={f.name} fallback={f.farmId} />,
    sortType: 'text',
    /* A withheld name sorts as ABSENT rather than under `*`. Clustering every
       redacted farm together at the top of an A-Z sort would be an ordering
       derived from the permission, not from the data. */
    sortValue: (f) => (f.name === '**redacted**' ? null : f.name),
    defaultDir: 'asc',
  },
  {
    key: 'owner',
    label: 'Owner phone',
    render: (f) => <Masked value={ownerPhoneOf(f)} />,
    sortType: 'text',
    sortValue: (f) => ownerPhoneOf(f),
    defaultDir: 'asc',
  },
  {
    key: 'tier',
    label: 'Tier',
    render: (f) =>
      f.engagementTier ? (
        <span
          data-tier={f.engagementTier}
          className={cn(
            'inline-grid size-[26px] place-items-center rounded-chip text-[14px] font-semibold',
            TIER_CLASS[f.engagementTier] ?? 'bg-tint-grey text-text-2',
          )}
        >
          {f.engagementTier}
        </span>
      ) : (
        <NotMeasured why={NO_WEEKLY_ROW} />
      ),
    sortType: 'text',
    sortValue: (f) => f.engagementTier,
    /* The state is what makes an absent tier park at the bottom in BOTH
       directions instead of sorting as an empty string. */
    state: (f) => (f.engagementTier ? null : 'unmeasured'),
    defaultDir: 'asc',
  },
  {
    key: 'wvfd7d',
    label: 'WVFD 7d',
    align: 'right',
    render: (f) => fmt.num(f.wvfd7d, 1) ?? <NotMeasured why={NO_WEEKLY_ROW} />,
    sortType: 'num',
    sortValue: (f) => f.wvfd7d,
    state: (f) => (f.wvfd7d === null ? 'unmeasured' : null),
    /* Worst-first is the reading an operator wants on a score column (A30's
       rule, applied to this screen's own score). */
    defaultDir: 'desc',
  },
  {
    key: 'errors24h',
    label: 'Errors 24h',
    align: 'right',
    /* NO honesty state: this is a COUNT, and 0 is a reading. `{f.errors24h ||
       '—'}` used to print a dash over a measured zero, which is D18 pointing
       the other way — it made "we checked and found none" look like "we have
       no reading". */
    render: (f) => (
      <span className={cn(f.errors24h > 0 && 'font-semibold text-red')}>
        {fmt.num(f.errors24h)}
      </span>
    ),
    sortType: 'num',
    sortValue: (f) => f.errors24h,
    defaultDir: 'desc',
  },
  {
    key: 'lastLog',
    label: 'Last Log',
    /* A51: day + month here, two-digit year on Created, and they differ on
       purpose. Both now come from `DATE_FORMATS` rather than from two loose
       `format()` literals in this file. */
    render: (f) =>
      fmt.date(f.lastLogAt, DATE_FORMATS.farmsLastLog) ?? (
        <NotMeasured state="never" why={NEVER_LOGGED} />
      ),
    sortType: 'date',
    sortValue: (f) => f.lastLogAt,
    state: (f) => (f.lastLogAt ? null : 'never'),
    defaultDir: 'desc',
  },
  {
    key: 'created',
    label: 'Created',
    render: (f) => fmt.date(f.createdAt, DATE_FORMATS.farmsCreated) ?? <NotMeasured />,
    sortType: 'date',
    sortValue: (f) => f.createdAt,
    defaultDir: 'desc',
  },
];

/** The expandable-row detail (D11's replacement). Every sentence is derived
 *  from a field on the row — nothing here is typed prose about a farm. */
function farmDetail(farm: FarmSummary, checkedAt: string) {
  const errors = fmt.num(farm.errors24h) ?? String(farm.errors24h);
  const lastLog = fmt.date(farm.lastLogAt, DATE_FORMATS.churnLastLog);

  return (
    <div className="flex flex-col gap-3">
      <p>
        {farm.errors24h > 0
          ? `${errors} ${farm.errors24h === 1 ? 'error' : 'errors'} on this farm in the last 24 hours.`
          : `No API error on this farm in the last 24 hours. The window was checked at ${checkedAt}, so this is a measured zero, not a missing feed.`}{' '}
        {lastLog ? `Last log ${lastLog}.` : NEVER_LOGGED}{' '}
        {farm.engagementTier === null || farm.wvfd7d === null ? NO_WEEKLY_ROW : ''}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-[13px]">
        <dt className="text-text-3">Farm id</dt>
        {/* The identifier an operator files a ticket with, and the only value
            on the row that names no person. */}
        <dd className="tabular-nums text-text-2">{farm.farmId}</dd>
        <dt className="text-text-3">Owner phone</dt>
        <dd className="text-text-2">
          <Masked value={ownerPhoneOf(farm)} />
        </dd>
      </dl>
    </div>
  );
}

export default function FarmsListPage() {
  /**
   * The screen's OWN url state — `?page` and `?tier`. `DataList` runs its own
   * instance of this hook for `?search`, `?sort`, `?dir`; both read the same
   * router params and both write through the same functional updater, which
   * is the only reason two instances are safe.
   *
   * `?tier` cannot be a `DataList` facet. A facet is a CLIENT-side predicate
   * over the rows in hand; tier is a SERVER-side filter that changes the
   * query, the row set AND `totalCount` (`AdminMisRepository.cs:104`). Making
   * it a facet would filter forty rows and call the answer a total.
   */
  const url = useListUrlState();
  const page = url.page;
  const tier = url.get('tier') ?? undefined;
  const search = url.get('search') ?? undefined;

  const { data, isLoading, isFetching, isError, error, refetch } = useFarmsList(
    page,
    PAGE_SIZE,
    search,
    tier,
  );

  const items = data?.data?.items ?? [];
  const totalCount = data?.data?.totalCount ?? 0;
  const lastRefreshed = data?.meta?.lastRefreshed;

  /**
   * NEVER `new Date()`. The checked-at time is the server's own
   * `meta.lastRefreshed`; computing one here is exactly the fabricated
   * freshness D5 records (`HomePage.tsx:18-19`). When the server sends none
   * we say so rather than filling the gap.
   */
  const checkedAt =
    fmt.dateTime(lastRefreshed, DATE_FORMATS.usersLastLogin) ??
    'a time the server did not report';

  /** True when the client is holding one page of a larger set. */
  const pageScoped = totalCount > items.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.01em] text-text-1">
            <Wheat size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            All Farms
          </h1>
          <p className="mt-1 text-[15px] text-text-2">
            Every farm in this organisation, with the figures this console actually measures — and
            a grey em dash wherever it does not measure one.
          </p>
        </div>
        <FreshnessChip source="live-aggregated" lastRefreshed={lastRefreshed} />
      </div>

      {/* ── the tier filter (B9) ────────────────────────────────────────────
          Kept as a screen control rather than a facet, for the reason in the
          `url` note above. It is laid out like a `SummaryFacets` row so the
          two read as the same kind of thing, and the counts a facet would
          carry are deliberately absent: the server has not been asked how many
          farms are in each tier, and a number this screen cannot prove is a
          number it does not print. */}
      <div
        role="group"
        aria-label="Filter by tier"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-4"
      >
        <span className="w-24 flex-none text-[13px] font-semibold text-text-2">By tier</span>
        <div className="flex flex-wrap gap-2">
          {TIERS.map((t) => {
            const pressed = tier === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={pressed}
                /* A20 — `toggle` writes `tier` and resets `page` in ONE
                   functional update, so `?org=` survives and the reader is
                   not left on page 5 of a filter that matched three rows. */
                onClick={() => url.toggle('tier', t)}
                className={cn(
                  'rounded-full border px-3 py-2 text-[15px]',
                  pressed
                    ? cn('border-transparent font-semibold', TIER_CLASS[t])
                    : 'border-line bg-page text-text-1 hover:bg-wash',
                )}
              >
                Tier {t}
              </button>
            );
          })}
        </div>
        <span className="text-[13px] text-text-3">
          Applied by the server over every farm, not just this page.
        </span>
      </div>

      {pageScoped && (
        /* The scope of the SORT, said once. Over a server-paginated list a
           column sort orders the rows in hand; the total above it comes from
           the server and is exact. Saying neither would leave a reader to
           assume the first row is the worst farm on the platform. */
        <p className="text-[13px] text-text-3">
          Sorting a column orders the {fmt.num(items.length)} farms on this page, not all{' '}
          {fmt.num(totalCount)}.
        </p>
      )}

      <DataList<FarmSummary>
        id="farms"
        label="All farms"
        caption="Every farm with its owner phone, engagement tier, weekly verified farm-days, errors in the last 24 hours, most recent log and creation date. Select a row to open its detail."
        noun={{ one: 'farm', many: 'farms' }}
        rows={items}
        rowKey={(f) => f.farmId}
        columns={COLUMNS}
        /* A17 / B4 — the page count comes from the SERVER's totalCount. The
           client holds forty rows and never slices a full set; loading every
           farm to filter it here would be a self-inflicted outage on a 2-vCPU
           box with a measured ceiling of about 32 concurrent requests. */
        pagination={{
          mode: 'server',
          page,
          pageSize: PAGE_SIZE,
          totalCount,
          onPage: url.setPage,
        }}
        search={{
          mode: 'server',
          /* A21 — draft state; the URL is written on Enter or the Search
             button and at no other moment. */
          commit: 'submit',
          paramKey: 'search',
          placeholder: 'Search by farm name…',
          label: 'Search farms',
          /* The truth about the box, from the query behind it: the WHERE
             clause is `LOWER(f.name) LIKE LOWER(@s)` and nothing else
             (`AdminMisRepository.cs:95,103`). v3's copy promises owner and
             phone as well; this endpoint does not search either, and the
             command palette's phone deep link lands here (`/farms?search=
             <phone>`, `CommandPalette.tsx:371`) and finds nothing for exactly
             that reason. */
          searchesOver:
            'The server matches the farm name only — the owner and the phone number are not searched.',
        }}
        /* v3's rule, unchanged: the leading edge marks the rows whose app
           failed on the farmer today, and it points at a number already
           coloured beside it, so it needs no key. */
        rowEdge={(f) => (f.errors24h > 0 ? 'red' : null)}
        expand={(f) => farmDetail(f, checkedAt)}
        states={{
          isLoading,
          isFetching,
          /* D9 — a 500, a timeout and a 403 used to render as "No farms
             found". `isError` appears in three files in the whole console;
             this screen was not one of them. */
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: tier
              ? `No farm in this organisation is in tier ${tier}`
              : 'No farms in this organisation',
            checkedAt,
          },
        }}
        /* B12 — shaped like the real thing: 8 rows by 7 cells, which is what
           this table is. */
        skeleton={{ rows: 8, cells: 7 }}
      />

      <NotMeasuredPanel
        title="What this list does not carry"
        why={
          <>
            The farms feed returns farm name, owner phone, engagement tier, WVFD 7d, errors in the
            last 24 hours, last log and created date, and nothing else. Village, crop, plots and
            land-record area are not in it, so this screen has no filters for them; the plan field
            it does return is the literal <code>trial</code> on every row, so there is no plan
            filter either. The owner&apos;s name is not in it, which is why that column is headed by
            the phone number.
          </>
        }
      />
    </div>
  );
}
