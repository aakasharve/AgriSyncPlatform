import { byMostRecent, isSortable, sortRows } from '../sortRows';
import type { DataListColumn } from '../types';

/**
 * THE SORT SEMANTICS, at the unit level.
 *
 * `DataList.test.tsx` asserts the same rules through the rendered table,
 * because that is where a reader meets them. This file asserts them over the
 * comparator, because that is where they can be stated exactly — "a real 0
 * with no honesty state sorts as a real zero" is one line here and three
 * clicks there.
 *
 * Both are kept. Breaking the missing-parks-at-the-bottom rule in
 * `sortRows.ts` must turn tests red in BOTH files; a rule that only one file
 * defends is a rule with one place left to hide.
 */

interface Row {
  id: string;
  name: string;
  /** Deliberately nullable — the whole point of the file. */
  score: number | null;
  /** A real reading that happens to be zero. */
  errors: number;
  /** An honesty state ON a cell that still holds a number. */
  errorsState?: 'unmeasured' | 'feed-down';
  lastActiveAt: string | null;
}

const NAME: DataListColumn<Row> = {
  key: 'name',
  label: 'Name',
  render: (r) => r.name,
  sortType: 'text',
  sortValue: (r) => r.name,
  defaultDir: 'asc',
};

const SCORE: DataListColumn<Row> = {
  key: 'score',
  label: 'Score',
  render: (r) => r.score,
  sortType: 'num',
  sortValue: (r) => r.score,
  defaultDir: 'desc',
  tiebreak: byMostRecent<Row>((r) => r.lastActiveAt),
};

const ERRORS: DataListColumn<Row> = {
  key: 'errors',
  label: 'Errors',
  render: (r) => r.errors,
  sortType: 'num',
  sortValue: (r) => r.errors,
  state: (r) => r.errorsState ?? null,
};

const LAST_ACTIVE: DataListColumn<Row> = {
  key: 'lastActiveAt',
  label: 'Last active',
  render: (r) => r.lastActiveAt,
  sortType: 'date',
  sortValue: (r) => r.lastActiveAt,
};

const NOT_SORTABLE: DataListColumn<Row> = {
  key: 'actions',
  label: 'Actions',
  render: () => null,
};

function row(over: Partial<Row> & { id: string }): Row {
  return { name: over.id, score: 0, errors: 0, lastActiveAt: null, ...over };
}

function ids(rows: Row[]): string[] {
  return rows.map((r) => r.id);
}

describe('a missing value parks at the BOTTOM in both directions', () => {
  /* Not small, not large. NOT THERE. This single behaviour is the sort-order
     expression of the whole redesign: a descending sort that floated the
     absences to the top would show a reader scanning "worst first" a screen
     full of farms that have no reading at all. */
  const rows = [
    row({ id: 'none-a', score: null }),
    row({ id: 'low', score: 12 }),
    row({ id: 'none-b', score: null }),
    row({ id: 'high', score: 88 }),
  ];

  it('ascending — the readings first, the absences last', () => {
    expect(ids(sortRows(rows, SCORE, 'asc'))).toEqual(['low', 'high', 'none-a', 'none-b']);
  });

  it('descending — the readings first, the absences STILL last', () => {
    expect(ids(sortRows(rows, SCORE, 'desc'))).toEqual(['high', 'low', 'none-a', 'none-b']);
  });

  it('keeps the absences in their original order relative to each other', () => {
    expect(ids(sortRows(rows, SCORE, 'asc')).slice(2)).toEqual(['none-a', 'none-b']);
    expect(ids(sortRows(rows, SCORE, 'desc')).slice(2)).toEqual(['none-a', 'none-b']);
  });

  it('treats an empty string as absent, not as the smallest text', () => {
    const named = [row({ id: 'blank', name: '' }), row({ id: 'ana', name: 'Ana' })];
    expect(ids(sortRows(named, NAME, 'asc'))).toEqual(['ana', 'blank']);
    expect(ids(sortRows(named, NAME, 'desc'))).toEqual(['ana', 'blank']);
  });

  it('treats an unparseable date as absent rather than as 1970', () => {
    const dated = [
      row({ id: 'junk', lastActiveAt: 'not a date' }),
      row({ id: 'real', lastActiveAt: '2026-08-01T00:00:00Z' }),
    ];
    expect(ids(sortRows(dated, LAST_ACTIVE, 'asc'))).toEqual(['real', 'junk']);
    expect(ids(sortRows(dated, LAST_ACTIVE, 'desc'))).toEqual(['real', 'junk']);
  });
});

describe('a real 0 is a real zero', () => {
  /* The other half of the same rule, and the half a rewrite silently loses.
     "0 errors" and "we have no reading" are DIFFERENT FACTS. */
  const rows = [
    row({ id: 'five', errors: 5 }),
    row({ id: 'zero', errors: 0 }),
    row({ id: 'two', errors: 2 }),
  ];

  it('sorts a 0 among the numbers, not with the absences', () => {
    expect(ids(sortRows(rows, ERRORS, 'asc'))).toEqual(['zero', 'two', 'five']);
    expect(ids(sortRows(rows, ERRORS, 'desc'))).toEqual(['five', 'two', 'zero']);
  });

  it('parks a 0 that carries an honesty state at the bottom instead', () => {
    /* Same number, different fact. The state says the zero is not a reading,
       so the cell sorts as missing however you sort it. */
    const withState = [
      row({ id: 'five', errors: 5 }),
      row({ id: 'unread', errors: 0, errorsState: 'unmeasured' }),
      row({ id: 'two', errors: 2 }),
    ];
    expect(ids(sortRows(withState, ERRORS, 'asc'))).toEqual(['two', 'five', 'unread']);
    expect(ids(sortRows(withState, ERRORS, 'desc'))).toEqual(['five', 'two', 'unread']);
  });

  it('parks a REAL number that carries an honesty state at the bottom too', () => {
    const withState = [
      row({ id: 'stale', errors: 99, errorsState: 'feed-down' }),
      row({ id: 'two', errors: 2 }),
    ];
    expect(ids(sortRows(withState, ERRORS, 'desc'))).toEqual(['two', 'stale']);
  });
});

describe('stability', () => {
  it('keeps equal values in their original order, in both directions', () => {
    const rows = [
      row({ id: 'first', score: 50 }),
      row({ id: 'second', score: 50 }),
      row({ id: 'third', score: 50 }),
    ];
    /* NAME has no tiebreak, so equality falls straight to the index. */
    const flat = rows.map((r) => ({ ...r, name: 'same' }));
    expect(ids(sortRows(flat, NAME, 'asc'))).toEqual(['first', 'second', 'third']);
    expect(ids(sortRows(flat, NAME, 'desc'))).toEqual(['first', 'second', 'third']);
  });
});

describe('the product tiebreak that lives in exactly one file today', () => {
  /* `InterventionQueueTable.tsx:60-62` — ties on score break by lastActiveAt
     DESCENDING, so the worst farms with recent activity come first. */
  const tied = [
    row({ id: 'quiet', score: 40, lastActiveAt: '2026-08-01T09:00:00Z' }),
    row({ id: 'active', score: 40, lastActiveAt: '2026-08-20T09:00:00Z' }),
  ];

  it('breaks a score tie by lastActiveAt descending', () => {
    expect(ids(sortRows(tied, SCORE, 'asc'))).toEqual(['active', 'quiet']);
  });

  it('applies the tiebreak in BOTH directions, as the live code does', () => {
    /* The live comment says "score-asc"; the live CODE runs whenever score is
       the sort column. Machinery beats the comment. */
    expect(ids(sortRows(tied, SCORE, 'desc'))).toEqual(['active', 'quiet']);
  });

  it('does not let a row with no last-active time win the tiebreak', () => {
    const withNull = [
      row({ id: 'never', score: 40, lastActiveAt: null }),
      row({ id: 'active', score: 40, lastActiveAt: '2026-08-20T09:00:00Z' }),
    ];
    expect(ids(sortRows(withNull, SCORE, 'asc'))).toEqual(['active', 'never']);
  });

  it('falls through to a stable order when the tiebreak is also equal', () => {
    /* The live comparator returns -1 here for BOTH (a,b) and (b,a), which is
       an inconsistent comparator with no defined result. This one returns 0
       and keeps the input order. */
    const same = [
      row({ id: 'first', score: 40, lastActiveAt: '2026-08-20T09:00:00Z' }),
      row({ id: 'second', score: 40, lastActiveAt: '2026-08-20T09:00:00Z' }),
    ];
    expect(ids(sortRows(same, SCORE, 'asc'))).toEqual(['first', 'second']);
    expect(ids(sortRows(same, SCORE, 'desc'))).toEqual(['first', 'second']);
  });
});

describe('what the sorter refuses to do', () => {
  it('leaves the rows in server order when the column cannot be sorted', () => {
    const rows = [row({ id: 'b' }), row({ id: 'a' })];
    expect(ids(sortRows(rows, NOT_SORTABLE, 'asc'))).toEqual(['b', 'a']);
  });

  it('leaves the rows in server order when there is no column at all', () => {
    const rows = [row({ id: 'b' }), row({ id: 'a' })];
    expect(ids(sortRows(rows, undefined, 'asc'))).toEqual(['b', 'a']);
  });

  it('does not mutate the array it was given', () => {
    const rows = [row({ id: 'b', score: 2 }), row({ id: 'a', score: 1 })];
    sortRows(rows, SCORE, 'asc');
    expect(ids(rows)).toEqual(['b', 'a']);
  });

  it('needs BOTH sortType and sortValue before it will sort a column', () => {
    expect(isSortable(NOT_SORTABLE)).toBe(false);
    expect(isSortable({ ...SCORE, sortValue: undefined })).toBe(false);
    expect(isSortable({ ...SCORE, sortType: undefined })).toBe(false);
    expect(isSortable(SCORE)).toBe(true);
  });
});

describe('value handling', () => {
  it('compares text case-insensitively, as v3 does', () => {
    const rows = [row({ id: 'upper', name: 'Zebra' }), row({ id: 'lower', name: 'apple' })];
    expect(ids(sortRows(rows, NAME, 'asc'))).toEqual(['lower', 'upper']);
  });

  it('strips Indian digit grouping before comparing numbers', () => {
    const column: DataListColumn<Row> = {
      ...SCORE,
      tiebreak: undefined,
      sortValue: (r) => (r.score === null ? null : r.score.toLocaleString('en-IN')),
    };
    const rows = [row({ id: 'big', score: 2477000 }), row({ id: 'small', score: 3 })];
    expect(ids(sortRows(rows, column, 'asc'))).toEqual(['small', 'big']);
  });

  it('accepts a Date object as well as an ISO string', () => {
    const column: DataListColumn<Row> = {
      ...LAST_ACTIVE,
      sortValue: (r) => (r.lastActiveAt ? new Date(r.lastActiveAt) : null),
    };
    const rows = [
      row({ id: 'late', lastActiveAt: '2026-08-20T09:00:00Z' }),
      row({ id: 'early', lastActiveAt: '2026-08-01T09:00:00Z' }),
    ];
    expect(ids(sortRows(rows, column, 'asc'))).toEqual(['early', 'late']);
  });
});
