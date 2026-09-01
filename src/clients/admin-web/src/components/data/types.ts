import type { ReactNode } from 'react';
import type { HonestState } from '@/components/state/honestState';
import type { SortDir } from '@/lib/useListUrlState';

/**
 * THE configuration surface for the ONE list component.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 * The live console hand-rolls table markup in SIXTEEN places. The v3
 * prototype duplicates its filter/sort/summary script across five screens —
 * measured on the prototype files 2026-08-31, the `<script>` line through the
 * `</script>` line inclusive:
 *
 *     all-farms.html     511      silent-churn.html  531
 *     api-errors.html    632      suffering.html     552
 *     users.html         549                        ────
 *                                                   2,775
 *
 * Neither travels. A screen supplies one of these objects and gets the
 * behaviour; it does not get to re-decide what a missing value sorts like.
 *
 * ── Nothing here is re-implemented ────────────────────────────────────────
 * `useListUrlState` (T7) owns the URL. `PersonName` / `searchKey` (T6) own
 * names and the romanised index. `fmt` (T4) owns every figure. The
 * honest-state vocabulary (T5) owns every absence. The token layer (T3) owns
 * every colour. This file adds a shape, not a second copy of any of them.
 */

/** How a column's values are compared. Text is case-insensitive, as v3
 *  (`app.js` `sortValue` lowercases before comparing). */
export type SortType = 'text' | 'num' | 'date';

/** What a column hands the sorter. `null`, `undefined` and `''` mean ABSENT. */
export type SortableValue = string | number | Date | null | undefined;

/** The leading-edge colours v3 allows on a row (`theme.css:485-490`). An edge
 *  marks the rows that need a person; on every row it is decoration. */
export type RowEdge = 'red' | 'amber' | 'blue' | 'green' | 'grey';

export interface DataListColumn<T> {
  /** Stable id. This is what lands in `?sort`, so renaming one breaks a
   *  shared link. It is not the label. */
  key: string;
  label: ReactNode;
  /** The cell. Render names through `PersonName`, figures through `fmt` and
   *  absences through `NotMeasured` — this component does not do it for you,
   *  because only the screen knows which of the four causes applies. */
  render: (row: T) => ReactNode;

  /**
   * SORTING. A column is sortable if and only if BOTH `sortType` and
   * `sortValue` are given. Supplying one without the other is a no-op rather
   * than an error: half a sort contract cannot be honoured safely.
   */
  sortType?: SortType;
  sortValue?: (row: T) => SortableValue;

  /**
   * The cell's honesty state, when it has one. A cell carrying a state sorts
   * as MISSING **even when it holds a number** — that is v3's rule
   * (`app.js` `sortValue`: `if (state && state !== 'ok') return {missing:true}`)
   * and it is the difference between "0 errors" and "we have no reading".
   *
   * Do NOT use this to report a real zero. A real 0 with no state sorts as a
   * real zero, and that distinction is the sort-order expression of the whole
   * redesign.
   */
  state?: (row: T) => HonestState | null | undefined;

  /**
   * PER-COLUMN DEFAULT DIRECTION (Preservation Register A30). The direction
   * this column opens in on its first click — `farmerName` ascending, `score`
   * descending (`InterventionQueueTable.tsx:67-70`).
   *
   * It lives here and not in `useListUrlState` on purpose: the hook has no
   * business knowing column names, so T7 takes the direction as an argument
   * and this is where that argument comes from. Defaults to `asc`.
   */
  defaultDir?: SortDir;

  /**
   * The tiebreak applied when two rows compare EQUAL on this column.
   *
   * The one that exists today: ties on `score` break by `lastActiveAt`
   * DESCENDING — worst farms with recent activity first
   * (`InterventionQueueTable.tsx:60-62`, DWC v2 §4.6 Step 1). It is a product
   * rule living in exactly one file, and it would not survive a rewrite.
   *
   * Return a normal comparator number. It is NOT flipped by the sort
   * direction: the live code applies it whenever the score column is the sort
   * column, in either direction, and that behaviour is preserved.
   */
  tiebreak?: (a: T, b: T) => number;

  align?: 'left' | 'right';
  /** Any CSS width, passed to the `<th>`. */
  width?: string;
  /** Render the header label for screen readers only — the actions column. */
  headerHidden?: boolean;
}

/* ─────────────────────────────────────────────────────────── pagination */

export interface ServerPagination {
  mode: 'server';
  /** 1-based. It comes from the screen, because the screen's QUERY needs it. */
  page: number;
  /** Farms 40, Users 50, API Errors 50 (Preservation Register A17). */
  pageSize: number;
  /**
   * The server's own total. This number is EXACT even though the client holds
   * one page — it is the one count on a paginated screen that may be stated
   * without a scope.
   */
  totalCount: number;
  onPage: (page: number) => void;
}

export type PaginationConfig = ServerPagination | { mode: 'none' };

/* ───────────────────────────────────────────────────────────── facets */

export interface FacetOption<T> {
  /** What lands in the URL. */
  value: string;
  /** The filter IN WORDS — "Grapes", "Mapped area differs from the land
   *  record". This is what the applied-filter chip says, so it has to read as
   *  English rather than as a query fragment. */
  label: string;
  test: (row: T) => boolean;
}

export interface FacetConfig<T> {
  /** The URL param this facet writes. */
  key: string;
  /** "By crop" — the group label. */
  label: string;
  /**
   * Fixed at build time and never reordered. v3 sorts options by how many
   * rows each holds ONCE, at load, and never moves them again: buttons that
   * reshuffle as you press them are unusable. `facetOptionsFrom` does that
   * ordering; a screen may also hand over a hand-ordered array.
   */
  options: FacetOption<T>[];

  /**
   * CROSS-FILTERED COUNTS ARE OPT-IN PER SCREEN.
   *
   * `true` — each option's count allows for the OTHER facets' selections, so
   * the number on a button is the number of rows you get by pressing it. v3
   * does this on All Farms and Silent Churn (both call `pass(row, group.key)`,
   * `all-farms.html:343`, `silent-churn.html:389`).
   *
   * `false` (the default) — the count answers "how many are there", full
   * stop. v3 deliberately does NOT cross-filter on Users, Suffering or API
   * Errors, where a count that moved would stop answering that question.
   * Verified 2026-08-31: `pass(` appears in all-farms.html and
   * silent-churn.html and in no other prototype screen.
   *
   * Either way a zero-yield option keeps its position and shows its 0.
   */
  crossFiltered?: boolean;

  /**
   * A second figure per option, computed over the rows that option would
   * yield — acreage on All Farms. Return `null` when the figure genuinely has
   * no value over that set; the button then says so instead of printing a 0.0
   * that would be a lie about the land.
   */
  side?: (rows: T[]) => string | null;
}

/* ───────────────────────────────────────────────────────────── search */

interface SearchBase {
  placeholder: string;
  /**
   * TWO COMMIT CONTRACTS, and they are not interchangeable (A21):
   *   `submit`        — draft state; the URL is written on Enter or on the
   *                     Search button. Farms and Users.
   *   `blur-or-enter` — uncontrolled and trimmed; the filter applies when you
   *                     leave the box as well as on Enter. API Errors.
   * Both are reachable from `useListUrlState`; neither is the default the
   * other collapses into.
   */
  commit: 'submit' | 'blur-or-enter';
  /** The URL param. `search` on Farms and Users, `endpoint` on API Errors. */
  paramKey?: string;
  /** What the box searches, in words, shown on the no-match state.
   *  v3: "Search runs over farm name, owner and phone." */
  searchesOver?: string;
  /** The accessible label for the input. Defaults to the list's label. */
  label?: string;
}

export type SearchConfig<T> =
  | (SearchBase & {
      /**
       * CLIENT-SIDE. The strings this row is findable by. The haystack is
       * built ONCE per row set and memoised — see `searchIndex.ts`, and read
       * the measured numbers there before changing anything. Keep this
       * function stable (module scope, or `useCallback`).
       */
      mode: 'client';
      keys: (row: T) => string[];
    })
  | (SearchBase & {
      /** SERVER-SIDE. The box writes the URL; the screen's own hook refetches.
       *  This component does not filter. */
      mode: 'server';
    });

/* ────────────────────────────────────────────────────────────── states */

export interface DataListStates {
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;

  /**
   * REQUIRED — deliberately stricter than the plan's sketch, which had it
   * optional.
   *
   * A list that renders an empty result has to say WHAT it looked for and
   * WHEN it looked. Without both, "nothing here" is indistinguishable from a
   * feed that died, which is the exact collapse this redesign exists to
   * remove. Every screen has `meta.lastRefreshed` to hand, so every screen
   * can answer it.
   *
   * `checkedAt` must arrive already formatted through `@/lib/format` — never
   * a raw ISO string, and never a `new Date()` computed at render, which is
   * the fabricated-freshness defect (D5).
   *
   * ── `unproven` — WHEN AN EMPTY ANSWER IS NOT A MEASUREMENT (added Task 17)
   * `MeasuredZero` ends with a fixed sentence: *"This is a measured zero, not
   * a missing feed."* On most screens that is exactly right and it is the
   * whole point of the block.
   *
   * On some it is FALSE, and the screen knows it. Three repository methods end
   * in a bare `catch { return []; }` (`AdminMisRepository.cs:219`, `:245`,
   * `:287`), so a dropped connection, a missing matview or a permission
   * failure on the database reaches the client as an empty list with HTTP 200.
   * Tasks 15 and 16 met that and could only add a footnote UNDER a block whose
   * headline sentence already contradicted it.
   *
   * Supply `unproven` and the empty branch renders a `NotMeasuredPanel` in the
   * same slot instead: `what` becomes its heading and `unproven` says why the
   * zero cannot be claimed as a reading. It is opt-in per screen — silence
   * keeps today's behaviour exactly, because on a screen whose feed cannot
   * swallow its own failure "measured zero" is the true and stronger claim.
   */
  measuredZero: { what: string; checkedAt: string; unproven?: ReactNode };

  /** The feed stopped. When present the rows are NOT rendered: v3 §6.3 says
   *  nothing below the line is current, and a table of yesterday under
   *  today's heading is the most damaging thing this console can do. */
  feedDown?: { since: string; lastGood?: string };
}

/* ─────────────────────────────────────────────────────────────── config */

export interface DataListConfig<T> {
  /** Namespaces the DOM ids this list generates and names its regions. It does
   *  NOT namespace URL params — `urlNamespace` does, deliberately separately,
   *  because a DOM id is free to change and a URL key is a shared link. */
  id: string;
  /**
   * Prefix for `page`, `sort`, `dir` and `open` in the URL (T7's `ns`).
   *
   * REQUIRED on a screen with more than one list, and forbidden anywhere else:
   * with it, Ops Live's three tables sort independently and a link restores
   * each to the table it belongs to; without it on a one-list screen, `?sort`
   * stays the plain key A18 registers and every already-shipped link keeps
   * working. Omitting it on a multi-list screen is not a cosmetic slip — one
   * header click reorders every table on the page.
   */
  urlNamespace?: string;
  /** The accessible name — "All farms". Used on the table, the search box and
   *  the loading announcement, so a page with several loading blocks does not
   *  produce several identical announcements. */
  label: string;
  /** An sr-only `<caption>` describing the columns and the row affordance.
   *  v3 gives every table one. */
  caption?: ReactNode;
  /** How to say "1 farm" and "16 farms". A console that prints "1 farms"
   *  looks unfinished, and half these nouns do not pluralise with an s. */
  noun: { one: string; many: string };

  rows: T[];
  rowKey: (row: T) => string;
  columns: DataListColumn<T>[];

  pagination?: PaginationConfig;
  facets?: FacetConfig<T>[];
  search?: SearchConfig<T>;

  /**
   * A FIXED, non-user-controllable order — a product decision, not a
   * preference (A31: the watchlist sorts by weeklyDelta ascending, biggest
   * drop first, and is deliberately not user-sortable).
   *
   * `because` is rendered on screen. An order the reader cannot change and
   * cannot explain is an order they will assume is arbitrary.
   */
  fixedSort?: { key: string; dir: SortDir; because: string };

  /** The order the list opens in when the URL says nothing. */
  defaultSort?: { key: string; dir: SortDir };

  /**
   * SUMMARY-FIRST. When present, the rows are hidden until the reader asks
   * for them — by choosing a filter, by pressing Show all, or by typing a
   * search. `summary` renders the screen's own figures beside the count line
   * this component computes.
   */
  collapsible?: { defaultOpen: boolean; summary?: (rows: T[]) => ReactNode };

  /** Expandable row detail — prose plus a definition list of context. */
  expand?: (row: T) => ReactNode;
  /** Row-action slot. Renders nothing unless a screen supplies actions (B15). */
  actions?: (row: T) => ReactNode;
  /** The leading edge, on the rows that need a person and on no others. */
  rowEdge?: (row: T) => RowEdge | null | undefined;

  states: DataListStates;

  /** Shaped like the real thing, not a generic spinner (B12): Farms is 8 rows
   *  by 7 cells today (`FarmsListPage.tsx:68-72`). */
  skeleton: { rows: number; cells: number };
}
