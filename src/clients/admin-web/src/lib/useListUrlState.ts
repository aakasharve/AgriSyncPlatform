import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * THE URL-state hook for every list screen. There is exactly one, and this is it.
 *
 * ── The rule this file exists to enforce ──────────────────────────────────
 * EVERY write goes through the FUNCTIONAL updater form of `setSearchParams`.
 * Always. There is no object-form escape hatch, and that is deliberate: this
 * hook never returns `setSearchParams` itself, so no call site can reach the
 * dangerous call even by accident.
 *
 * Passing a plain object to `setSearchParams` REPLACES the whole query string.
 * The param it silently drops is `org` — and `org` is not decoration, it is
 * the active tenant (`ActiveOrgProvider.tsx:39-44`, read back on mount, and
 * stamped onto every request as `X-Active-Org-Id` by `lib/api.ts:17-20`).
 * So a filter change written the wrong way is not a cosmetic bug: on the next
 * refresh, or for whoever the link was shared with, it is one organisation's
 * data read under another organisation's scope. It survives code review, it
 * survives a screenshot, and it surfaces weeks later as "the numbers look
 * wrong". Preservation Register A20.
 *
 * The six pages that write URL state today all get this right by hand:
 *   FarmsListPage.tsx:26-28 · UsersPage.tsx:22-23 · OpsErrorsPage.tsx:81-86
 *   OpsVoicePage.tsx:29-31  · NorthStarPage.tsx:34-36
 * Getting it right by hand six times is not a guarantee; it is six chances.
 *
 * ── Why `setMany` exists (verified, not defensive) ────────────────────────
 * React Router 7.15's `setSearchParams` is a `useCallback` closing over the
 * CURRENT render's `searchParams` (react-router/dist/development/chunk-4N6VE7H7.mjs,
 * `useSearchParams`). Two `set()` calls in one event handler therefore both
 * build from the SAME pre-first-call snapshot, and the second silently
 * clobbers the first. If you need to write two keys at once, `setMany` is
 * the only correct way to do it.
 *
 * ── What this hook does NOT do ────────────────────────────────────────────
 * It does not re-point the six pages. They move onto it screen by screen in
 * Tasks 14-26, so a mechanical change can never hide a behavioural one.
 *
 * ── The other half of the hole, CLOSED IN TASK 12 ────────────────────────
 * The functional form cannot preserve a parameter the router never saw, and
 * until Task 12 the org was exactly that: `ActiveOrgProvider` wrote `?org=`
 * with a raw `window.history.replaceState`, so the router's `location.search`
 * — the value `prev` below is built from — could be one org behind the address
 * bar. Step 2 moved that write onto `useSearchParams`. `prev` now always
 * contains the org, and preserving it is the same rule as preserving anything
 * else, not a special case.
 *
 * `tenancyRouting.contract.test.tsx` proves it end to end: switch organisation
 * in the topbar, then change a filter on a real list screen, and the url still
 * names the organisation. That is the assertion no unit test on this hook can
 * make, because the writer was never the bug.
 */

/** `?page` — 1-based, server-side pagination on Farms (40), Users (50), API Errors (50). */
export const PAGE_KEY = 'page';
/** `?sort` — the sort column. NEW in the port: sort dies on refresh today (`InterventionQueueTable.tsx:44-45`). */
export const SORT_KEY = 'sort';
/** `?dir` — `asc` | `desc`. Anything else reads as `asc`. */
export const SORT_DIR_KEY = 'dir';
/** `?open=1` — the summary-first list is expanded. Absent means collapsed, which is the v3 default. */
export const OPEN_KEY = 'open';

/**
 * Params this hook will never delete, not even on `reset()`.
 *
 * `org` is the active tenant. "Clear all filters" clearing the tenant is the
 * same bug as the object form, arriving through a button instead of a typo.
 */
const PRESERVED_KEYS = new Set(['org']);

export type SortDir = 'asc' | 'desc';

/** What `set`/`setMany` accept. `null`, `undefined` and `''` all mean "delete this key". */
export type ParamValue = string | number | null | undefined;

export interface WriteOptions {
  /**
   * Reset `?page` to 1 (A20). Defaults to true for every key except `page`
   * itself. Without it a user filters down to 3 results, stays on page 5,
   * and is shown an empty list for a filter that matched.
   */
  resetPage?: boolean;
}

export interface UseListUrlStateOptions {
  /**
   * The param the draft input commits into. `search` on Farms and Users.
   * One draft per screen — every screen that has one today has exactly one.
   */
  draftKey?: string;
}

/** Props for a CONTROLLED input that writes the URL only on Enter. See `draftInputProps`. */
export interface DraftInputProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

/** Props for an UNCONTROLLED input that commits on blur AND Enter. See `blurCommitInputProps`. */
export interface BlurCommitInputProps {
  defaultValue: string;
  onBlur: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export interface ListUrlState {
  /** The live params. Read-only by convention — write through `set`/`setMany`/`reset`. */
  params: URLSearchParams;
  /** `params.get(key)`, spelled out so a call site never needs `params` for a read. */
  get: (key: string) => string | null;
  /** `?page` as a number. Junk or missing reads as 1 — never NaN, never 0. */
  page: number;
  /** `?sort`, or null when the caller's own default applies. */
  sortKey: string | null;
  /** `?dir`. Missing or unrecognised reads as `asc`. */
  sortDir: SortDir;
  /** `?open=1`. */
  isOpen: boolean;

  set: (key: string, value: ParamValue, opts?: WriteOptions) => void;
  setMany: (entries: Record<string, ParamValue>, opts?: WriteOptions) => void;
  /** Set when different, delete when it already equals `value`. The tier chips (`FarmsListPage.tsx:27`). */
  toggle: (key: string, value: string) => void;
  setPage: (page: number) => void;
  setSort: (key: string | null, dir?: SortDir) => void;
  /**
   * Flip direction on the active column, otherwise switch column and adopt
   * `defaultDir`. The per-column default direction table stays at the call
   * site — this hook has no business knowing that `farmerName` opens ascending
   * and `score` opens descending (`InterventionQueueTable.tsx:67-70`, A30).
   */
  toggleSort: (key: string, defaultDir?: SortDir) => void;
  setOpen: (open: boolean) => void;
  /** Clear every filter, sort and page. Keeps `org` (see PRESERVED_KEYS). */
  reset: () => void;

  /** Local, uncommitted text. NOT in the URL until `commitDraft`. */
  draft: string;
  setDraft: (value: string) => void;
  /** Write the draft to `?<draftKey>`. Enter, or the Search button. */
  commitDraft: () => void;
  draftInputProps: DraftInputProps;
  blurCommitInputProps: (key: string) => BlurCommitInputProps;
}

function applyOne(next: URLSearchParams, key: string, value: ParamValue): void {
  const v = value === null || value === undefined ? '' : String(value);
  if (v === '') next.delete(key);
  else next.set(key, v);
}

/**
 * TWO COMMIT CONTRACTS. They look identical in a screenshot and they are not
 * the same product behaviour. Both are reachable from this hook, and neither
 * is the default the other collapses into (Preservation Register A21).
 *
 *  1. DRAFT + EXPLICIT COMMIT — `draft` / `setDraft` / `commitDraft` /
 *     `draftInputProps`. Farms and Users. Typing is local state; the URL is
 *     written on Enter or the Search button and at no other moment. Syncing
 *     per keystroke would push one history entry and one server round trip
 *     per character, so Back would walk back through the word letter by
 *     letter (`FarmsListPage.tsx:19,41-45`, `UsersPage.tsx:15,36-40`).
 *
 *  2. BLUR OR ENTER, TRIMMED — `blurCommitInputProps`. API Errors. The input
 *     is UNCONTROLLED (`defaultValue`), and the filter applies when you leave
 *     the box as well as when you press Enter, with the value trimmed
 *     (`OpsErrorsPage.tsx:103-115`). Making it controlled would change WHEN a
 *     filter applies — invisible in review, and it would quietly break the
 *     habit of an on-call engineer who types and tabs away.
 *
 * Two deliberate asymmetries carried over from the live console rather than
 * silently "improved", because both change observable behaviour:
 *  - Contract 1 does NOT trim; contract 2 does. Only API Errors trims today.
 *  - Neither input re-syncs from the URL after mount, so Back (or the Clear
 *    filter button) leaves the last typed text in the box while the applied
 *    filter has changed underneath it. That is today's behaviour on all three
 *    screens; changing it is a founder call, not an implementation detail.
 */
export function useListUrlState(options: UseListUrlStateOptions = {}): ListUrlState {
  const draftKey = options.draftKey ?? 'search';
  const [params, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState(() => params.get(draftKey) ?? '');

  /**
   * The single write path. `prev` is a fresh copy React Router hands us, so
   * mutating it is safe; returning it keeps every untouched param — `org`
   * above all — exactly where it was.
   */
  const write = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setSearchParams((prev) => {
        mutate(prev);
        return prev;
      });
    },
    [setSearchParams],
  );

  const set = useCallback<ListUrlState['set']>(
    (key, value, opts) => {
      write((next) => {
        applyOne(next, key, value);
        if (opts?.resetPage !== false && key !== PAGE_KEY) next.set(PAGE_KEY, '1');
      });
    },
    [write],
  );

  const setMany = useCallback<ListUrlState['setMany']>(
    (entries, opts) => {
      write((next) => {
        const keys = Object.keys(entries);
        for (const key of keys) applyOne(next, key, entries[key]);
        const touchedAFilter = keys.some((k) => k !== PAGE_KEY);
        if (opts?.resetPage !== false && touchedAFilter && !keys.includes(PAGE_KEY)) {
          next.set(PAGE_KEY, '1');
        }
      });
    },
    [write],
  );

  const setPage = useCallback<ListUrlState['setPage']>(
    (page) => set(PAGE_KEY, String(Math.max(1, Math.trunc(page) || 1))),
    [set],
  );

  const toggle = useCallback<ListUrlState['toggle']>(
    (key, value) => {
      write((next) => {
        if (next.get(key) === value) next.delete(key);
        else next.set(key, value);
        next.set(PAGE_KEY, '1');
      });
    },
    [write],
  );

  const sortKey = params.get(SORT_KEY);
  const sortDir: SortDir = params.get(SORT_DIR_KEY) === 'desc' ? 'desc' : 'asc';

  const setSort = useCallback<ListUrlState['setSort']>(
    (key, dir = 'asc') => setMany({ [SORT_KEY]: key, [SORT_DIR_KEY]: key ? dir : null }),
    [setMany],
  );

  const toggleSort = useCallback<ListUrlState['toggleSort']>(
    (key, defaultDir = 'asc') => {
      write((next) => {
        const currentKey = next.get(SORT_KEY);
        const currentDir = next.get(SORT_DIR_KEY) === 'desc' ? 'desc' : 'asc';
        next.set(SORT_KEY, key);
        next.set(SORT_DIR_KEY, key === currentKey ? (currentDir === 'asc' ? 'desc' : 'asc') : defaultDir);
        next.set(PAGE_KEY, '1');
      });
    },
    [write],
  );

  const setOpen = useCallback<ListUrlState['setOpen']>(
    // Opening or closing the list is not a filter — it does not change which
    // rows match, so it must not throw the reader back to page 1.
    (open) => set(OPEN_KEY, open ? '1' : null, { resetPage: false }),
    [set],
  );

  const reset = useCallback<ListUrlState['reset']>(() => {
    write((next) => {
      for (const key of [...next.keys()]) {
        if (!PRESERVED_KEYS.has(key)) next.delete(key);
      }
    });
  }, [write]);

  const commitDraft = useCallback(() => {
    // Deliberately untrimmed — see the asymmetry note above.
    set(draftKey, draft);
  }, [set, draftKey, draft]);

  const draftInputProps = useMemo<DraftInputProps>(
    () => ({
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onKeyDown: (e) => {
        if (e.key === 'Enter') set(draftKey, e.currentTarget.value);
      },
    }),
    [draft, set, draftKey],
  );

  const blurCommitInputProps = useCallback<ListUrlState['blurCommitInputProps']>(
    (key) => ({
      defaultValue: params.get(key) ?? '',
      onBlur: (e) => set(key, e.target.value.trim()),
      onKeyDown: (e) => {
        if (e.key === 'Enter') set(key, e.currentTarget.value.trim());
      },
    }),
    [params, set],
  );

  const get = useCallback((key: string) => params.get(key), [params]);

  const rawPage = Number(params.get(PAGE_KEY));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1;

  return {
    params,
    get,
    page,
    sortKey,
    sortDir,
    isOpen: params.get(OPEN_KEY) === '1',
    set,
    setMany,
    toggle,
    setPage,
    setSort,
    toggleSort,
    setOpen,
    reset,
    draft,
    setDraft,
    commitDraft,
    draftInputProps,
    blurCommitInputProps,
  };
}
