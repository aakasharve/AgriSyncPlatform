import { useMemo } from 'react';
import { searchKey } from '@/lib/searchKey';

/**
 * THE SEARCH INDEX — and the one measured constraint in this whole task.
 *
 * ── The numbers Task 6 handed over (`c2b8cf28`, `searchKey.test.ts`) ──────
 * Over 3,000 farms of real Marathi names, jsdom, single run:
 *
 *     BUILD the index   ~60 ms one-time, ~355 KB held in memory
 *     SCAN  the index   ~0.4 ms per keystroke
 *
 * THE SEARCH IS INSTANT. THE BUILD IS NOT. 0.4 ms is imperceptible and the
 * index could grow tenfold and still be fine. 60 ms is a dropped frame — so
 * the index is memoised on the ROW DATA and is never, under any
 * circumstances, recomputed inside a keystroke handler. Get that wrong and a
 * 0.4 ms search becomes a 60 ms one, which is worse than today's no-search:
 * a laggy box makes people retype.
 *
 * Two things enforce it rather than hoping for it:
 *   1. `useSearchIndex` depends on `[rows, keys]` and on nothing else. The
 *      query is NOT a dependency, and must never become one.
 *   2. The draft text lives inside `DataList` (through `useListUrlState`), so
 *      a keystroke re-renders the list but not the screen that owns the
 *      config object — `keys` therefore keeps its identity across a burst of
 *      typing. `DataList.test.tsx` proves it by counting how many times
 *      `keys` is called across five keystrokes: once per row, total.
 *
 * If `keys` is rebuilt on every render of the SCREEN (an inline arrow inside
 * a component that also re-renders per keystroke), the memo is defeated and
 * nothing here will save it. Define it at module scope.
 *
 * ── The haystack shape ────────────────────────────────────────────────────
 * Task 6 deliberately shipped no `searchHaystack` helper; this is it, and the
 * shape is the one those numbers were measured against — v3's own, from
 * `app.js` `initSearch`:
 *
 *     hay = (raw + ' ' + AS.searchKey(raw)).toLowerCase().replace(/\s+/g, ' ');
 *
 * `searchKey` returns '' for a name with no Devanagari in it, so a Latin
 * name costs one string concatenation and no index at all.
 *
 * ── Why the romanisation matters ─────────────────────────────────────────
 * A support person on a phone call HEARS "Kamble" and types it in Latin
 * letters; the farm is recorded as कांबळे. Without the index the search
 * compares Latin against Devanagari, finds nothing, and the call ends in "I
 * cannot find you."
 */

/**
 * One row's haystack. Empty and nullish parts are dropped, so a row with a
 * missing phone does not acquire a stray double space that a query could
 * never match anyway.
 */
export function searchHaystack(parts: Array<string | null | undefined>): string {
  const raw = parts.filter(Boolean).join(' ');
  if (!raw) return '';
  return `${raw} ${searchKey(raw)}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Build the whole index. Exported for measurement and for tests; components
 * use the hook below so the memo is not optional.
 */
export function buildSearchIndex<T>(rows: T[], keys: (row: T) => string[]): string[] {
  return rows.map((row) => searchHaystack(keys(row)));
}

/**
 * The index, memoised on the row data.
 *
 * Returns one haystack per row, positionally aligned with `rows` — the caller
 * filters by index rather than by a map keyed on a row id, because a row id
 * is a screen's business and a list should not need one to search.
 */
export function useSearchIndex<T>(rows: T[], keys: ((row: T) => string[]) | undefined): string[] {
  return useMemo(() => (keys ? buildSearchIndex(rows, keys) : []), [rows, keys]);
}

/**
 * The scan: a plain substring test, lowercased once on the way in.
 *
 * Deliberately not a fuzzy match. Over-matching is the founder's stated
 * preference (INDEX MORE SPELLINGS, 2026-08-31) and it is already paid for on
 * the INDEX side, where every plausible romanisation is present. Adding
 * fuzziness on the QUERY side as well would start returning rows a support
 * person cannot explain to the farmer on the other end of the call.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || haystack.includes(q);
}
