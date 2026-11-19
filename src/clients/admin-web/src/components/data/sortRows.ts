import type { SortDir } from '@/lib/useListUrlState';
import type { DataListColumn, SortType, SortableValue } from './types';

/**
 * THE SORTER. Four semantics, and every one of them exists in exactly one
 * place today — which is why a rewrite loses them.
 *
 * ── 1. A MISSING VALUE PARKS AT THE BOTTOM IN BOTH DIRECTIONS ─────────────
 * Not small, not large. NOT THERE. Ported from v3 `app.js` `applySort`:
 *
 *     if (av.missing && bv.missing) return a._i - b._i;
 *     if (av.missing) return 1;
 *     if (bv.missing) return -1;
 *
 * The three lines sit BEFORE the direction flip, which is the whole trick: a
 * flipped comparison would send absences to the top on a descending sort, and
 * a reader scanning "worst first" would open a column of farms that have no
 * reading at all instead of the farms that are actually failing.
 *
 * This is the sort-order expression of the entire redesign. If you change one
 * thing in this file, change something else.
 *
 * ── 2. A REAL 0 IS A REAL ZERO ────────────────────────────────────────────
 * A cell holding 0 with NO honesty state sorts as 0 and belongs among the
 * numbers. A cell carrying an honesty state sorts as missing even when it
 * holds a number, because the state says the number is not a reading. v3
 * spells the same rule as `if (state && state !== 'ok') return {missing:true}`
 * with `/* a real 0 arrives here as 0 *\/` on the numeric branch.
 *
 * ── 3. STABLE ────────────────────────────────────────────────────────────
 * Equal values keep their original order, in both directions, via an index
 * tiebreak taken before the flip. Array.prototype.sort is specified as stable
 * since ES2019, but the flip below is applied to the comparison and not to
 * the tie, so the tie has to be explicit or a descending sort would reverse
 * equal rows against the ascending one.
 *
 * ── 4. THE PRODUCT TIEBREAK ──────────────────────────────────────────────
 * `InterventionQueueTable.tsx:60-62`, verified in the tree 2026-08-31:
 *
 *     // Tiebreak score-asc by lastActiveAt DESC (per §4.6).
 *     if (sortKey === 'score') return a.lastActiveAt < b.lastActiveAt ? 1 : -1;
 *
 * Two things about that line, carried deliberately and separately:
 *
 *   CARRIED — it fires whenever `score` is the sort column, in EITHER
 *   direction, despite the comment saying score-asc. The live console wins
 *   over the comment ("machinery beats mockup"), so a column-level `tiebreak`
 *   applies whenever that column is sorted and is never flipped by direction.
 *
 *   FIXED — it returns `-1` when the two timestamps are EQUAL, so the
 *   comparator answers -1 for both (a,b) and (b,a). That is an inconsistent
 *   comparator and its result under V8's sort is arbitrary. Here an equal
 *   tiebreak returns 0 and falls through to the stable index. Nothing
 *   observable changes except the degenerate case, which had no defined
 *   behaviour to preserve.
 *
 * The plan's sketch hung `tiebreak` off `defaultSort`. It hangs off the
 * COLUMN instead, because that is what the live code keys on — `sortKey ===
 * 'score'`, not "is this the default sort" — and because a tiebreak on the
 * default sort would silently stop applying the moment a reader clicked the
 * same column twice.
 */

/** What the comparator actually compares. `missing` outranks `v` entirely. */
interface Resolved {
  missing: boolean;
  v: number | string;
}

const MISSING: Resolved = { missing: true, v: 0 };

/**
 * v3's `sortValue(td, type)`, over data instead of over a DOM cell.
 *
 * Reading it off the row rather than out of the rendered `<td>` is the one
 * deliberate change of mechanism: the prototype has to parse its own markup
 * back because it built the table as a string, and a React port that did the
 * same would be sorting on formatted text — "24,77,000" before "3" — the
 * first time a screen used `fmt`.
 */
function resolve<T>(column: DataListColumn<T>, row: T): Resolved {
  /* An honesty state outranks the value beside it. */
  if (column.state?.(row)) return MISSING;

  const raw: SortableValue = column.sortValue?.(row);
  if (raw === null || raw === undefined || raw === '') return MISSING;

  const type: SortType = column.sortType ?? 'text';

  if (type === 'num') {
    /* Grouping separators are stripped exactly as v3 does, so a column that
       hands over a formatted figure still sorts numerically rather than
       silently degrading to text order. */
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''));
    return Number.isNaN(n) ? MISSING : { missing: false, v: n };
  }

  if (type === 'date') {
    const t = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
    return Number.isNaN(t) ? MISSING : { missing: false, v: t };
  }

  return { missing: false, v: String(raw).toLowerCase() };
}

/** True when this column can be sorted at all. Half a contract is not one. */
export function isSortable<T>(column: DataListColumn<T>): boolean {
  return !!column.sortType && !!column.sortValue;
}

/**
 * Sort a copy of `rows`. An unsortable or unknown column returns the rows in
 * server order, untouched — the server's order is a decision too, and
 * inventing a client-side one on top of it is not a neutral act.
 */
export function sortRows<T>(
  rows: T[],
  column: DataListColumn<T> | undefined,
  dir: SortDir,
): T[] {
  if (!column || !isSortable(column)) return rows;

  const indexed = rows.map((row, i) => ({ row, i }));

  indexed.sort((a, b) => {
    const av = resolve(column, a.row);
    const bv = resolve(column, b.row);

    /* 1 — the bottom, both ways, before the flip. */
    if (av.missing && bv.missing) return a.i - b.i;
    if (av.missing) return 1;
    if (bv.missing) return -1;

    const cmp = av.v < bv.v ? -1 : av.v > bv.v ? 1 : 0;

    if (cmp === 0) {
      /* 4 — the product tiebreak, unflipped, then 3 — stability. */
      const tie = column.tiebreak?.(a.row, b.row) ?? 0;
      return tie !== 0 ? tie : a.i - b.i;
    }

    return dir === 'asc' ? cmp : -cmp;
  });

  return indexed.map((entry) => entry.row);
}

/**
 * The tiebreak that exists today, as a reusable comparator: most recently
 * active first. A screen writes
 *
 *     tiebreak: byMostRecent((r) => r.lastActiveAt)
 *
 * on its score column and gets `InterventionQueueTable`'s rule without
 * re-deriving it — which is the point of moving it out of that one file.
 */
export function byMostRecent<T>(at: (row: T) => SortableValue) {
  return (a: T, b: T): number => {
    const av = at(a);
    const bv = at(b);
    const at1 = av instanceof Date ? av.getTime() : Date.parse(String(av ?? ''));
    const bt1 = bv instanceof Date ? bv.getTime() : Date.parse(String(bv ?? ''));

    /* A row with no last-active time cannot claim to be the most recent. It
       loses the tiebreak rather than winning it by accident of NaN. */
    const aMissing = Number.isNaN(at1);
    const bMissing = Number.isNaN(bt1);
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;

    return bt1 - at1;
  };
}
