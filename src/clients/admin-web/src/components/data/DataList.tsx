import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { FeedDown, LoadFailed, MeasuredZero, NoMatch } from '@/components/state';
import { OPEN_KEY, SORT_DIR_KEY, SORT_KEY, useListUrlState } from '@/lib/useListUrlState';
import type { ParamValue, SortDir } from '@/lib/useListUrlState';
import { ExpandChevron, ExpandableRow } from './ExpandableRow';
import { Pager } from './Pager';
import { SortHeader } from './SortHeader';
import { FilterChip, SummaryFacets } from './SummaryFacets';
import {
  anyFacetApplied,
  appliedFacetWords,
  count,
  nounFor,
  passesFacets,
  scopedCount,
  selectRows,
} from './facets';
import type { FacetSelection } from './facets';
import { isSortable, sortRows } from './sortRows';
import { matchesQuery, useSearchIndex } from './searchIndex';
import type { DataListConfig } from './types';

/**
 * ONE LIST COMPONENT. From here on this is the only table in the console.
 *
 * ── What it retires ──────────────────────────────────────────────────────
 * Sixteen hand-rolled tables in the live console, and 2,775 lines of
 * duplicated filter/sort/summary script across five prototype screens
 * (measured — see `types.ts`). Founder pre-approved the consolidation.
 *
 * ── What it is built on, and does not re-implement ───────────────────────
 *   `useListUrlState` (T7)  every URL write, through the functional updater
 *   `searchKey` (T6)        the romanised index, memoised here per the
 *                           measured build cost
 *   the state vocabulary (T5)  four causes for an absence, never one
 *   `fmt` (T4)              every figure
 *   the token layer (T3)    every colour; no raw hex anywhere below
 *
 * ── NO SCREEN IS RE-POINTED IN THIS TASK ─────────────────────────────────
 * The sixteen hand-rolled tables are all still standing. They move onto this
 * component one screen at a time in Tasks 14-26, so a mechanical change can
 * never hide a behavioural one. That sequencing is why the build is still
 * green seven tasks in.
 *
 * ── URL STATE: ONE PRIMARY LIST PER SCREEN, TODAY ────────────────────────
 * Sort, open/closed and the facet selections live in the URL through T7,
 * whose param names (`page`, `sort`, `dir`, `open`) are module constants with
 * no namespace. TWO DataLists on ONE screen would therefore share them.
 *
 * Every screen this plan re-points in Tasks 14-18 has exactly one list, so
 * nothing collides today. **Ops Live (Task 20) has two tables** (A52: the
 * service-health panel plus the second Farmer Suffering watchlist) and will
 * need namespaced params — a small addition to T7, not a second copy of this
 * component. Recorded here rather than discovered there.
 *
 * ── THE TWO-WRITE TRAP ───────────────────────────────────────────────────
 * `setSearchParams` closes over the CURRENT render, so two `set()` calls in
 * one handler both build from the same pre-first-call snapshot and the second
 * silently clobbers the first (T7's file header, verified against
 * react-router 7.15). Several handlers below write two keys at once —
 * clearing the facets AND closing the list, choosing a facet AND opening it.
 * Every one of them goes through `setMany`. If you add a handler here, it
 * does too.
 */

/** The empty selection, hoisted so it is not a new object on every render. */
const NO_FACETS: FacetSelection = {};

export function DataList<T>(config: DataListConfig<T>) {
  const {
    id,
    label,
    caption,
    noun,
    rows,
    rowKey,
    columns,
    pagination = { mode: 'none' as const },
    facets = [],
    search,
    fixedSort,
    defaultSort,
    collapsible,
    expand,
    actions,
    rowEdge,
    states,
    skeleton,
  } = config;

  const searchParamKey = search?.paramKey ?? 'search';
  const url = useListUrlState({ draftKey: searchParamKey });

  const listId = `${id}-list`;
  const summaryFirst = !!collapsible;

  /* ── what the client is actually holding ──────────────────────────────
     `pageScoped` is the whole of the summary-vs-pagination resolution: it is
     true exactly when the client holds fewer rows than the server says exist,
     and it is what turns every count below into a count that states its
     scope. See `facets.ts` for the decision and the two rejected options. */
  const serverPaged = pagination.mode === 'server';
  const totalCount = serverPaged ? pagination.totalCount : rows.length;
  const pageScoped = serverPaged && pagination.totalCount > rows.length;
  const totalPages = serverPaged
    ? Math.max(1, Math.ceil(pagination.totalCount / Math.max(1, pagination.pageSize)))
    : 1;

  /* ── the reader's state, read back out of the URL ─────────────────────── */

  const selection: FacetSelection = facets.length
    ? Object.fromEntries(facets.map((facet) => [facet.key, url.get(facet.key)]))
    : NO_FACETS;
  const filtered = anyFacetApplied(selection);

  const query = url.get(searchParamKey) ?? '';
  const hasQuery = query.trim() !== '';
  const clientSearch = search?.mode === 'client';

  /**
   * `?open=1` SEEDS this on mount so a shared link opens the list, and every
   * change is written back so the next share carries it. It is state rather
   * than a pure read of the URL because T7's `setOpen(false)` DELETES the
   * param — which is right (a URL should not carry "not open"), but it means
   * the URL cannot express "closed" for a list whose `defaultOpen` is true.
   *
   * Consequence, stated rather than discovered: a browser Back that removes
   * `?open=1` does not re-close the list.
   */
  const [opened, setOpened] = useState(() => url.isOpen || (collapsible?.defaultOpen ?? false));

  /* THE THREE WAYS IN: a filter, Show all, or a typed search. Someone who has
     typed a name has already asked for rows. */
  const listOpen = !summaryFirst || opened || filtered || hasQuery;

  /* ── sorting ──────────────────────────────────────────────────────────── */

  const effectiveSortKey = fixedSort ? fixedSort.key : (url.sortKey ?? defaultSort?.key ?? null);
  const effectiveSortDir: SortDir = fixedSort
    ? fixedSort.dir
    : url.sortKey
      ? url.sortDir
      : (defaultSort?.dir ?? 'asc');
  const sortColumn = columns.find((column) => column.key === effectiveSortKey);

  /* ── the rows, in order ───────────────────────────────────────────────── */

  const index = useSearchIndex(rows, search?.mode === 'client' ? search.keys : undefined);

  /** Facets only — what the chip counts, as in v3's `selection()`. */
  const selectedRows = useMemo(
    () => selectRows(rows, facets, selection),
    [rows, facets, selection],
  );

  /** Facets AND search. Walked over `rows` by position so the memoised index
   *  stays aligned without a second lookup structure. */
  const visibleRows = useMemo(() => {
    const out: T[] = [];
    rows.forEach((row, i) => {
      if (facets.length && !passesFacets(row, facets, selection)) return;
      if (clientSearch && hasQuery && !matchesQuery(index[i] ?? '', query)) return;
      out.push(row);
    });
    return out;
  }, [rows, facets, selection, clientSearch, hasQuery, index, query]);

  const sorted = useMemo(
    () => sortRows(visibleRows, sortColumn, effectiveSortDir),
    [visibleRows, sortColumn, effectiveSortDir],
  );

  /* ── expansion ────────────────────────────────────────────────────────
     A row hidden by a filter is not rendered, so it cannot be open: that is
     the auto-collapse v3 does by hand. ONE deliberate divergence, stated —
     v3 also clears the flag, so a row that comes back after the search is
     cleared comes back CLOSED. Here it comes back as the reader left it. */
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());

  function toggleRow(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  /* ── writes. Every multi-key write goes through setMany. ──────────────── */

  const facetNulls: Record<string, ParamValue> = Object.fromEntries(
    facets.map((facet) => [facet.key, null]),
  );

  function chooseFacet(key: string, value: string) {
    const isOn = selection[key] === value;
    /* Two keys, one write. Choosing a filter also opens the list (v3:
       `if (chosen[g.key]) opened = true;`). Page resets to 1 — a filter
       change that leaves the reader on page 5 shows an empty list for a
       filter that matched (A20). */
    url.setMany({ [key]: isOn ? null : value, [OPEN_KEY]: '1' });
    setOpened(true);
  }

  /** The chip's close control, and the no-match block's. Back to the SUMMARY
   *  — not to a longer list. */
  function clearFacetsToSummary() {
    url.setMany({ ...facetNulls, [OPEN_KEY]: null });
    setOpened(false);
  }

  function clearSearch() {
    url.set(searchParamKey, null);
    url.setDraft('');
  }

  /** SHOW ALL is a true three-state control (v3 `all-farms.html`):
   *    filtered            -> "Show all N" : clears the filter, keeps the list
   *    open, not filtered  -> "Hide the list"
   *    closed              -> "Show all N" : opens it */
  function onShowAll() {
    if (filtered) {
      url.setMany({ ...facetNulls, [OPEN_KEY]: '1' });
      setOpened(true);
      return;
    }
    if (opened || hasQuery) {
      /* Hiding the list drops a search that may be holding it open too,
         otherwise the button reads "Hide the list", is pressed, and nothing
         moves. Two keys, one write. */
      url.setMany({ [searchParamKey]: null, [OPEN_KEY]: null }, { resetPage: false });
      url.setDraft('');
      setOpened(false);
      return;
    }
    url.set(OPEN_KEY, '1', { resetPage: false });
    setOpened(true);
  }

  /**
   * Sorting writes `sort` and `dir` together — two keys, one write — and does
   * NOT reset the page.
   *
   * It uses `setMany` rather than T7's `toggleSort` for one reason: the
   * effective sort may come from `defaultSort`, which is not in the URL at
   * all. `toggleSort` can only see the URL, so on the first click of the
   * already-sorted default column it would treat the column as new and adopt
   * its default direction instead of flipping — the reader would click a
   * sorted column and watch nothing move. The per-column default direction
   * (A30) is still supplied here, from the column, exactly as T7 intends.
   *
   * The page is deliberately kept: over a server-paginated list this sort
   * orders the rows in hand, so throwing the reader back to page 1 would lose
   * their place for no gain. The scope note below says so on screen.
   */
  function onSort(columnKey: string, defaultDir: SortDir) {
    const nextDir: SortDir =
      columnKey === effectiveSortKey ? (effectiveSortDir === 'asc' ? 'desc' : 'asc') : defaultDir;
    url.setMany({ [SORT_KEY]: columnKey, [SORT_DIR_KEY]: nextDir }, { resetPage: false });
  }

  /* ── the words ────────────────────────────────────────────────────────── */

  const facetWords = appliedFacetWords(facets, selection);

  const headline: ReactNode = pageScoped ? (
    <>
      <span>
        {count(totalCount)} {nounFor(totalCount, noun)}
      </span>
      <span className="font-normal text-text-3">·</span>
      <span>{count(rows.length)} on this page</span>
    </>
  ) : (
    <span>
      {count(rows.length)} {nounFor(rows.length, noun)}
    </span>
  );

  /** The row count above the table, replaced by "Refreshing…" on a BACKGROUND
   *  fetch only (A25, B13). The stricter Farmer Health variant
   *  (`FarmerHealthPage.tsx:87`) is the shared rule: a first load shows the
   *  skeleton, and only a poll shows the indicator. Without it a 30-second
   *  refetch changes the table under the reader with no explanation. */
  function rowCountLine(): ReactNode {
    if (states.isFetching && !states.isLoading) return <span>Refreshing&hellip;</span>;
    if (clientSearch && hasQuery) {
      return (
        <span>
          Showing <b>{count(sorted.length)}</b> of <b>{count(rows.length)}</b>{' '}
          {nounFor(rows.length, noun)} matching &ldquo;{query.trim()}&rdquo;
        </span>
      );
    }
    if (pageScoped) {
      return (
        <span>
          <b>{count(rows.length)}</b> of <b>{count(totalCount)}</b> {nounFor(totalCount, noun)}
        </span>
      );
    }
    return (
      <span>
        <b>{count(sorted.length)}</b> {nounFor(sorted.length, noun)}
      </span>
    );
  }

  /* ── the body: one state at a time ─────────────────────────────────────
     Precedence is deliberate. A filter is the reason there are no rows when
     one is applied, so the filter's block is the one that shows — v3 raises
     exactly this problem ("two messages stacked and two different Clear
     buttons") and solves it the same way. */

  const columnCount = columns.length + (actions ? 1 : 0);
  /**
   * A TYPED TERM IS A NO-MATCH WHOEVER APPLIED IT (fixed in Task 14, the first
   * screen port).
   *
   * This read `clientSearch && hasQuery`, which is right for a filter this
   * component applied and wrong for one the SERVER applied. Over a server-side
   * search the rows in hand ARE the server's answer to the query, so an empty
   * answer to `?search=भोसले` is "your term matched nothing" — and the old
   * condition sent it to `MeasuredZero`, which says in as many words: "The
   * window was checked at 14:02. This is a measured zero, not a missing feed."
   * That is a fact about the farms, stated over a fact about the box you typed
   * in, which is the exact collapse §6.1/§6.2 exist to prevent.
   *
   * Not simply `hasQuery`: a screen with no `search` config at all can still
   * carry an unrelated `?search=` in its url (a shared link, the command
   * palette's deep link landing on the wrong screen), and that must not turn
   * a genuine empty into a no-match.
   */
  const searched = !!search && hasQuery;
  const showNoMatch = !states.isLoading && !states.error && !states.feedDown && sorted.length === 0
    && (filtered || searched);
  const showMeasuredZero = !states.isLoading && !states.error && !states.feedDown
    && sorted.length === 0 && !showNoMatch;

  function body(): ReactNode {
    if (states.error) {
      return <LoadFailed error={states.error} onRetry={states.onRetry} what={label} />;
    }

    if (states.isLoading) {
      return (
        <div role="status" aria-busy="true" aria-label={`Loading ${label}`}>
          <span className="sr-only">Loading {label}</span>
          <table className="w-full">
            <tbody>
              {Array.from({ length: skeleton.rows }).map((_, r) => (
                <tr key={r} className="border-b border-line">
                  {Array.from({ length: skeleton.cells }).map((__, c) => (
                    <td key={c} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded-chip bg-wash" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    /* Nothing below a dead feed is current, so nothing below it is drawn. */
    if (states.feedDown) {
      return <FeedDown since={states.feedDown.since} lastGood={states.feedDown.lastGood} what={label} />;
    }

    if (showNoMatch) {
      const byFilter = filtered;
      return (
        <NoMatch
          filterInWords={byFilter ? facetWords.join(' · ') : `“${query.trim()}”`}
          searchesOver={byFilter ? undefined : search?.searchesOver}
          onClear={byFilter ? clearFacetsToSummary : clearSearch}
        />
      );
    }

    if (showMeasuredZero) {
      return (
        <MeasuredZero what={states.measuredZero.what} checkedAt={states.measuredZero.checkedAt} />
      );
    }

    return (
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse" aria-label={label}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) => (
                <SortHeader
                  key={column.key}
                  label={column.label}
                  align={column.align}
                  width={column.width}
                  headerHidden={column.headerHidden}
                  /* A fixed order is a product decision, not a preference, so
                     its headers are not controls at all (A31). */
                  sortable={!fixedSort && isSortable(column)}
                  active={column.key === effectiveSortKey}
                  dir={effectiveSortDir}
                  onSort={() => onSort(column.key, column.defaultDir ?? 'asc')}
                />
              ))}
              {actions && (
                <SortHeader
                  label="Actions"
                  headerHidden
                  sortable={false}
                  active={false}
                  dir="asc"
                  onSort={() => undefined}
                />
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const key = rowKey(row);
              const detail = expand?.(row);
              const isOpen = expandedKeys.has(key);
              return (
                <ExpandableRow
                  key={key}
                  detailId={`${id}-detail-${key}`}
                  expanded={isOpen}
                  onToggle={() => toggleRow(key)}
                  edge={rowEdge?.(row)}
                  colSpan={columnCount}
                  detail={detail}
                  cells={
                    <>
                      {columns.map((column, ci) => (
                        <td
                          key={column.key}
                          className={cn(
                            'h-13 px-4 py-2.5 align-middle text-[15px] text-text-1',
                            column.align === 'right' && 'text-right tabular-nums',
                          )}
                        >
                          {ci === 0 && detail !== undefined && <ExpandChevron open={isOpen} />}
                          {column.render(row)}
                        </td>
                      ))}
                      {actions && (
                        <td className="px-4 py-2.5 text-right align-middle">{actions(row)}</td>
                      )}
                    </>
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  /* ── the search box ───────────────────────────────────────────────────── */

  function searchBox(): ReactNode {
    if (!search) return null;
    const inputClass =
      'w-70 max-w-full rounded-chip border border-line bg-page px-3 py-2 text-[15px] text-text-1 placeholder:text-text-3';
    const inputLabel = search.label ?? `Search ${label}`;

    /* CONTRACT 2 — uncontrolled, trimmed, commits on blur AND Enter. API
       Errors. Making it controlled would change WHEN a filter applies, which
       is invisible in review and breaks the habit of an on-call engineer who
       types and tabs away (A21). */
    if (search.commit === 'blur-or-enter') {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            aria-label={inputLabel}
            placeholder={search.placeholder}
            className={inputClass}
            {...url.blurCommitInputProps(searchParamKey)}
          />
          {/* ONE clear at a time. When the no-match block is up it carries
              its own action, and two identically-named buttons doing two
              different things is the confusion v3 calls out. */}
          {hasQuery && !showNoMatch && (
            <Button variant="outline" size="sm" onClick={clearSearch}>
              Clear filter
            </Button>
          )}
        </div>
      );
    }

    /* CONTRACT 1 — draft state; the URL is written on Enter or the button and
       at no other moment. Syncing per keystroke would push one history entry
       and one server round trip per character, so Back would walk back
       through the word letter by letter. */
    return (
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          aria-label={inputLabel}
          placeholder={search.placeholder}
          className={inputClass}
          {...url.draftInputProps}
        />
        <Button variant="outline" size="sm" onClick={url.commitDraft}>
          <Search size={14} aria-hidden="true" /> Search
        </Button>
        {hasQuery && !showNoMatch && (
          <Button variant="outline" size="sm" onClick={clearSearch}>
            Clear filter
          </Button>
        )}
      </div>
    );
  }

  /* ── the chip ─────────────────────────────────────────────────────────── */

  const chipText = filtered
    ? [
        facetWords.join(' · '),
        selectedRows.length === 0
          ? `no ${noun.many}`
          : scopedCount(selectedRows.length, noun, pageScoped),
      ].join(' · ')
    : null;

  const showAllLabel =
    filtered || !listOpen
      ? `Show all ${scopedCount(rows.length, noun, pageScoped)}`
      : 'Hide the list';

  return (
    <div className="flex flex-col gap-4" data-list={id}>
      {searchBox()}

      {/* The facet rows render whenever a screen HAS facets. Summary-first —
          the headline figures and the Show all control — is the separate
          decision, and it is `collapsible` that makes it. A screen may filter
          without hiding its rows behind the filter. */}
      {(summaryFirst || facets.length > 0) && (
        <SummaryFacets
          id={id}
          rows={rows}
          facets={facets}
          selection={selection}
          onToggle={chooseFacet}
          noun={noun}
          pageScoped={pageScoped}
          headline={summaryFirst ? headline : undefined}
          summary={
            !summaryFirst ? undefined : (
            <>
              {collapsible?.summary?.(rows)}
              {pageScoped && (
                /* The scope, in words, once. Every facet count and the sort
                   order below cover the rows in hand; the total above comes
                   from the server and is exact. */
                <p className="mt-1 text-text-3">
                  The filter counts and the sort order cover the {count(rows.length)}{' '}
                  {nounFor(rows.length, noun)} on this page, not all {count(totalCount)}. Asking the
                  server for counts over the whole set is a separate change.
                </p>
              )}
            </>
            )
          }
          showAll={
            summaryFirst
              ? { label: showAllLabel, onClick: onShowAll, listId, listOpen }
              : undefined
          }
        />
      )}

      <div id={listId} hidden={!listOpen}>
        {listOpen && (
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-panel bg-page shadow-surface">
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
                {chipText && <FilterChip text={chipText} onClear={clearFacetsToSummary} />}
                {fixedSort && (
                  <span className="text-[13px] text-text-3">{fixedSort.because}</span>
                )}
                {/* No count beside a no-match block (it would count nothing)
                    and none beside a dead feed (it would describe rows that
                    are not being shown). */}
                {!showNoMatch && !states.feedDown && (
                  <span className="ml-auto text-[13px] text-text-2">{rowCountLine()}</span>
                )}
              </div>
              <div>{body()}</div>
            </div>

            {serverPaged && (
              <Pager
                page={pagination.page}
                totalPages={totalPages}
                onPage={pagination.onPage}
                label={`${label} pagination`}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
