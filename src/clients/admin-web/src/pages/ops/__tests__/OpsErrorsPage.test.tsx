import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles } from '@/test/stubAdapter';
import type { StubbedAdapter } from '@/test/stubAdapter';
import type { OpsErrorEvent } from '@/hooks/useOpsErrors';
import OpsErrorsPage from '../OpsErrorsPage';

/**
 * API ERRORS — the operator's log.
 *
 * Four assertions carry this file, and three of them are capabilities that a
 * screen-by-screen port from a prototype deletes without anyone noticing:
 *
 *  1. `?since` STILL FILTERS, AND NOW HAS A CONTROL (A16). It is threaded to
 *     the server from a saved link, and the new buttons write it. The
 *     prototype has no such parameter, so a port that trusted the design
 *     would have dropped a working filter and found out when an on-call
 *     engineer's bookmark stopped narrowing.
 *
 *  2. THE ENDPOINT BOX COMMITS ON BLUR AND ON ENTER, FROM AN UNCONTROLLED
 *     INPUT (A21). Farms and Users hold a draft and commit on Enter or a
 *     button and at no other moment. The two look identical in a screenshot.
 *     Every assertion below is written so that it would FAIL under the draft
 *     contract — a test that merely watches Enter work proves nothing,
 *     because Enter works under both.
 *
 *  3. THE SERVER STILL DECIDES HOW MANY PAGES THERE ARE (A17, A50, B4). This
 *     screen was the console's only `@tanstack/react-table` caller, and the
 *     library is gone. The behaviour it was there for is asserted directly.
 *
 *  4. AN EMPTY ANSWER IS NOT A MEASUREMENT. `GetErrorsPagedAsync` ends
 *     `catch { return new OpsErrorsPageDto([], 0, page, pageSize); }`
 *     (`AdminOpsRepository.cs:253`), so a database failure reaches this
 *     client as an empty list with HTTP 200. "This is a measured zero, not a
 *     missing feed" is a sentence this screen may not say.
 */

const ORG = '11111111-1111-1111-1111-111111111111';

function ev(over: Partial<OpsErrorEvent> = {}): OpsErrorEvent {
  return {
    eventType: 'api.error',
    endpoint: 'POST /shramsafal/sync/push',
    statusCode: 500,
    latencyMs: 1490,
    farmId: null,
    occurredAtUtc: '2026-09-01T08:15:30Z',
    ...over,
  };
}

const LAST_REFRESHED = '2026-09-01T08:30:00.000Z';

/**
 * THE REAL ENVELOPE. `AdminMetaDto` is `(Source, Window, LastRefreshedUtc,
 * TtlSeconds)`, so the server sends `lastRefreshedUtc`. Stubbing the other
 * spelling is how eight screens shipped a fabricated "Live · now" age against
 * a shape the server never sends.
 */
function envelope(items: OpsErrorEvent[], totalCount = items.length, page = 1) {
  return {
    data: { items, totalCount, page, pageSize: 50 },
    meta: {
      source: 'live',
      window: 'last 24h',
      lastRefreshedUtc: LAST_REFRESHED,
      ttlSeconds: 30,
    },
  };
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serve(items: OpsErrorEvent[], totalCount = items.length) {
  stub = installAdapter(async (req) => {
    const page = Number(new URL(req.url, 'http://x').searchParams.get('page') ?? 1);
    return { status: 200, data: envelope(items, totalCount, page) };
  });
  return stub;
}

function renderErrors(route = `/ops/errors?org=${ORG}`) {
  return renderWithProviders(<OpsErrorsPage />, { route });
}

function table() {
  return screen.getByRole('table', { name: 'API errors' });
}

/** The list's own subtree. The screen carries a second `role="status"` block —
 *  the standing note — so an unscoped query would be ambiguous, not wrong. */
function list(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-list="ops-errors"]')!;
}

function stateBlock(role: 'status' | 'alert' = 'status'): HTMLElement {
  return within(list()).getByRole(role);
}

function dataRows(): HTMLTableRowElement[] {
  return [...table().querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter(
    (tr) => !tr.id.includes('detail'),
  );
}

/** The six columns, by position. Reading a WHOLE ROW is how a green test says
 *  nothing: every row on this screen contains "not attributable" somewhere the
 *  moment one cell does. */
const COL_TIME = 0,
  COL_TYPE = 1,
  COL_ENDPOINT = 2,
  COL_STATUS = 3,
  COL_LATENCY = 4,
  COL_FARM = 5;

function cell(row: HTMLTableRowElement, index: number): HTMLTableCellElement {
  return [...row.querySelectorAll('td')][index];
}

/** The last request the transport saw, as parsed params. */
function lastQuery(): URLSearchParams {
  return new URL(stub!.requests.at(-1)!.url, 'http://x').searchParams;
}

/** Waits for the SKELETON to go, not for the correct outcome — every cause
 *  below has to be able to assert the WRONG rendering first. */
async function settled() {
  await waitFor(() => expect(screen.queryByRole('status', { name: /Loading/ })).toBeNull());
}

/* ═══════════ 1. `?since` IS A WORKING FILTER, AND NOW HAS A CONTROL (A16) */

describe('the time window survives, and stops being reachable only by hand-editing the URL', () => {
  /**
   * ONE MOUNT, THREE PROPERTIES — read, clear, write — because the suite sits
   * on a measured timing cliff and this is a 35th parallel file (see the
   * report; Task 29 owns the cliff). Nothing is dropped to get there: each
   * property is asserted where it happens, in the order an operator meets it.
   */
  it('reads a saved ?since, hands the window back to the server, and writes a new one', async () => {
    const SAVED = '2026-08-30T06:00:00.000Z';
    const u = userEvent.setup();
    serve([ev()], 130);
    renderErrors(`/ops/errors?org=${ORG}&since=${SAVED}&page=3`);
    await settled();

    /*
     * ASSERTED FIRST, ON PURPOSE. This is the whole of A16: the parameter is
     * read from the url and reaches the query string. A port that dropped it
     * would still render a perfectly good screen — of the wrong window — and
     * the failure would surface as an on-call engineer's bookmark quietly
     * widening to 24 hours (`AdminOpsRepository.cs:204-205`).
     */
    expect(
      lastQuery().get('since'),
      'the ?since in the address bar never reached the server — the saved link an on-call engineer relies on now silently returns the 24-hour default the endpoint picks for itself',
    ).toBe(SAVED);

    /* And the screen says which window it is showing, read back out of the
       url rather than out of whichever button was last pressed. */
    expect(screen.getByText(/Showing everything recorded since 2026-08-30/)).toBeInTheDocument();

    /* The way back is a control too — an operator who narrowed must not have
       to edit the url to widen again. With nothing in the url the server
       picks the window, and the screen says so rather than naming a width it
       did not choose. */
    await u.click(screen.getByRole('button', { name: /Back to the default window/ }));
    await waitFor(() => expect(stub!.requests.at(-1)!.url).not.toContain('since='));
    expect(
      screen.getByText(/the server's own default window, the last 24 hours/),
    ).toBeInTheDocument();

    const before = Date.now();
    await u.click(screen.getByRole('button', { name: 'Last 6 hours' }));
    await waitFor(() => expect(stub!.requests.at(-1)!.url).toContain('since='));
    const after = Date.now();

    /*
     * AN ABSOLUTE INSTANT, NOT A TOKEN. The server parses `?since` with
     * `DateTime.TryParse` and falls back to 24 hours on anything it cannot
     * read (`AdminEndpoints.cs:123`), so a relative value like "6h" would put
     * a window in the address bar that the answer does not honour.
     */
    const since = Date.parse(lastQuery().get('since')!);
    const sixHours = 6 * 3_600_000;
    expect(
      Number.isNaN(since),
      'the window control wrote a value that is not a parseable instant — the server would ignore it and answer for 24 hours while the url claimed 6',
    ).toBe(false);
    expect(since).toBeGreaterThanOrEqual(before - sixHours - 5_000);
    expect(since).toBeLessThanOrEqual(after - sixHours + 5_000);

    /* A20 — a window change that left the reader on page 3 would show an
       empty list for a window that matched. And the org is a header: losing
       it is one organisation's data read under another's scope. */
    expect(lastQuery().get('page')).toBe('1');
    expect(stub!.requests.at(-1)!.headers['X-Active-Org-Id']).toBe(ORG);
  });
});

/* ═══════════ 2. THE BLUR-OR-ENTER CONTRACT, WHICH IS NOT THE OTHER ONE (A21) */

describe('the endpoint filter commits on blur AND on Enter, from an uncontrolled box', () => {
  it('applies when the operator tabs away, applies on Enter, and trims both', async () => {
    const u = userEvent.setup();
    serve([ev()], 130);
    renderErrors(`/ops/errors?org=${ORG}&page=3`);
    await settled();

    /* THE BUTTON IS HALF THE CONTRACT. The draft contract renders a Search
       button beside its box; this one renders none. Asserting its absence
       pins which contract is in use before anything is typed. */
    expect(
      screen.queryByRole('button', { name: /^Search/ }),
      'a Search button appeared beside the endpoint filter — that is the draft contract (Farms, Users), and this screen commits on blur as well',
    ).toBeNull();

    const box = screen.getByRole('textbox', { name: 'Filter by endpoint' });
    await u.type(box, '  /sync/push  ');

    /* Typing is still not a query under either contract. */
    expect(
      stub!.requests.some((r) => r.url.includes('endpoint=')),
      'the endpoint filter refetched while the operator was still typing',
    ).toBe(false);

    /*
     * THE ASSERTION THAT WOULD FAIL UNDER THE OTHER CONTRACT. Leaving the box
     * applies the filter. Under `commit: 'submit'` nothing happens here, the
     * operator's habit of typing and tabbing away silently stops working, and
     * no screenshot shows it.
     */
    await u.tab();
    await waitFor(() => expect(stub!.requests.at(-1)!.url).toContain('endpoint='));
    expect(
      lastQuery().get('endpoint'),
      'leaving the endpoint box did not apply the filter — this screen commits on blur as well as on Enter, and swapping it for the draft contract changes when a query runs',
    ).toBe('/sync/push');
    /* A20 again — the filter change goes back to page 1. */
    expect(lastQuery().get('page')).toBe('1');

    /* And Enter commits too — the OR in "blur or Enter" is not decorative. */
    await u.clear(box);
    await u.type(box, '  /ai/parse-voice  {Enter}');
    await waitFor(() => expect(lastQuery().get('endpoint')).toBe('/ai/parse-voice'));
  });

  it('is genuinely uncontrolled: clearing the applied filter does not retype the box', async () => {
    const u = userEvent.setup();
    serve([ev()], 130);
    renderErrors();
    await settled();

    const box = screen.getByRole('textbox', { name: 'Filter by endpoint' });
    await u.type(box, '/logs');
    await u.tab();
    await waitFor(() => expect(lastQuery().get('endpoint')).toBe('/logs'));

    /* The conditional Clear filter button — it exists only while a filter is
       applied, which is the third half of A21's sentence. */
    const clear = screen.getByRole('button', { name: 'Clear filter' });
    await u.click(clear);
    await waitFor(() => expect(stub!.requests.at(-1)!.url).not.toContain('endpoint='));

    /*
     * THE UNCONTROLLED PROOF, AND IT IS BEHAVIOURAL RATHER THAN A CLASS NAME.
     * `clearSearch()` calls `setDraft('')` on both contracts. A CONTROLLED box
     * — `value={draft}` — empties on screen when that runs. This box is
     * `defaultValue`, so React never writes the DOM value again after mount
     * and the operator's text stays put while the applied filter goes.
     * `useListUrlState`'s header records that as today's deliberate
     * behaviour on all three search screens.
     */
    expect(
      (box as HTMLInputElement).value,
      'clearing the filter emptied the box — this input is uncontrolled (defaultValue), and a box that re-syncs from the url is the draft contract wearing this one\'s clothes',
    ).toBe('/logs');

    /* And the button goes with the filter it clears. */
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull();
  });
});

/* ═══════════ 3. THE SERVER DECIDES THE PAGE COUNT (A17, A50, B4, B13) */

describe('server pagination survived the loss of the table library', () => {
  it('asks for 50 per page, pages from the SERVER total, and hides the pager on one page', async () => {
    const u = userEvent.setup();
    serve([ev()], 130);
    renderErrors();
    await settled();

    expect(stub!.requests[0].url).toContain('pageSize=50');
    expect(stub!.requests[0].url).toContain('page=1');

    /*
     * 130 over 50 is three pages — derived from the count the SERVER sent,
     * never from the one row in hand. That is the whole of A50: the client
     * holds a page and cannot know how many there are.
     */
    const pager = screen.queryByRole('navigation', { name: 'API errors pagination' });
    expect(
      pager,
      'the pager is gone — the page count was derived from the rows in hand rather than the server total, so with one row on a 130-row window page 2 is unreachable',
    ).not.toBeNull();
    expect(
      pager!.textContent,
      'the page count did not come from the SERVER total — the client holds one page and cannot know how many there are',
    ).toContain('Page 1 of 3');
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();

    await u.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(lastQuery().get('page')).toBe('2'));

    /* B13 / A25 — a BACKGROUND fetch says so instead of changing the table
       silently. A first load shows the skeleton; only a poll shows this. */
    stub!.restore();
    stub = installAdapter(neverSettles);
    await u.click(screen.getByRole('button', { name: /Prev/ }));
    await screen.findByText(/Refreshing/);

    /* One page, no pager — HIDDEN, not disabled, which is what the console
       does today on all three paginated screens. */
    stub!.restore();
    serve([ev()], 1);
    const only = renderErrors();
    await settled();
    expect(within(only.container).queryByText(/Page 1 of/)).toBeNull();
  });
});

/* ═══════════ 4. AN EMPTY ANSWER IS NOT A MEASUREMENT (D9, Step 4) */

describe('an absence names its cause, and an empty list is never called a measured zero', () => {
  it('does not claim a measured zero over an answer this endpoint cannot prove', async () => {
    serve([]);
    renderErrors();
    await settled();

    /*
     * ASSERTED FIRST. `MeasuredZero` closes every rendering with this
     * sentence, and this endpoint answers a database failure with an empty
     * list and HTTP 200 (`AdminOpsRepository.cs:253`) — so a quiet window and
     * an unreachable analytics database arrive identical, and the sentence is
     * one the screen cannot stand behind.
     */
    expect(
      screen.queryByText(/This is a measured zero, not a missing feed/),
      'the empty log was presented as a measured zero — this endpoint answers a database failure with an empty list and a success code, so the zero cannot be claimed as a reading',
    ).toBeNull();

    /* And the old string, which said something stronger and worse. */
    expect(
      screen.queryByText(/The system is healthy/),
      'the console still renders "No errors found. The system is healthy." — a 500, a timeout and a 403 reported to an operator as a clean bill of health, on the screen whose job is to show failures',
    ).toBeNull();

    await screen.findByText('No call came back for this window');
    expect(stateBlock()).toHaveAttribute('data-state', 'unmeasured');
    expect(
      screen.getByText(/ends in a bare catch that returns an empty list with a success code/),
    ).toBeInTheDocument();

    /*
     * AND THE TIME IT NAMES COMES FROM THE KEY THE SERVER ACTUALLY SENDS.
     * Merged into this mount rather than given its own: same fixture, same
     * render, and the suite is at a measured timing cliff that one more
     * parallel file makes worse (Task 29's problem).
     */
    expect(
      screen.queryByText(/a time the server did not report/),
      'the screen read `meta.lastRefreshed`, and the server sends `meta.lastRefreshedUtc` — so it reported having no timestamp while holding one',
    ).toBeNull();
    expect(screen.getByText(/the server reported this answer at 2026-09-01 /)).toBeInTheDocument();
  });

  it('renders a 500 as a failure with a retry, not as a quiet platform', async () => {
    stub = installAdapter(async () => ({ status: 500, data: {} }));
    renderErrors();
    await settled();

    expect(
      screen.queryByText(/The system is healthy/),
      'a broken request rendered as a healthy system — the exact D9 defect this screen is named for',
    ).toBeNull();
    expect(
      screen.queryByText('No call came back for this window'),
      'a 500 was reported as an empty window — a fact about the request stated as a fact about the platform',
    ).toBeNull();

    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('answers an endpoint filter that matched nothing as a no-match, and says what it matches', async () => {
    serve([], 0);
    renderErrors(`/ops/errors?org=${ORG}&endpoint=zzz`);
    await settled();

    expect(
      screen.queryByText('No call came back for this window'),
      'a filter that matched nothing was reported as an empty window — a fact about the box you typed in stated as a fact about the platform',
    ).toBeNull();
    expect(stateBlock()).toHaveAttribute('data-state', 'no-match');
    expect(screen.getByText(/matches any part of the endpoint, ignoring case/)).toBeInTheDocument();
  });

  it('shows a skeleton shaped like this table while the first request is in flight (B12)', async () => {
    stub = installAdapter(neverSettles);
    renderErrors();

    const loading = await screen.findByRole('status', { name: /Loading API errors/ });
    expect(loading.querySelectorAll('tbody > tr')).toHaveLength(8);
    expect(loading.querySelectorAll('tbody > tr:first-child > td')).toHaveLength(6);
  });
});

/* ═══════════ 5. ATTRIBUTION, AND THE THREE THINGS THIS FEED CALLS AN ERROR */

describe('a call nobody can tie to a farm says so, and never guesses one (Step 7)', () => {
  it('names the farm when there is one and reads "not attributable" when there is not', async () => {
    const FARM = 'ffffffff-1111-2222-3333-444444444444';
    serve([
      ev({ farmId: FARM, occurredAtUtc: '2026-09-01T08:15:30Z' }),
      ev({ farmId: null, occurredAtUtc: '2026-09-01T07:04:05Z' }),
    ]);
    renderErrors();
    await settled();

    const [attributed, orphan] = dataRows();

    /*
     * NARROWED TO THE CELL, DELIBERATELY. Reading the whole row would pass the
     * moment ANY cell on it held the words — and on this screen four of the
     * six cells can render an honesty state, so a row-level assertion here is
     * green whatever the Farm column does.
     */
    /* "not attributable" and "not measured" are different facts and the
       console has different words for them (`honestState.ts:52-57`). This one
       is the fourth word and it is NOT the default the others fall back to,
       so it is asserted as a difference and not just as a presence.

       Read off `textContent` rather than through `toHaveTextContent`: the
       jest-dom matchers build their own failure text and drop the message
       passed to `expect`, and a red run that does not name the defect is
       half a test. */
    expect(
      cell(orphan, COL_FARM).textContent,
      'an unattributed call was labelled "not measured" — nothing failed to measure this; nothing ever tied it to a subject, which is a different fact and has its own word',
    ).not.toContain('not measured');
    expect(
      cell(orphan, COL_FARM).textContent,
      'the Farm cell of an unattributable call did not say so — a bare dash here makes the reader supply the reason, and the reason they supply is "no farms were affected"',
    ).toContain('not attributable');
    expect(cell(orphan, COL_FARM).querySelector('[data-state]')).toHaveAttribute(
      'data-state',
      'unattributed',
    );

    /* And a row that DOES carry a farm must not be told it has none — the
       same fabrication pointing the other way. */
    expect(
      cell(attributed, COL_FARM).textContent,
      'a call that names a farm was reported as unattributable',
    ).not.toContain('not attributable');
    /* WHOLE, not truncated. The old cell printed the first eight characters
       and an ellipsis, which is an identifier an operator cannot paste into
       a query or a ticket — the only two things it is for. */
    expect(
      cell(attributed, COL_FARM).textContent,
      'the farm id is truncated — eight characters and an ellipsis cannot be pasted into a query or a ticket, which is all this value is for',
    ).toContain(FARM);

    /* A51 — the full date WITH seconds on this surface, because an operator
       may be looking days back. Ops Live shows time only. */
    expect(cell(attributed, COL_TIME)).toHaveTextContent(/^2026-09-01 \d\d:\d\d:30$/);
  });

  it('does not call a slow success a failure, and does not print "unknown" as an endpoint', async () => {
    serve([
      ev({ eventType: 'api.slow', statusCode: 200, latencyMs: 3200 }),
      /* What the server sends for an error the farmer's own device reported:
         `COALESCE(props->>'endpoint','unknown')` over a payload whose
         vocabulary requires only a message. */
      ev({
        eventType: 'client.error',
        endpoint: 'unknown',
        statusCode: null,
        latencyMs: null,
        occurredAtUtc: '2026-09-01T06:00:00Z',
      }),
    ]);
    renderErrors();
    await settled();

    const [slow, client] = dataRows();

    /* A write that succeeded and took over two seconds is not a 500, and on
       the screen titled API Errors it must not be painted like one. */
    expect(cell(slow, COL_TYPE).textContent).toContain('api.slow');
    expect(
      cell(slow, COL_TYPE).querySelector('[data-type]')!.className,
      'a write that succeeded and was merely slow is painted the colour of a 500 — a verdict the data does not support, on the screen whose title already over-claims',
    ).toContain('text-amber');
    expect(cell(slow, COL_STATUS).querySelector('span')!.className).not.toContain('text-red');

    /*
     * THE SENTINEL IS AN ABSENCE, NOT AN ENDPOINT. Printing the literal
     * "unknown" in an endpoint column invites a reader to search for it, and
     * the filter that would answer them matches on the very property this row
     * does not have.
     */
    expect(
      cell(client, COL_ENDPOINT).textContent,
      'the COALESCE sentinel "unknown" was printed as if it were an endpoint — a reader who searches for it gets nothing, because the filter matches the very property this row does not have',
    ).not.toContain('unknown');
    expect(cell(client, COL_ENDPOINT).textContent).toContain('not measured');
    expect(cell(client, COL_STATUS).textContent).toContain('not measured');
    expect(cell(client, COL_LATENCY).textContent).toContain('not measured');
  });
});
