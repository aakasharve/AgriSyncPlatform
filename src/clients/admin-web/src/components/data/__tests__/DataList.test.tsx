import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '@/test/renderWithProviders';
import { DataList } from '../DataList';
import { byMostRecent } from '../sortRows';
import type { DataListColumn, DataListConfig, FacetConfig } from '../types';

/**
 * THE TWELVE BEHAVIOURS A REWRITE LOSES — plus the ones this task added.
 *
 * Every assertion here describes something that exists in exactly one file
 * today, or a rule the summary-first port had to decide for itself. A
 * screenshot diff catches none of them.
 *
 * NO SCREEN IS RE-POINTED YET. These tests render `DataList` directly against
 * a fixture, which is the point: the component has to be proven before the
 * first screen depends on it.
 */

interface Farm {
  id: string;
  name: string;
  owner: string;
  crop: string;
  tier: string | null;
  score: number | null;
  errors: number;
  /** An honesty state on a cell that still holds a number. */
  errorsState?: 'unmeasured';
  lastActiveAt: string | null;
}

const ROWS: Farm[] = [
  {
    id: 'f1',
    name: 'भोसले',
    owner: 'Ramesh',
    crop: 'grapes',
    tier: 'A',
    score: 40,
    errors: 0,
    lastActiveAt: '2026-08-20T09:00:00Z',
  },
  {
    id: 'f2',
    name: 'Anand Farm',
    owner: 'Sita',
    crop: 'grapes',
    tier: 'B',
    score: 40,
    errors: 5,
    lastActiveAt: '2026-08-01T09:00:00Z',
  },
  {
    id: 'f3',
    name: 'Zebra Farm',
    owner: 'Gopal',
    crop: 'sugarcane',
    tier: 'A',
    score: null,
    errors: 2,
    lastActiveAt: null,
  },
  {
    id: 'f4',
    name: 'Mango Farm',
    owner: 'Latha',
    crop: 'sugarcane',
    tier: null,
    score: 12,
    errors: 0,
    errorsState: 'unmeasured',
    lastActiveAt: '2026-08-10T09:00:00Z',
  },
];

const COLUMNS: DataListColumn<Farm>[] = [
  {
    key: 'name',
    label: 'Farm',
    render: (r) => r.name,
    sortType: 'text',
    sortValue: (r) => r.name,
    defaultDir: 'asc',
  },
  {
    key: 'score',
    label: 'Score',
    render: (r) => r.score ?? '—',
    sortType: 'num',
    sortValue: (r) => r.score,
    /* A30: `farmerName` opens ascending, `score` opens descending. */
    defaultDir: 'desc',
    /* The rule that lives in `InterventionQueueTable.tsx:60-62` today. */
    tiebreak: byMostRecent<Farm>((r) => r.lastActiveAt),
    align: 'right',
  },
  {
    key: 'errors',
    label: 'Errors',
    render: (r) => r.errors,
    sortType: 'num',
    sortValue: (r) => r.errors,
    state: (r) => r.errorsState ?? null,
    align: 'right',
  },
];

const CROP: FacetConfig<Farm> = {
  key: 'crop',
  label: 'By crop',
  crossFiltered: true,
  options: [
    { value: 'grapes', label: 'Grapes', test: (r) => r.crop === 'grapes' },
    { value: 'sugarcane', label: 'Sugarcane', test: (r) => r.crop === 'sugarcane' },
    /* A zero-yield option. It keeps its position and shows its 0. */
    { value: 'trial', label: 'Trial', test: (r) => r.crop === 'trial' },
  ],
};

function tierFacet(crossFiltered: boolean): FacetConfig<Farm> {
  return {
    key: 'tier',
    label: 'By tier',
    crossFiltered,
    options: [
      { value: 'A', label: 'Tier A', test: (r) => r.tier === 'A' },
      { value: 'B', label: 'Tier B', test: (r) => r.tier === 'B' },
    ],
  };
}

function config(over: Partial<DataListConfig<Farm>> = {}): DataListConfig<Farm> {
  return {
    id: 'farms',
    label: 'Test farms',
    noun: { one: 'farm', many: 'farms' },
    rows: ROWS,
    rowKey: (r) => r.id,
    columns: COLUMNS,
    skeleton: { rows: 8, cells: 7 },
    states: {
      isLoading: false,
      isFetching: false,
      error: null,
      onRetry: () => undefined,
      measuredZero: { what: 'No farms in this organisation', checkedAt: '09:12 today' },
    },
    ...over,
  };
}

/** Reads MemoryRouter's location, so a URL assertion is about what the router
 *  saw and not about jsdom's address bar. */
function Probe() {
  const location = useLocation();
  /* A <span>, not an <output>: `output` carries an implicit `status` role and
     would collide with every honest-state block this suite asserts on. */
  return <span data-testid="url">{location.search}</span>;
}

function renderList(cfg: DataListConfig<Farm>, route = '/') {
  return renderWithProviders(
    <>
      <DataList {...cfg} />
      <Probe />
    </>,
    { route },
  );
}

function table() {
  return screen.getByRole('table', { name: 'Test farms' });
}

/** The first cell of every data row, in DOM order. */
function order(): string[] {
  return [...table().querySelectorAll<HTMLTableRowElement>('tbody > tr')]
    .filter((tr) => !tr.hasAttribute('hidden') && !tr.id.includes('detail'))
    .map((tr) => tr.querySelector('td')?.textContent?.trim() ?? '');
}

function header(name: string) {
  return screen.getByRole('columnheader', { name: new RegExp(name) });
}

/* ══════════════════════════════════════════════════════ 1-3 the sort rules */

describe('sorting', () => {
  it('parks missing values at the bottom in both sort directions', async () => {
    const user = userEvent.setup();
    renderList(config());

    /* Score descending — Zebra Farm has no score at all. */
    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(order()).toEqual(['भोसले', 'Anand Farm', 'Mango Farm', 'Zebra Farm']);

    /* Flip it. The absence does NOT float to the top: it is not small, it is
       not large, it is not there. */
    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(order()).toEqual(['Mango Farm', 'भोसले', 'Anand Farm', 'Zebra Farm']);
  });

  it('sorts a real zero with no honesty state as a real zero', async () => {
    const user = userEvent.setup();
    renderList(config());

    /* Errors ascending. भोसले holds a real 0 and belongs at the top of the
       numbers; Mango Farm holds a 0 that carries "not measured" and is not a
       reading at all, so it parks at the bottom. Same digit, different fact. */
    await user.click(screen.getByRole('button', { name: /Errors/ }));
    expect(order()).toEqual(['भोसले', 'Zebra Farm', 'Anand Farm', 'Mango Farm']);
  });

  it('is a stable sort — equal values keep their server order', async () => {
    const user = userEvent.setup();
    /* Two rows with the same score and the same last-active time: nothing
       left to break the tie with except the order they arrived in. */
    const tied: Farm[] = [
      { ...ROWS[1], id: 'a', name: 'A farm', score: 7, lastActiveAt: '2026-08-01T09:00:00Z' },
      { ...ROWS[1], id: 'b', name: 'B farm', score: 7, lastActiveAt: '2026-08-01T09:00:00Z' },
      { ...ROWS[1], id: 'c', name: 'C farm', score: 7, lastActiveAt: '2026-08-01T09:00:00Z' },
    ];
    renderList(config({ rows: tied }));

    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(order()).toEqual(['A farm', 'B farm', 'C farm']);
    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(order()).toEqual(['A farm', 'B farm', 'C farm']);
  });
});

/* ═════════════════════════════════════════════════ 4-6 direction and aria */

describe('the sort controls', () => {
  it('applies the per-column default direction on first click', async () => {
    const user = userEvent.setup();
    renderList(config());

    /* A30: Farm opens ascending, Score opens descending. */
    await user.click(screen.getByRole('button', { name: /Farm/ }));
    expect(header('Farm')).toHaveAttribute('aria-sort', 'ascending');

    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(header('Score')).toHaveAttribute('aria-sort', 'descending');
  });

  it('flips the direction on a second click of the same column', async () => {
    const user = userEvent.setup();
    renderList(config());

    await user.click(screen.getByRole('button', { name: /Score/ }));
    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(header('Score')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('flips the DEFAULT sort on its first click instead of re-applying it', async () => {
    const user = userEvent.setup();
    /* The default sort is not in the URL, so a hook that could only see the
       URL would treat this column as new and adopt its default direction —
       the reader would click a sorted column and watch nothing move. */
    renderList(config({ defaultSort: { key: 'score', dir: 'desc' } }));
    expect(header('Score')).toHaveAttribute('aria-sort', 'descending');

    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(header('Score')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('breaks a score tie by lastActiveAt descending', async () => {
    const user = userEvent.setup();
    renderList(config());

    /* भोसले and Anand Farm both score 40. The one active most recently comes
       first — worst farms with recent activity first (DWC v2 §4.6 Step 1). */
    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(order().slice(0, 2)).toEqual(['भोसले', 'Anand Farm']);
  });

  it('keeps aria-sort live on the active column and none on the others', async () => {
    const user = userEvent.setup();
    renderList(config());

    expect(header('Farm')).toHaveAttribute('aria-sort', 'none');
    expect(header('Score')).toHaveAttribute('aria-sort', 'none');

    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(header('Score')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Farm')).toHaveAttribute('aria-sort', 'none');
    expect(header('Errors')).toHaveAttribute('aria-sort', 'none');
  });

  it('renders no sort controls at all under a fixed order, and says why', () => {
    /* A31: the watchlist sorts biggest-drop-first and is DELIBERATELY not
       user-sortable. An order the reader cannot change and cannot explain is
       an order they will assume is arbitrary. */
    renderList(
      config({
        fixedSort: { key: 'score', dir: 'asc', because: 'Lowest score first — worst farms first.' },
      }),
    );
    expect(screen.queryByRole('button', { name: /Score/ })).toBeNull();
    expect(header('Score')).not.toHaveAttribute('aria-sort');
    expect(screen.getByText('Lowest score first — worst farms first.')).toBeInTheDocument();
    expect(order()).toEqual(['Mango Farm', 'भोसले', 'Anand Farm', 'Zebra Farm']);
  });

  it('writes sort and dir in ONE url write, so ?org survives', async () => {
    const user = userEvent.setup();
    /* Two `set()` calls in one handler both build from the same pre-call
       snapshot and the second clobbers the first. The param that goes missing
       is the active tenant. */
    renderList(config(), '/?org=11111111-1111-1111-1111-111111111111');

    await user.click(screen.getByRole('button', { name: /Score/ }));
    const url = screen.getByTestId('url').textContent ?? '';
    expect(url).toContain('org=11111111-1111-1111-1111-111111111111');
    expect(url).toContain('sort=score');
    expect(url).toContain('dir=desc');
  });

  it('does not throw the reader back to page 1 when they sort', async () => {
    const user = userEvent.setup();
    renderList(
      config({
        pagination: { mode: 'server', page: 2, pageSize: 2, totalCount: 9, onPage: vi.fn() },
      }),
      '/?page=2',
    );

    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(screen.getByTestId('url').textContent).toContain('page=2');
  });
});

/* ═══════════════════════════════════════════════════ 7-8 expandable rows */

describe('expandable rows', () => {
  const expandable = () =>
    config({ expand: (r) => <p>Owner on file: {r.owner}</p> });

  function dataRows(): HTMLTableRowElement[] {
    return [...table().querySelectorAll<HTMLTableRowElement>('tbody > tr')];
  }

  it('opens and closes a row on Enter and on Space', () => {
    renderList(expandable());
    const row = dataRows()[0];

    expect(row).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Owner on file: Ramesh/)).toBeVisible();

    fireEvent.keyDown(row, { key: ' ' });
    expect(row).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(row, { key: ' ' });
    expect(row).toHaveAttribute('aria-expanded', 'true');
  });

  it('points aria-controls at the detail row it actually controls', () => {
    renderList(expandable());
    const row = dataRows()[0];
    const id = row.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).not.toBeNull();
  });

  it('moves a detail row with its parent when the table sorts', async () => {
    const user = userEvent.setup();
    renderList(expandable());

    /* Open the LAST row's detail, then sort so that row moves to the top. */
    const rowsBefore = dataRows();
    fireEvent.click(rowsBefore[rowsBefore.length - 2]);
    expect(screen.getByText(/Owner on file: Latha/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Farm/ }));

    const rows = dataRows();
    const parentIndex = rows.findIndex((tr) => tr.textContent?.includes('Mango Farm'));
    /* The detail is the IMMEDIATE next sibling. A sorter that moved rows
       without their details would leave this one under somebody else. */
    expect(rows[parentIndex + 1].textContent).toContain('Owner on file: Latha');
    expect(rows[parentIndex + 1].hasAttribute('hidden')).toBe(false);
  });

  it('does not toggle the row when a row action is used', () => {
    renderList(
      config({
        expand: (r) => <p>Owner on file: {r.owner}</p>,
        actions: () => <button type="button">Open</button>,
      }),
    );
    const row = dataRows()[0];
    fireEvent.click(within(row).getAllByRole('button', { name: 'Open' })[0]);
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('leaves a non-expandable row without any expansion semantics', () => {
    renderList(config());
    expect(dataRows()[0]).not.toHaveAttribute('aria-expanded');
    expect(dataRows()[0]).not.toHaveAttribute('tabindex');
  });

  it('keeps the row a row — the cells still have a row parent', () => {
    /* v3 puts role="button" on the <tr>, which replaces the implicit row role
       and makes every cell an axe aria-required-parent violation. */
    renderList(expandable());
    expect(dataRows()[0]).not.toHaveAttribute('role');
    expect(within(table()).getAllByRole('row').length).toBeGreaterThan(1);
  });
});

/* ═════════════════════════════════════════════════════════ 9-10 the pager */

describe('the pager', () => {
  it('hides the pager entirely when there is one page', () => {
    renderList(
      config({
        pagination: { mode: 'server', page: 1, pageSize: 40, totalCount: 4, onPage: vi.fn() },
      }),
    );
    /* Hidden, not disabled. A greyed-out pager under a four-row table tells
       the reader nothing except that somebody thought about pagination. */
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
  });

  it('disables Prev on page 1 and Next on the last page', () => {
    const onPage = vi.fn();
    const { unmount } = renderList(
      config({ pagination: { mode: 'server', page: 1, pageSize: 2, totalCount: 6, onPage } }),
    );
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    unmount();

    renderList(
      config({ pagination: { mode: 'server', page: 3, pageSize: 2, totalCount: 6, onPage } }),
    );
    expect(screen.getByRole('button', { name: /Prev/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('asks the screen to change page — it never slices the rows itself', async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    renderList(
      config({ pagination: { mode: 'server', page: 2, pageSize: 2, totalCount: 6, onPage } }),
    );
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPage).toHaveBeenCalledWith(3);
    /* All four fixture rows are still rendered: the server decides what a
       page contains, and the client draws what it was given. */
    expect(order()).toHaveLength(4);
  });

  it('derives the page count from the SERVER total, not from the rows in hand', () => {
    renderList(
      config({ pagination: { mode: 'server', page: 1, pageSize: 40, totalCount: 1284, onPage: vi.fn() } }),
    );
    expect(screen.getByText('Page 1 of 33')).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════════════ 11 the row count */

describe('the row count', () => {
  it('swaps the row count for Refreshing only on a background fetch', () => {
    const { unmount } = renderList(config());
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText(/Refreshing/)).toBeNull();
    unmount();

    /* A background poll: the rows on screen are about to change under the
       reader, and the count is where that is said. */
    const busy = renderList(
      config({ states: { ...config().states, isFetching: true } }),
    );
    expect(screen.getByText(/Refreshing/)).toBeInTheDocument();
    busy.unmount();

    /* A FIRST load shows the skeleton and must NOT also claim to be
       refreshing — `FarmerHealthPage.tsx:87` is the stricter variant and it
       is the shared rule now. */
    renderList(config({ states: { ...config().states, isLoading: true, isFetching: true } }));
    expect(screen.queryByText(/Refreshing/)).toBeNull();
  });

  it('states the page scope in the row count over a paginated list', () => {
    renderList(
      config({ pagination: { mode: 'server', page: 1, pageSize: 4, totalCount: 1284, onPage: vi.fn() } }),
    );
    /* Never a bare "4". The reader is told what they are holding AND what it
       is out of, because the server's total is the one number here that is
       exact. */
    expect(screen.getByText('1,284').parentElement).toHaveTextContent('4 of 1,284 farms');
  });

  it('counts what the search matched, and what it matched out of', async () => {
    const user = userEvent.setup();
    renderList(
      config({
        search: { mode: 'client', commit: 'submit', placeholder: 'Search…', keys: (r) => [r.name] },
      }),
    );
    await user.type(screen.getByRole('textbox'), 'farm{Enter}');
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText(/matching/)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════ 12 the chip, and summary-first */

describe('the summary-first list', () => {
  const summaryConfig = (over: Partial<DataListConfig<Farm>> = {}) =>
    config({ facets: [CROP], collapsible: { defaultOpen: false }, ...over });

  it('opens closed — the summary and the filters, and no rows', () => {
    renderList(summaryConfig());
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: /Grapes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show all/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('returns a filter chip close control to the summary, not to a longer list', async () => {
    const user = userEvent.setup();
    renderList(summaryConfig());

    await user.click(screen.getByRole('button', { name: /Grapes/ }));
    expect(order()).toEqual(['भोसले', 'Anand Farm']);

    /* The reader asked to be rid of a list. They are not handed a bigger
       one — they land back where the screen started. */
    await user.click(
      screen.getByRole('button', { name: 'Clear this filter and go back to the summary' }),
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: /Grapes/ })).toBeInTheDocument();
  });

  it('states the applied filter IN WORDS on the chip', async () => {
    const user = userEvent.setup();
    renderList(summaryConfig());
    await user.click(screen.getByRole('button', { name: /Grapes/ }));
    expect(screen.getByText(/Grapes · 2 farms/)).toBeInTheDocument();
  });

  it('is a true three-state Show all', async () => {
    const user = userEvent.setup();
    renderList(summaryConfig());

    /* closed -> open */
    await user.click(screen.getByRole('button', { name: /Show all 4 farms/ }));
    expect(order()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Hide the list' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    /* open -> closed */
    await user.click(screen.getByRole('button', { name: 'Hide the list' }));
    expect(screen.queryByRole('table')).toBeNull();

    /* filtered -> the whole list, filter cleared */
    await user.click(screen.getByRole('button', { name: /Grapes/ }));
    expect(order()).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /Show all 4 farms/ }));
    expect(order()).toHaveLength(4);
    expect(screen.queryByText(/Grapes · /)).toBeNull();
  });

  it('opens the list when a search is typed, and closes it again when cleared', async () => {
    const user = userEvent.setup();
    renderList(
      summaryConfig({
        search: { mode: 'client', commit: 'submit', placeholder: 'Search…', keys: (r) => [r.name] },
      }),
    );
    expect(screen.queryByRole('table')).toBeNull();

    await user.type(screen.getByRole('textbox'), 'anand{Enter}');
    expect(order()).toEqual(['Anand Farm']);

    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.queryByRole('table')).toBeNull();
  });
});

/* ═══════════════════════════════════ the facet counts and their SCOPE */

describe('facet counts', () => {
  it('states an unqualified count only when the whole set is loaded', () => {
    renderList(config({ facets: [CROP], collapsible: { defaultOpen: false } }));
    expect(screen.getByRole('button', { name: 'Grapes, 2 farms' })).toBeInTheDocument();
    expect(screen.queryByText(/on this page/)).toBeNull();
  });

  it('never states a bare count over a server-paginated list', () => {
    /* THE one real design conflict in the port. The exact-count promise is
       only computable over a fully loaded set; the client holds one page. The
       resolution is to state the scope, not to fetch every farm. */
    renderList(
      config({
        facets: [CROP],
        collapsible: { defaultOpen: false },
        pagination: { mode: 'server', page: 1, pageSize: 4, totalCount: 1284, onPage: vi.fn() },
      }),
    );
    expect(
      screen.getByRole('button', { name: 'Grapes, 2 farms on this page' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/not all 1,284/)).toBeInTheDocument();
  });

  it('states the server total exactly — that count IS known', () => {
    renderList(
      config({
        facets: [CROP],
        collapsible: { defaultOpen: false },
        pagination: { mode: 'server', page: 1, pageSize: 4, totalCount: 1284, onPage: vi.fn() },
      }),
    );
    expect(screen.getByText('1,284 farms')).toBeInTheDocument();
    expect(screen.getByText('4 on this page')).toBeInTheDocument();
  });

  it('keeps a zero-yield option in its place, showing 0', () => {
    renderList(config({ facets: [CROP], collapsible: { defaultOpen: false } }));
    /* A reader learns more from "Trial 0" than from an option that vanished. */
    const trial = screen.getByRole('button', { name: 'Trial, 0 farms' });
    expect(trial).toBeInTheDocument();
    expect(trial).toHaveAttribute('data-empty', 'true');
  });

  it('cross-filters the counts when a screen opts in', async () => {
    const user = userEvent.setup();
    renderList(
      config({ facets: [CROP, tierFacet(true)], collapsible: { defaultOpen: false } }),
    );
    expect(screen.getByRole('button', { name: 'Tier A, 2 farms' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Grapes/ }));
    /* With crop = Grapes chosen, one of the two Tier A farms is out. The
       number on the button is the number you get by pressing it. */
    expect(screen.getByRole('button', { name: 'Tier A, 1 farm' })).toBeInTheDocument();
  });

  it('leaves the counts alone when a screen opts OUT', async () => {
    const user = userEvent.setup();
    /* v3 deliberately does NOT cross-filter on Users, Suffering and API
       Errors, where a count that moved would stop answering "how many are
       there". Opt-in per screen, and the default is off. */
    renderList(
      config({ facets: [CROP, tierFacet(false)], collapsible: { defaultOpen: false } }),
    );
    await user.click(screen.getByRole('button', { name: /Grapes/ }));
    expect(screen.getByRole('button', { name: 'Tier A, 2 farms' })).toBeInTheDocument();
  });

  it('marks the chosen option pressed, and unpresses it on a second click', async () => {
    const user = userEvent.setup();
    renderList(config({ facets: [CROP], collapsible: { defaultOpen: false } }));

    await user.click(screen.getByRole('button', { name: /Grapes/ }));
    expect(screen.getByRole('button', { name: /Grapes/ })).toHaveAttribute('aria-pressed', 'true');

    /* Pressing the option again clears it but leaves the list open — only the
       CHIP returns to the summary. Two controls, two different landings. */
    await user.click(screen.getByRole('button', { name: /Grapes/ }));
    expect(screen.getByRole('button', { name: /Grapes/ })).toHaveAttribute('aria-pressed', 'false');
    expect(order()).toHaveLength(4);
  });

  it('resets to page 1 when a filter changes', async () => {
    const user = userEvent.setup();
    renderList(
      config({
        facets: [CROP],
        collapsible: { defaultOpen: false },
        pagination: { mode: 'server', page: 3, pageSize: 2, totalCount: 9, onPage: vi.fn() },
      }),
      '/?page=3',
    );
    await user.click(screen.getByRole('button', { name: /Grapes/ }));
    expect(screen.getByTestId('url').textContent).toContain('page=1');
  });
});

/* ═══════════════════════════════════════════════ search: index and cost */

describe('search', () => {
  it('builds the romanised index ONCE across a burst of typing', async () => {
    const user = userEvent.setup();
    /* THE measured constraint. Task 6: ~0.4 ms to scan 3,000 rows, ~60 ms to
       BUILD the index. 60 ms is a dropped frame, so a rebuild inside a
       keystroke handler turns an instant search into a broken-feeling one —
       worse than the current no-search, because a laggy box invites
       retyping. `keys` is called once per row, full stop. */
    const keys = vi.fn((r: Farm) => [r.name, r.owner]);
    renderList(config({ search: { mode: 'client', commit: 'submit', placeholder: 'Search…', keys } }));

    expect(keys).toHaveBeenCalledTimes(ROWS.length);

    await user.type(screen.getByRole('textbox'), 'bhosl');
    expect(keys).toHaveBeenCalledTimes(ROWS.length);

    await user.type(screen.getByRole('textbox'), 'e{Enter}');
    expect(keys).toHaveBeenCalledTimes(ROWS.length);
  });

  it('finds a Devanagari name typed in Latin letters', async () => {
    const user = userEvent.setup();
    renderList(
      config({
        search: { mode: 'client', commit: 'submit', placeholder: 'Search…', keys: (r) => [r.name] },
      }),
    );
    /* भोसले, typed by someone who heard it on the phone. */
    await user.type(screen.getByRole('textbox'), 'bhosle{Enter}');
    expect(order()).toEqual(['भोसले']);
  });

  it('does not write the URL until Enter — the draft contract', async () => {
    const user = userEvent.setup();
    renderList(
      config({
        search: { mode: 'client', commit: 'submit', placeholder: 'Search…', keys: (r) => [r.name] },
      }),
    );
    const input = screen.getByRole('textbox');

    await user.type(input, 'anand');
    /* Syncing per keystroke would push one history entry per character, so
       Back would walk back through the word letter by letter (A21). */
    expect(screen.getByTestId('url').textContent).not.toContain('search=');
    expect(order()).toHaveLength(4);

    await user.type(input, '{Enter}');
    expect(screen.getByTestId('url').textContent).toContain('search=anand');
    expect(order()).toEqual(['Anand Farm']);
  });

  it('commits on blur as well as Enter, trimmed — the API Errors contract', async () => {
    const user = userEvent.setup();
    renderList(
      config({
        search: {
          mode: 'client',
          commit: 'blur-or-enter',
          paramKey: 'endpoint',
          placeholder: 'Endpoint…',
          keys: (r) => [r.name],
        },
      }),
    );
    const input = screen.getByRole('textbox');

    await user.type(input, '  anand  ');
    expect(screen.getByTestId('url').textContent).not.toContain('endpoint=');

    await user.tab();
    /* Trimmed, and applied by leaving the box — the habit of an on-call
       engineer who types and tabs away. */
    expect(screen.getByTestId('url').textContent).toContain('endpoint=anand');
    expect(order()).toEqual(['Anand Farm']);
  });

  it('does not filter locally when the search is server-side', async () => {
    const user = userEvent.setup();
    renderList(
      config({ search: { mode: 'server', commit: 'submit', placeholder: 'Search…' } }),
    );
    await user.type(screen.getByRole('textbox'), 'anand{Enter}');
    /* The URL is written; the screen's own hook refetches. This component
       does not pretend to have filtered a page it did not fetch. */
    expect(screen.getByTestId('url').textContent).toContain('search=anand');
    expect(order()).toHaveLength(4);
  });

  it('collapses an expanded row that a search hides', async () => {
    const user = userEvent.setup();
    renderList(
      config({
        expand: (r) => <p>Owner on file: {r.owner}</p>,
        search: { mode: 'client', commit: 'submit', placeholder: 'Search…', keys: (r) => [r.name] },
      }),
    );
    fireEvent.click(table().querySelectorAll('tbody > tr')[0]);
    expect(screen.getByText(/Owner on file: Ramesh/)).toBeVisible();

    await user.type(screen.getByRole('textbox'), 'anand{Enter}');
    expect(screen.queryByText(/Owner on file: Ramesh/)).toBeNull();
  });
});

/* ══════════════════════════════════════════════ the four causes, not one */

describe('the honest states', () => {
  it('renders a load failure as a failure, with a retry that retries', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderList(
      config({ states: { ...config().states, error: new Error('Request failed with status 500'), onRetry } }),
    );
    /* Seven screens render a 500 as "No errors found. The system is
       healthy." today. Not here. */
    expect(screen.getByRole('alert')).toHaveAttribute('data-state', 'load-failed');
    expect(screen.getByText(/Request failed with status 500/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an empty result as a MEASURED zero that names its window', () => {
    renderList(config({ rows: [] }));
    const block = screen.getByRole('status');
    expect(block).toHaveAttribute('data-state', 'measured-zero');
    expect(screen.getByText('No farms in this organisation')).toBeInTheDocument();
    expect(screen.getByText(/checked at 09:12 today/)).toBeInTheDocument();
  });

  it('renders a filtered-to-nothing list as a NO MATCH, not as a zero', async () => {
    const user = userEvent.setup();
    renderList(
      config({
        rows: ROWS.filter((r) => r.crop === 'grapes'),
        facets: [CROP],
        collapsible: { defaultOpen: false },
      }),
    );
    await user.click(screen.getByRole('button', { name: /Sugarcane/ }));
    /* A measured zero is a fact about the farms. A no-match is a fact about
       the box you typed in. Collapsing them tells an operator the system is
       quiet when it is only being filtered. */
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'no-match');
    expect(screen.getByText(/Nothing matches Sugarcane/)).toBeInTheDocument();
  });

  it('sends the no-match clear control back to the summary as well', async () => {
    const user = userEvent.setup();
    renderList(
      config({
        rows: ROWS.filter((r) => r.crop === 'grapes'),
        facets: [CROP],
        collapsible: { defaultOpen: false },
      }),
    );
    await user.click(screen.getByRole('button', { name: /Sugarcane/ }));
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: /Sugarcane/ })).toBeInTheDocument();
  });

  it('names the time a dead feed stopped and shows no rows under it', () => {
    renderList(
      config({ states: { ...config().states, feedDown: { since: '06:12 today', lastGood: '41 logs at 06:11' } } }),
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-state', 'feed-down');
    expect(screen.getByText(/Feed down since 06:12 today/)).toBeInTheDocument();
    /* Nothing below the line is current, so nothing below the line is drawn. */
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a skeleton shaped like the real table, and says which list is loading', () => {
    renderList(config({ states: { ...config().states, isLoading: true }, skeleton: { rows: 3, cells: 5 } }));
    const block = screen.getByRole('status', { name: 'Loading Test farms' });
    expect(block).toHaveAttribute('aria-busy', 'true');
    expect(block.querySelectorAll('tbody > tr')).toHaveLength(3);
    expect(block.querySelectorAll('tbody > tr:first-child > td')).toHaveLength(5);
    /* A page with five panels loading at once and no names produces five
       identical announcements, which is the same as none. */
    expect(screen.getByText('Loading Test farms')).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════ the slots */

describe('the slots a screen fills', () => {
  it('renders row actions only when a screen supplies them (B15)', () => {
    const { unmount } = renderList(config());
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    unmount();

    renderList(config({ actions: (r) => <button type="button">Open {r.id}</button> }));
    expect(screen.getByRole('button', { name: 'Open f1' })).toBeInTheDocument();
  });

  it('carries an sr-only caption when a screen writes one', () => {
    renderList(config({ caption: 'Every farm with its score and its errors.' }));
    expect(screen.getByText('Every farm with its score and its errors.')).toBeInTheDocument();
  });

  it('draws the leading edge only on the rows a screen marks', () => {
    renderList(config({ rowEdge: (r) => (r.errors > 0 && !r.errorsState ? 'red' : null) }));
    const rows = [...table().querySelectorAll<HTMLTableRowElement>('tbody > tr')];
    /* An edge on every row is decoration; an edge on two of them is a
       finding. */
    const edged = rows.filter((tr) => tr.style.boxShadow !== '');
    expect(edged).toHaveLength(2);
  });

  it('singularises its noun', () => {
    renderList(config({ rows: [ROWS[0]] }));
    expect(screen.getByText('farm')).toBeInTheDocument();
  });
});
