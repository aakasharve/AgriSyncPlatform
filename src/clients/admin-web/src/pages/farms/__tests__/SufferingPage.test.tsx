import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles } from '@/test/stubAdapter';
import type { StubbedAdapter } from '@/test/stubAdapter';
import type { SufferingItem } from '@/hooks/useFarms';
import SufferingPage from '../SufferingPage';

/**
 * SUFFERING — the screen whose empty state said "great!".
 *
 * The central assertion of this file is the FOUR CAUSES, and it is the first
 * describe block for that reason. Everything else here is a variant of
 * something Tasks 14 and 15 already proved; the celebration is the one defect
 * that is worse on this screen than anywhere else in the console, because
 * here "nothing to report" is the best possible news — so printing it over a
 * 500 does not merely fail to inform the reader, it reassures them.
 */

const ORG = '11111111-1111-1111-1111-111111111111';

function row(over: Partial<SufferingItem> = {}): SufferingItem {
  return {
    farmId: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: 'भोसळे मळा',
    errorCount: 7,
    syncErrors: 2,
    logErrors: 0,
    voiceErrors: 5,
    lastErrorAt: '2026-08-31T09:15:00Z',
    ...over,
  };
}

const LAST_REFRESHED = '2026-09-01T08:30:00.000Z';

/** The real envelope: `AdminMetaDto("live-aggregated", "last 24h", …, 60)`
 *  (`GetSufferingHandler.cs:16`), over a RAW ARRAY — this endpoint has no
 *  items/totalCount wrapper and no pages. The `window` string is carried
 *  verbatim including its error: the matview's window is SEVEN DAYS. */
function envelope(items: SufferingItem[]) {
  return {
    data: items,
    meta: {
      source: 'live-aggregated',
      window: 'last 24h',
      lastRefreshedUtc: LAST_REFRESHED,
      ttlSeconds: 60,
    },
  };
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serve(items: SufferingItem[]) {
  stub = installAdapter(async () => ({ status: 200, data: envelope(items) }));
  return stub;
}

function renderSuffering(route = `/farms/suffering?org=${ORG}`) {
  return renderWithProviders(<SufferingPage />, { route });
}

function table() {
  return screen.getByRole('table', { name: 'Farmer suffering watchlist' });
}

/** The list's own subtree. The screen carries one more `role="status"` block —
 *  the standing note — so an unscoped `getByRole('status')` would be
 *  ambiguous rather than wrong. */
function list(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-list="suffering"]')!;
}

function stateBlock(role: 'status' | 'alert' = 'status'): HTMLElement {
  return within(list()).getByRole(role);
}

/** The visible data rows — the detail rows carry an id and are excluded. */
function dataRows(): HTMLTableRowElement[] {
  return [...table().querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter(
    (tr) => !tr.id.includes('detail'),
  );
}

function cellsOf(tr: HTMLTableRowElement): HTMLTableCellElement[] {
  return [...tr.querySelectorAll('td')];
}

/** The farm-name cell of every visible row, in DOM order. */
function order(): string[] {
  return dataRows().map((tr) => cellsOf(tr)[0]?.textContent?.trim() ?? '');
}

async function summaryAppears() {
  await screen.findByText(/between them/);
}

/**
 * THE ANCHOR EVERY CAUSE TEST WAITS ON, and it is deliberately not
 * `findByRole('alert')`.
 *
 * Waiting for the CORRECT outcome makes the first red line "Unable to find
 * role=alert" — a missing element, which names the symptom. Every cause below
 * has to be able to assert the CELEBRATION first, because the celebration is
 * the defect. So the wait is for the skeleton to go, which happens in every
 * world: the correct one, and the one where an unqualified empty is rendered
 * over a 500.
 */
/**
 * SETTLE_WAIT - measured 2026-09-01. Not a tolerance for slow tests.
 *
 * This waited on Testing Library's 1000ms default. Under full-suite parallelism
 * 36 jsdom environments compete for the same cores, and the loading block had
 * not always cleared inside one second - so an assertion that a state is ABSENT
 * ran while the previous state was still on screen, and the failure read
 * `expected <div role="status"> to be null`, which looks like a product defect
 * and is not one.
 *
 * The same missing argument caused the "timing cliff" Tasks 15-19 each measured
 * and each routed onward. Nothing is weakened: a real regression still fails, it
 * just fails after waiting rather than before the screen has finished changing.
 */
const SETTLE_WAIT = 15_000;

async function settled() {
  await waitFor(() => expect(screen.queryByRole('status', { name: /Loading/ })).toBeNull(), {
    timeout: SETTLE_WAIT,
  });
}

/** Open the rows. The v3 summary-first gate stays on this screen. */
async function showAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Show all/ }));
}

function optionsOf(group: string): string[] {
  return within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? '');
}

/* ═════════════════ STEP 2 / D9 — four causes, and none of them is "great!" */

describe('an absence names its cause, and never celebrates (D9, Step 2)', () => {
  it('renders a 500 as a failure with a retry — not as "great!", and not as "0 farms"', async () => {
    const user = userEvent.setup();
    stub = installAdapter(async () => ({ status: 500, data: {} }));
    renderSuffering();

    await settled();

    /*
     * ASSERTED FIRST, ON PURPOSE — this is the single worst string in the
     * console and the reason Task 16 exists. The old screen rendered
     * "No farms with repeated errors — great!" for every absence it could
     * have, so a 500, a timeout and a 403 all came back as congratulation. On
     * a watchlist, an empty result is the best possible news, which makes it
     * the worst possible thing to print over a broken endpoint.
     */
    expect(
      screen.queryByText(/great!/),
      'a broken request rendered the celebration — "No farms with repeated errors — great!" was printed over a 500, so an outage was reported to the operator as good news',
    ).toBeNull();

    /*
     * SECOND. This screen is summary-first, so every figure in the summary is
     * computed from `rows` — and `rows` is `[]` over a 500. Task 15 found the
     * same trap one screen along, where a collapsed watchlist headlined
     * "0 farms" with the failure block sealed inside a `hidden` container.
     */
    expect(
      screen.queryByText('0 farms'),
      'a 500 rendered as "0 farms" — the summary reported a measurement it never took, and the failure block was hidden behind a collapsed list',
    ).toBeNull();

    await screen.findByRole('alert');
    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    expect(screen.getByText(/Request failed with status code 500/)).toBeInTheDocument();
    expect(screen.queryByText('No farms with repeated errors — great!')).toBeNull();

    const before = stub.requests.length;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(stub!.requests.length).toBeGreaterThan(before));
  });

  it('renders a TIMEOUT as its own failure, not as an empty watchlist', async () => {
    stub = installAdapter(async () => {
      throw Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' });
    });
    renderSuffering();

    await settled();
    expect(
      screen.queryByText(/great!/),
      'a timed-out request rendered the celebration — a request that never came back was reported as a clean watchlist',
    ).toBeNull();
    await screen.findByRole('alert');
    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    /* A timeout has no HTTP status, so it reaches `formatError` as a plain
       Error. It must still say what happened rather than fall through to the
       empty state. */
    expect(screen.getByText(/timeout of 20000ms exceeded/)).toBeInTheDocument();
    expect(screen.queryByText(/measured zero/)).toBeNull();
  });

  it('renders a 403 as a PERMISSION fact, distinct from both a 500 and an empty list', async () => {
    stub = installAdapter(async () => ({
      status: 403,
      data: { code: 'admin_module_forbidden', moduleKey: 'farms.suffering' },
    }));
    renderSuffering();

    await settled();
    expect(
      screen.queryByText(/great!/),
      'a refused permission rendered the celebration — an admin who may not see this list was told there is nothing on it',
    ).toBeNull();
    await screen.findByRole('alert');
    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    /* Typed by the response interceptor into `AdminModuleForbiddenError` and
       named by `describeAdminDenial` — never the raw code, and never a screen
       that reads as healthy. */
    expect(screen.getByText('Your admin access does not include this screen.')).toBeInTheDocument();
    expect(screen.queryByText(/status code 403/)).toBeNull();
  });

  it('renders a GENUINE empty as a measured zero that states the rule and the rebuild', async () => {
    serve([]);
    renderSuffering();

    await settled();
    /* Even the honest empty does not celebrate. A measured zero is a fact
       about the farms; "great!" is a verdict on a pipeline this screen cannot
       see the health of (see the swallowed-exception test below). */
    expect(
      screen.queryByText(/great!/),
      'a genuine empty still celebrated — an empty watchlist is a measured zero, not a clean bill of health for the pipeline behind it',
    ).toBeNull();

    await screen.findByText('No farm reached three failed events in the last seven days');
    expect(stateBlock()).toHaveAttribute('data-state', 'measured-zero');
    /* The window is the SERVER's `meta.lastRefreshed`, never a `new Date()`
       computed at render — that is the D5 fabricated-freshness defect. */
    expect(screen.getByText(/The window was checked at 01 Sep 26/)).toBeInTheDocument();
    /*
     * And it is QUALIFIED. `meta.lastRefreshed` is `DateTime.UtcNow` taken as
     * the request is served, while the matview behind it is rebuilt by the
     * nightly `MisRefreshJob`. An unqualified "checked at 08:30" would claim a
     * seven-day window had been recomputed at 08:30.
     */
    expect(
      screen.queryByText(/rebuilt only once a night/),
      'the measured zero stopped qualifying its own timestamp — meta.lastRefreshed is DateTime.UtcNow taken as the request is served, while the list behind it is rebuilt nightly, so an unqualified "checked at 08:30" claims a seven-day window was recomputed at 08:30',
    ).not.toBeNull();
    /* A measured zero is honest and IS shown as a figure: the request
       succeeded, so zero is the true headline. */
    expect(screen.getByText('0 farms')).toBeInTheDocument();
  });

  it('shows a skeleton shaped like this table while the first request is in flight (B12)', async () => {
    stub = installAdapter(neverSettles);
    renderSuffering();

    const loading = await screen.findByRole('status', {
      name: 'Loading Farmer suffering watchlist',
    });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('tbody > tr')).toHaveLength(8);
    /* Six columns, because the table has six. */
    expect(loading.querySelectorAll('tbody > tr')[0].querySelectorAll('td')).toHaveLength(6);
    /* Same rule as the 500: no summary figures before there is an answer. */
    expect(screen.queryByText('0 farms')).toBeNull();
  });

  it('says that an empty list is not proof the pipeline is healthy', async () => {
    serve([]);
    renderSuffering();
    await screen.findByText(/No farm reached three failed events/);

    /*
     * `GetSufferingAsync` closes with `catch { return []; }`
     * (`AdminMisRepository.cs:245`), so a dropped connection or a missing
     * matview is answered as an empty list with HTTP 200. The four causes
     * above are the four THIS CLIENT can see; the server can still turn a
     * database failure into a measured zero before the client is told. Saying
     * "measured zero" and stopping would inherit that quietly.
     */
    /* WORDING MOVED IN THE 2026-09-02 PLAIN-LANGUAGE PASS, PROPERTY DID NOT.
       These assertions guard a claim the screen has to keep making, not the
       sentence it makes it in. Each one below was re-pointed at the new
       wording in the same commit as the copy, and each still fails if the
       claim itself goes. */
    expect(
      screen.queryByText(/An empty list is not proof that nothing broke/),
      'the screen stopped warning that an empty answer can be a swallowed failure — GetSufferingAsync ends in `catch { return []; }`, so a dropped connection or a missing matview arrives as an empty list with HTTP 200 and this screen cannot tell it from a quiet week',
    ).not.toBeNull();
    expect(
      screen.getByText(/replies with an empty list and calls it a success/),
    ).toBeInTheDocument();
  });
});

/* ══════════════════════ STEP 3 — nothing marks an error resolved */

describe('every expanded row says resolution is not recorded (Step 3)', () => {
  it('says "Resolved — not measured" and does not soften it into a status', async () => {
    const user = userEvent.setup();
    serve([row({ farmId: 'f1', name: 'One Farm' })]);
    renderSuffering();
    await summaryAppears();
    await showAll(user);

    await user.click(dataRows()[0]);

    /*
     * THE SOFTENINGS ARE ASSERTED FIRST, AND THEY ARE THE POINT. "Unresolved",
     * "still open" and "outstanding" all claim this product looked and found
     * the problem live. It has never marked an error resolved at all — the
     * write surface that would is register row B15, a separate plan — so an
     * operator who fixed a farm's sync yesterday and reads "unresolved" today
     * has been misled by the console rather than by the data.
     */
    expect(
      screen.queryByText(/unresolved/i),
      'the resolution line was softened into "unresolved" — that claims this product tracks whether an error was fixed, and nothing in it marks an error resolved',
    ).toBeNull();
    expect(
      screen.queryByText(/still open/i),
      'the resolution line was softened into "still open" — an absent record is not a confirmed live problem',
    ).toBeNull();

    const term = screen.getByText('Resolved');
    const value = term.nextElementSibling as HTMLElement;
    expect(within(value).getByText('not measured')).toBeInTheDocument();

    /* And the consequence, said out loud: rows leave this list by TIME, not by
       anyone fixing anything. */
    /* "events age out of the seven-day window" -> "failures get older than
       seven days". Same fact, said to somebody who does not work here. */
    expect(
      screen.getByText(/when its failures get older than seven days/),
    ).toBeInTheDocument();
  });
});

/* ════════════════ STEP 4 — the deliberate asymmetry with Silent Churn */

describe('the facet counts hold still while you filter (Step 4)', () => {
  /** Three farms, overlapping channels: A is sync-only, B is logs-only, C is
   *  both sync and voice. So Sync holds two farms and pressing Voice — which
   *  yields only C — would drop Sync to one if the counts cross-filtered. */
  const FIXTURE = [
    row({ farmId: 'a', name: 'Sync Only', errorCount: 3, syncErrors: 3, logErrors: 0, voiceErrors: 0 }),
    row({ farmId: 'b', name: 'Logs Only', errorCount: 4, syncErrors: 0, logErrors: 4, voiceErrors: 0 }),
    row({ farmId: 'c', name: 'Sync And Voice', errorCount: 7, syncErrors: 2, logErrors: 0, voiceErrors: 5 }),
  ];

  it('keeps every count answering "how many are there" when a filter is pressed', async () => {
    const user = userEvent.setup();
    serve(FIXTURE);
    renderSuffering();
    await summaryAppears();

    expect(optionsOf('Filter by error type')).toEqual([
      'Sync, 2 farms',
      'Logs, 1 farm',
      'Voice, 1 farm',
    ]);

    /*
     * ⚠️ WHAT THIS TEST CAN AND CANNOT PROVE, stated rather than implied.
     *
     * The screen sets `crossFiltered: false`, and with ONE facet group that
     * flag cannot change a number: `facetOptionViews` cross-filters by calling
     * `passesFacets(row, facets, selection, facet.key)`, and `passesFacets`
     * skips the facet named in that last argument (`facets.ts:53`) — with no
     * other group, the skip covers everything. A mutation flipping the flag to
     * `true` therefore SURVIVES this file, knowingly.
     *
     * So this asserts the guarantee an operator actually has — the counts do
     * not move — and pins the group count, because the day a second facet is
     * added the flag stops being inert and this test starts having teeth.
     */
    expect(
      screen.getAllByRole('group').map((g) => g.getAttribute('aria-label')),
      'a second facet group was added — `crossFiltered` is no longer inert, so re-read Step 4 and assert the counts against the OTHER group being pressed',
    ).toEqual(['Filter by error type']);

    await user.click(screen.getByRole('button', { name: /^Voice,/ }));

    /*
     * ASSERTED FIRST. v3 deliberately does not cross-filter here — every
     * option count is built once from `rows` (`suffering.html:428-441`) and
     * `paintOptions()` (`:543-550`) only flips `aria-pressed`. Silent Churn
     * does the opposite, and the asymmetry is the decision: there you are
     * working THROUGH a list, so a button should promise the rows it will
     * hand you; here the question is "how many farms are hitting sync
     * errors", and an answer that moved because you had also clicked Voice
     * would stop being an answer.
     */
    expect(
      optionsOf('Filter by error type')[0],
      'a count moved when a filter was pressed — on this screen a count answers "how many are there", and one that shifts under the reader stops answering it',
    ).toBe('Sync, 2 farms');

    /* The filter itself still filters; it is only the COUNTS that hold still. */
    expect(order()).toEqual(['Sync And Voice']);
  });

  it('says in words that the three channels overlap and do not add up', async () => {
    serve(FIXTURE);
    renderSuffering();
    await summaryAppears();

    /*
     * Sync 2 + Logs 1 + Voice 1 = 4 over three farms, and the per-row figures
     * do not add up either: `error_count` is `COUNT(*)` over three event
     * types with no filter, while sync/log/voice are `COUNT(*) FILTER`
     * clauses over `props->>'endpoint'`. v3 asserts the opposite in as many
     * words — "their error counts sum to the N on the tile above"
     * (`suffering.html:408-410`) — and it is false against this feed.
     */
    expect(
      screen.queryByText(/including AI calls that succeeded/),
      'the summary stopped naming the inflation — `error_count` is COUNT(*) with no filter over api.error, client.error AND every ai.invocation, so a successful voice parse is added to the figure of a farm on a screen headed "suffering", and ORDER BY error_count DESC ranks the list by it',
    ).not.toBeNull();
    expect(
      screen.queryByText(/not a breakdown that adds up/),
      'the summary presented sync, logs and voice as a breakdown — they are three overlapping COUNT(*) FILTER clauses over the same events and do not sum to the total, which v3 asserts they do',
    ).not.toBeNull();
  });
});

/* ═══════════════════════════════ A57's twin — the rule, stated true */

describe('the rule-definition subtitle (A57)', () => {
  it('states the rule the query applies, not the one the old screen claimed', async () => {
    serve([row()]);
    renderSuffering();
    await summaryAppears();

    /*
     * The old subtitle: "Farms hitting repeated API errors in the last 24h.
     * Drill into a farm to see error details." Three of its four clauses were
     * false against the matview — the window is SEVEN DAYS, two of the three
     * qualifying event types are not API errors, and no row on that screen
     * was clickable at all. Only "repeated" survived, and it never said what
     * repeated meant. A57 records this line as the ONLY place this list's
     * definition is stated on screen, so it is preserved — as a true sentence.
     */
    expect(
      screen.queryByText(/last 24h/),
      'the subtitle claims a 24-hour window — the matview reads occurred_at_utc >= NOW() - INTERVAL 7 days, so the only on-screen statement of the rule for this list is wrong by a factor of seven',
    ).toBeNull();
    expect(
      screen.queryByText(/repeated API errors/),
      'the subtitle calls them API errors — two of the three qualifying event types are an error in the farmers own app and an AI call that failed, so the line names one of three and hides the two that are about the farmer',
    ).toBeNull();
    /* The entry condition is now split across a bold span, so the assertion
       reads the whole paragraph rather than its direct text nodes. The RULE is
       what A57 requires on screen, and all three of its parts are checked:
       the count, the window, and what counts as a failure. */
    const subtitle = document.querySelector('h1 + p') as HTMLElement;
    expect(
      subtitle.textContent,
      'the subtitle no longer states the entry condition — a farm reaches this list at three or more failed events, and a watchlist whose rule is unstated is a list nobody can act on',
    ).toMatch(/three or more things have failed in the last seven days/);
    expect(subtitle.textContent).toMatch(/an AI request did not complete/);
    /* The cap, which the old screen never mentioned: a reader seeing 50 rows
       had no way to know 50 was a ceiling and not a count. */
    expect(subtitle.textContent).toMatch(/sends 50 farms and no more/);

    /* NO PAGINATION, and it is not an omission: the endpoint has no `page`
       parameter, so a pager would be a control with nothing behind it. */
    expect(screen.queryByRole('navigation', { name: /pagination/ })).toBeNull();
    expect(stub!.requests[0].url).not.toContain('page=');
  });
});

/* ══════════════════════════════════════════ the cells, and the search */

describe('the cells', () => {
  it('names the figure for what it counts, falls back on a nameless farm, and never prints the redaction marker', async () => {
    const user = userEvent.setup();
    /* Three rows, one mount: the suite pays one page render instead of three. */
    serve([
      row({ farmId: 'p1', name: 'भोसळे मळा', errorCount: 9 }),
      row({ farmId: 'p2', name: 'Zebra Farm', errorCount: 6 }),
      /* `COALESCE(f.name, s.farm_id::text)` (`AdminMisRepository.cs:235`) — a
         watchlist row with no matching farm in `ssf.farms` arrives with its
         own id sitting in the name column. */
      row({ farmId: 'p3', name: 'p3', errorCount: 4 }),
      row({ farmId: 'p4', name: '**redacted**', errorCount: 3 }),
    ]);
    renderSuffering();
    await summaryAppears();
    await showAll(user);

    /*
     * ASSERTED FIRST. `error_count` is `COUNT(*)` over `api.error`,
     * `client.error` AND every `ai.invocation` — successes included — so
     * "Total Errors" is a name for a number this feed does not produce, and
     * `ORDER BY error_count DESC` ranks the list by it.
     */
    expect(
      screen.queryByText('Total Errors'),
      'the column is still headed "Total Errors" — the figure is COUNT(*) over three event types including AI calls that SUCCEEDED, so it is not a count of errors and the list is ranked by it',
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Events counted' })).toBeInTheDocument();

    /* Same defect, same column family: `last_error_at` is `MAX(occurred_at_utc)`
       over that same unfiltered group, so the newest row in it can be a
       successful voice parse. "Last Error" is a claim the SQL does not make. */
    expect(
      screen.queryByText('Last Error'),
      'the column is still headed "Last Error" — it is MAX(occurred_at_utc) over every qualifying event, so the time shown can be that of an AI call that SUCCEEDED',
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Last event' })).toBeInTheDocument();

    /* A34 — the font is chosen per VALUE. `vitest.config.ts` sets
       `css: false`, so an inline fontFamily is the only assertable evidence. */
    const marathi = within(cellsOf(dataRows()[0])[0]).getByText('भोसळे मळा');
    expect(marathi).toHaveAttribute('data-script', 'devanagari');
    expect(marathi.style.fontFamily).toContain('Noto Sans Devanagari');

    /* B16 — the frontend half. This endpoint does NOT redact today
       (`GetSufferingHandler` never calls `IResponseRedactor`) and carries no
       phone number at all, so the marker is what must already be handled the
       day masking arrives — and it must never reach the DOM. */
    expect(screen.queryByText('**redacted**')).toBeNull();
    expect(within(cellsOf(dataRows()[3])[0]).getByText('p4')).toHaveAttribute(
      'data-masked',
      'redacted',
    );

    /* Worst first, the server's own order, restored on the client. */
    expect(order()).toEqual(['भोसळे मळा', 'Zebra Farm', 'p3', 'p4']);

    /* A51 — `HH:mm, dd MMM` here, the hour FIRST and deliberately not the
       `dd MMM yyyy` on Silent Churn: a seven-day window makes the time of day
       the signal and the year noise. */
    expect(cellsOf(dataRows()[0])[5].textContent).toMatch(/^\d{2}:\d{2}, 31 Aug$/);
    expect(cellsOf(dataRows()[0])[1].textContent).toBe('9');

    /*
     * NEITHER A GUID NOR A REDACTION MARKER IS A POSITION IN AN ALPHABET.
     * Sorted by name, the farm whose only "name" is its own id and the farm
     * whose name is withheld both park at the BOTTOM — an order derived from
     * a missing row or from a permission is not an order derived from the
     * data. Without the guard, 'p3' sorts between 'Zebra Farm' and the
     * Devanagari name and the reader is handed an alphabet built out of
     * identifiers.
     */
    await user.click(screen.getByRole('button', { name: 'Farm' }));
    expect(
      order(),
      'a farm whose only name is its own id sorted into the alphabet — an identifier is not a name, and a withheld name is an order derived from the permission rather than from the data',
    ).toEqual(['Zebra Farm', 'भोसळे मळा', 'p3', 'p4']);

  });

  it('finds a Devanagari farm from a romanised phone-call spelling', async () => {
    const user = userEvent.setup();
    serve([
      row({ farmId: 'a', name: 'भोसळे मळा', errorCount: 9 }),
      row({ farmId: 'b', name: 'Zebra Farm', errorCount: 3 }),
    ]);
    renderSuffering();
    await summaryAppears();

    /* A support person HEARS "Bhosale" on the call and types it in Latin
       letters. Without the romanised index the search compares Latin against
       Devanagari and the call ends in "I cannot find you." A typed search is
       also one of the three ways the list opens. */
    await user.type(screen.getByRole('textbox', { name: 'Search the watchlist' }), 'bhosale{Enter}');
    expect(order()).toEqual(['भोसळे मळा']);
    expect(screen.getByText(/Showing/).textContent).toContain('1 of 2 farms');
  });

  it('says what the box actually searches when nothing matches', async () => {
    serve([row()]);
    renderSuffering(`/farms/suffering?org=${ORG}&search=9876543210`);
    await screen.findByText(/Nothing matches/);

    expect(stateBlock()).toHaveAttribute('data-state', 'no-match');
    /*
     * v3's own copy on this screen promises "farm, owner, village or phone".
     * One of those four is on this feed. Explaining a miss with a reason that
     * is not the reason is the same defect as an unqualified empty — and a
     * phone number is exactly what an operator would try here, because the
     * command palette deep-links searches by phone.
     */
    expect(screen.getByText(/no owner, phone, village, crop or plan/)).toBeInTheDocument();
  });
});
