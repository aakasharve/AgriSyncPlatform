import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import { DATE_FORMATS, fmt } from '@/lib/format';
import type { OpsErrorEvent, OpsFarmError, OpsHealthData } from '@/hooks/useOpsHealth';
import OpsLivePage from '../OpsLivePage';

/**
 * LIVE HEALTH — six mounts, and every central claim proven by breaking its
 * source rather than by reading the screen back to itself.
 *
 *  1. THE BADGE HAS THREE STATES, NOT TWO. The old one chose red or green on
 *     `breached === true`, so `null` — what the endpoint sends when the alert
 *     view cannot be read — was painted GREEN with a tick. Restoring that
 *     two-state expression turns test 1 red on the R10 assertions, which is
 *     how it was checked: the unread badge must not carry the green tint and
 *     must not read CLEAR. Plus R1–R8, which no longer claim anything.
 *
 *  2. THE CHIP STATES THE SERVER'S AGE (A27). The fixture's `computedAtUtc`
 *     is seven minutes old while the browser's fetch is milliseconds old, so
 *     reading `dataUpdatedAt` — what the old page did — makes the chip say
 *     "now" and the assertion fails by name.
 *
 *  3. THREE LISTS, THREE NAMESPACES. Sorting one table must not touch the
 *     others. The assertion is on the OTHER table's row order, so dropping
 *     `urlNamespace` fails here rather than in a screenshot.
 *
 *  4. NO FABRICATED ZERO AND NO CLAIMED ZERO. Five server zeroes are what the
 *     repository's `catch` substitutes, so they render as no reading; and an
 *     empty list from a feed that swallows its own failures is never called a
 *     measured zero.
 *
 *  5. THE DEV INSTRUCTION IS GONE (D7), AND THE TWO FAILURE SHAPES ARE
 *     DIFFERENT. A first load that fails has no numbers; a poll that starts
 *     failing has the last good ones, and they may never be shown as current.
 *
 * NARROW ASSERTIONS. Task 17 found a mutation surviving because an assertion
 * read a whole row and every row happened to contain the string it looked
 * for. Every figure below is read off ONE cell or ONE tile's value element.
 */

const ORG = '11111111-1111-1111-1111-111111111111';

/** Seven minutes before the test runs. The browser's own fetch time is
 *  milliseconds old, so the two cannot be confused for one another. */
const SEVEN_MINUTES_AGO = new Date(Date.now() - 7 * 60_000).toISOString();

/** 02:04 UTC — a few minutes after MisRefreshJob's 02:00 rebuild, which is
 *  what a nightly screen's envelope carries. */
const NIGHTLY_RUN = '2026-09-01T02:04:00.0000000Z';

function health(over: Partial<OpsHealthData> = {}): OpsHealthData {
  return {
    voiceInvocations24h: 1402,
    voiceFailures24h: 56,
    voiceFailureRatePct: 4,
    voiceAvgLatencyMs: 980,
    voiceP95LatencyMs: 2100,
    recentErrors: [],
    topSufferingFarms: [],
    apiErrorSpike: false,
    voiceDegraded: false,
    computedAtUtc: SEVEN_MINUTES_AGO,
    ...over,
  };
}

function event(over: Partial<OpsErrorEvent> = {}): OpsErrorEvent {
  return {
    eventType: 'api.error',
    endpoint: '/shramsafal/sync/push',
    statusCode: 500,
    latencyMs: 240,
    farmId: '22222222-2222-2222-2222-222222222222',
    occurredAtUtc: '2026-09-01T11:40:00.0000000Z',
    ...over,
  };
}

function farm(over: Partial<OpsFarmError> = {}): OpsFarmError {
  return {
    farmId: '33333333-3333-3333-3333-333333333333',
    errorCount: 9,
    syncErrors: 4,
    logErrors: 2,
    voiceErrors: 0,
    lastErrorAt: '2026-09-01T11:38:00.0000000Z',
    ...over,
  };
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serve(data: OpsHealthData) {
  /* The endpoint sends the DTO BARE — no `AdminResponse` wrapper, no `meta`
     (A27). A fixture that wrapped it would be testing a different endpoint. */
  stub = installAdapter(async () => ({ status: 200, data }));
  return stub;
}

/** Reads MemoryRouter's location, so a URL assertion is about what the router
 *  saw rather than about jsdom's address bar. */
function Probe() {
  const location = useLocation();
  return <span data-testid="url">{location.search}</span>;
}

function renderLive(options: { route?: string; queryClient?: ReturnType<typeof makeTestQueryClient> } = {}) {
  const { route = `/ops/live?org=${ORG}`, queryClient = makeTestQueryClient() } = options;
  return renderWithProviders(
    <>
      <OpsLivePage />
      <Probe />
    </>,
    { route, queryClient },
  );
}

/**
 * SETTLE_WAIT - measured 2026-09-01 by Task 19, and copied with its reason.
 *
 * This waited on Testing Library's 1000ms default. Under full-suite
 * parallelism 37 jsdom environments compete for the same cores, and a
 * loading block had not always cleared inside one second - so an assertion
 * that a state is ABSENT ran while the previous state was still on screen,
 * and the failure read `expected <div role="status"> to be null`, which looks
 * like a product defect and is not one. `vitest.config.ts` is untouched.
 */
const SETTLE_WAIT = 15_000;

/** THREE lists on this screen, so three loading blocks. All of them. */
async function settled() {
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /Loading/ })).toHaveLength(0), {
    timeout: SETTLE_WAIT,
  });
}

function url(): string {
  return screen.getByTestId('url').textContent ?? '';
}

function badge(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-rule="${id}"]`)!;
}

function tile(label: string): HTMLElement {
  const kpis = document.querySelector<HTMLElement>('[data-kpis="ops-live"]')!;
  return within(kpis).getByText(label).closest('[data-state]') as HTMLElement;
}

/** THE VALUE ELEMENT, not the tile: a tile's text also contains its caption
 *  and its note, so an assertion on the whole tile passes on a number that
 *  only appears in a sentence. */
function tileValue(label: string): string {
  return (tile(label).firstElementChild as HTMLElement).textContent!.trim();
}

function table(name: string): HTMLTableElement {
  return screen.getByRole('table', { name }) as HTMLTableElement;
}

/** ONE COLUMN of every body row, in the order the table draws them. Never the
 *  whole row: Task 17 found a mutation surviving an assertion that read one. */
function column(name: string, index: number): string[] {
  return [...table(name).querySelectorAll<HTMLTableRowElement>('tbody tr:not([hidden])')]
    .map((tr) => tr.querySelectorAll('td')[index]?.textContent?.trim() ?? '')
    .filter((text) => text !== '');
}

/* ═══════ 1. three states, the eight unread rules, and the server's age ═══ */

describe('the alert badge tells three different truths (D8, A27)', () => {
  it('breaches red, clears green, reports an unreadable rule as neither — and R1–R8 as NOT CHECKED', async () => {
    serve(health({ apiErrorSpike: true, voiceDegraded: false }));
    renderLive();
    await settled();

    /* R9 breached. */
    expect(badge('R9')).toHaveAttribute('data-rule-state', 'breach');
    expect(badge('R9')).toHaveTextContent('BREACH');
    expect(badge('R9').className).toContain('bg-tint-red');

    /* R10 clear. */
    expect(badge('R10')).toHaveAttribute('data-rule-state', 'clear');
    expect(badge('R10')).toHaveTextContent('CLEAR');
    expect(badge('R10').className).toContain('bg-tint-green');

    /* THREE TONES ON ONE SCREEN, from three different facts. The old badge
       had two — `breached === true ? red : green` — so everything that was
       not a breach was painted as a pass. The unread case is asserted in the
       next test, on the fixture that produces it. */
    const tones = new Set(
      ['R9', 'R10', 'R1–R8'].map((id) => /bg-tint-\w+/.exec(badge(id).className)?.[0]),
    );
    expect(tones.size).toBe(3);

    /* D8 — the row that replaces "all R1–R10 clear". */
    expect(badge('R1–R8')).toHaveAttribute('data-rule-state', 'not-checked');
    expect(badge('R1–R8')).toHaveTextContent('NOT CHECKED');
    expect(badge('R1–R8')).not.toHaveTextContent('CLEAR');
    expect(screen.getByText(/2 of the 3 entries above are rules this endpoint reads/)).toBeVisible();

    /* R10's threshold is quoted in the SAME words `/ops/voice` uses. Two
       screens, one rule, one number — and no 90% target anywhere. */
    expect(screen.getAllByText(/20% .*6 hours|failure rate above 20% in 6 hours/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('90%');

    /* Plan Step 5, and it is a statement about the alerting system. */
    expect(screen.getByText(/Would email/)).toBeVisible();

    /*
     * A27's SECOND HALF — THE CHIP STATES THE SERVER'S AGE.
     *
     * `computedAtUtc` is seven minutes old; this browser received the answer
     * a moment ago. The old page fed the chip `dataUpdatedAt`, so it always
     * read "Live · now" no matter how stale the snapshot behind it was.
     */
    const chip = document.querySelector('.chip-fresh')!;
    expect(chip.textContent).toContain('7m ago');
    expect(chip.textContent).not.toContain('now');
  });
});

/* ═════════ 2. a zero that is not a reading, and an empty that is not a zero */

describe('a substituted zero is reported as no reading (D18, and its server twin)', () => {
  it('renders four unmeasured tiles and refuses to call either empty list a measured zero', async () => {
    /* Exactly what `GetVoiceHealthAsync`'s catch block substitutes. */
    serve(
      health({
        voiceInvocations24h: 0,
        voiceFailures24h: 0,
        voiceFailureRatePct: 0,
        voiceAvgLatencyMs: 0,
        voiceP95LatencyMs: 0,
        /* `null` is what the endpoint sends when the alert view cannot be
           read at all - the case the old two-state badge painted green. */
        apiErrorSpike: null,
        voiceDegraded: null,
      }),
    );
    renderLive();
    await settled();

    for (const label of ['Calls', 'Failed calls', 'Failure rate', 'P95 latency']) {
      expect(tile(label)).toHaveAttribute('data-state', 'unmeasured');
      expect(tileValue(label)).not.toMatch(/0/);
    }
    /* The shapes the old page printed for a null field, as standalone
       figures. The word boundary matters: R10's threshold is "20%", and an
       assertion that banned the substring would have banned the rule. */
    expect(document.body.textContent).not.toMatch(/\b0%/);
    expect(document.body.textContent).not.toMatch(/\b0ms/);

    /*
     * AND THE ASSERTION THE OLD BADGE FAILED. `breached === null` is not a
     * pass. `breached === true ? red : green` painted it green, beside a
     * tick, under the word N/A - a rule nobody could read, in the colour of
     * a rule that cleared.
     */
    for (const id of ['R9', 'R10']) {
      expect(badge(id)).toHaveAttribute('data-rule-state', 'unread');
      expect(badge(id)).toHaveTextContent('N/A');
      expect(badge(id)).not.toHaveTextContent('CLEAR');
      expect(badge(id).className).toContain('bg-tint-grey');
      expect(badge(id).className).not.toContain('bg-tint-green');
    }
    expect(screen.getByText(/2 could not be read on this request at all/)).toBeVisible();

    /* Both empty lists render the `unproven` panel, NOT MeasuredZero's
       closing sentence — four queries behind this endpoint answer their own
       database failures with an empty result and HTTP 200. */
    expect(document.body.textContent).not.toContain('This is a measured zero');
    expect(screen.getByText(/no token this platform issues carries a farm claim/i)).toBeVisible();
    expect(
      screen.getByText(/a broken query and a genuinely quiet two hours arrive here looking the same/i),
    ).toBeVisible();
  });
});

/* ═══════════════ 3. three lists, three namespaces, one screen ═══════════ */

describe('the three tables do not fight over one ?sort (T7 ns, T8 prediction)', () => {
  it('sorting one leaves the others exactly as they were', async () => {
    const user = userEvent.setup();
    serve(
      health({
        recentErrors: [
          event({ endpoint: '/c-endpoint', occurredAtUtc: '2026-09-01T11:40:00.0000000Z' }),
          event({ endpoint: '/a-endpoint', occurredAtUtc: '2026-09-01T11:30:00.0000000Z' }),
          event({
            endpoint: '/b-endpoint',
            occurredAtUtc: '2026-09-01T11:20:00.0000000Z',
            eventType: 'client.error',
            statusCode: null,
            latencyMs: null,
            farmId: null,
          }),
        ],
        /* DELIBERATELY NOT IN THE ORDER THE TABLE DRAWS THEM. If the fixture
           arrived pre-sorted, a table that lost its sort entirely would still
           look right and the assertion below would pass over the defect. */
        topSufferingFarms: [
          farm({ farmId: 'bbbbbbbb-0000-0000-0000-000000000002', errorCount: 5, syncErrors: 7 }),
          farm({ farmId: 'cccccccc-0000-0000-0000-000000000003', errorCount: 2, syncErrors: 3 }),
          farm({ farmId: 'aaaaaaaa-0000-0000-0000-000000000001', errorCount: 9, syncErrors: 1 }),
        ],
      }),
    );
    renderLive();
    await settled();

    /* Both tables open in their own default order: newest event first, worst
       farm first. */
    /* Read off the ENDPOINT column, not the time column: `fmt.time` renders
       in the reader's local zone, so a UTC fixture and an IST assertion would
       be a test about the machine the suite ran on. */
    expect(column('Recent events', 2)).toEqual(['/c-endpoint', '/a-endpoint', '/b-endpoint']);
    const sufferingBefore = column('Farmer suffering watchlist', 0);
    expect(sufferingBefore).toEqual(['aaaaaaaa…', 'bbbbbbbb…', 'cccccccc…']);

    /* Sort the EVENTS table by endpoint. */
    await user.click(within(table('Recent events')).getByRole('button', { name: 'Endpoint' }));

    /* The events moved… */
    await waitFor(() =>
      expect(column('Recent events', 2)).toEqual(['/a-endpoint', '/b-endpoint', '/c-endpoint']),
    );

    /*
     * …AND THE SUFFERING WATCHLIST DID NOT. This is asserted FIRST, before
     * anything about the URL, because it is the defect: with one shared
     * `?sort`, `endpoint` names no column on that table, its default order
     * (worst farm first) is discarded, and the rows fall back to the order
     * the server happened to send. A watchlist whose whole meaning is its
     * order, silently reordered by a click on another table.
     */
    expect(column('Farmer suffering watchlist', 0)).toEqual(sufferingBefore);

    /* And the URL says which table was sorted. A bare `sort` is read by all
       three lists, so its absence is part of the contract. */
    expect(url()).toContain('events.sort=endpoint');
    expect(url()).not.toMatch(/[?&]sort=/);
    expect(url()).toContain(`org=${ORG}`);

    /* And the other way round. */
    await user.click(within(table('Farmer suffering watchlist')).getByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(url()).toContain('suffering.sort=syncErrors'));
    expect(url()).toContain('events.sort=endpoint');
    expect(column('Recent events', 2)).toEqual(['/a-endpoint', '/b-endpoint', '/c-endpoint']);
    expect(column('Farmer suffering watchlist', 0)).toEqual([
      'bbbbbbbb…',
      'cccccccc…',
      'aaaaaaaa…',
    ]);

    /* A `client.error` row carries no status and no farm — three absences on
       one row, each named, none of them a zero. Read off THE CELLS. */
    const clientRow = [...table('Recent events').querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent?.includes('/b-endpoint'),
    )!;
    const cells = clientRow.querySelectorAll('td');
    expect(cells[3].textContent).toContain('not measured');
    expect(cells[3].textContent).not.toContain('0');
    expect(cells[5].textContent).toContain('not attributable');
  });
});

/* ══════════════ 4. the dev instruction is gone, twice over (D7) ═════════ */

describe('a production operator is never told to start a .NET API (D7)', () => {
  it('names the broken request when nothing was ever received', async () => {
    stub = installAdapter(async () => ({ status: 500, data: { message: 'boom' } }));
    renderLive();

    await screen.findByText(/Couldn.t load Live Health/, undefined, { timeout: SETTLE_WAIT });
    expect(document.body.textContent).not.toContain('port 5001');
    expect(document.body.textContent).not.toContain('Backend unreachable');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    /* Nothing is shown below, because nothing was received. */
    expect(document.querySelector('[data-kpis="ops-live"]')).toBeNull();
  });

  it('names when the feed stopped, and never shows the last good number as current', async () => {
    let answered = false;
    stub = installAdapter(async () => {
      if (answered) return { status: 503, data: { message: 'gone' } };
      answered = true;
      return {
        status: 200,
        data: health({ recentErrors: [event(), event({ endpoint: '/two' })] }),
      };
    });
    const queryClient = makeTestQueryClient();
    renderLive({ queryClient });
    await settled();
    expect(tileValue('Calls')).toBe('1,402');

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['ops', 'health'] });
    });

    const block = await screen.findByText(/Feed down since/, undefined, { timeout: SETTLE_WAIT });
    expect(block.textContent).toMatch(/Feed down since \d/);

    /* THE FEEDDOWN CONTRACT. The last good figure exists on the page exactly
       once, inside the sentence that disowns it. If "2 events" appeared
       anywhere else it would be yesterday's count under today's heading. */
    const disowned = document.querySelector('[data-lastgood]')!;
    expect(disowned.textContent).toContain('2 events');
    expect(disowned.textContent).toContain('that is history');
    expect(document.body.textContent!.match(/2 events/g)).toHaveLength(1);

    /* And nothing below the line is drawn at all. */
    expect(document.querySelector('[data-kpis="ops-live"]')).toBeNull();
    expect(screen.queryByRole('table', { name: 'Recent events' })).toBeNull();
  });
});

/* ═════════ 5. the service table's "what it feeds" is scanned, not typed ══ */

describe('the nightly row is derived from freshness metadata (plan Step 8)', () => {
  it('names the screens whose own envelope said materialized, and no others', async () => {
    /* NOT `makeTestQueryClient()`: it sets `gcTime: 0`, so an answer with no
       observer is collected before the scan can see it. That is a harness
       artifact - the console's own default keeps it - and using it here would
       test the harness rather than the derivation. */
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 300_000 } },
    });
    /* Two OTHER screens' answers, exactly as their hooks cache them. Only the
       nightly one is `materialized`; API Errors is live and must not appear. */
    queryClient.setQueryData(['metrics', 'wvfd', ORG, 12], {
      data: { weeks: [] },
      meta: {
        source: 'materialized',
        window: 'last 12 weeks',
        lastRefreshedUtc: NIGHTLY_RUN,
        ttlSeconds: 300,
      },
    });
    queryClient.setQueryData(['ops', 'errors', ORG, { page: 1 }], {
      data: { items: [] },
      meta: {
        source: 'live',
        window: 'last 24h',
        lastRefreshedUtc: '2026-09-01T11:00:00.0000000Z',
        ttlSeconds: 30,
      },
    });

    serve(health());
    renderLive({ queryClient });
    await settled();

    const nightly = [...table('Feeds this console depends on').querySelectorAll('tbody tr')].find(
      (tr) => tr.textContent?.includes('Nightly metrics rebuild'),
    )!;
    const feeds = nightly.querySelectorAll('td')[1].textContent!;

    expect(feeds).toContain('North Star WVFD');
    /* THE ASSERTION THAT MAKES IT A DERIVATION. A hand-typed list would name
       every nightly screen in the console whether or not one had answered,
       and would name API Errors the day that endpoint changed its source. */
    expect(feeds).not.toContain('Silent Churn');
    expect(feeds).not.toContain('API Errors');

    /* The run time is the newest stamp a NIGHTLY answer actually carried, not
       this screen's own `computedAtUtc`. Compared through the same formatter
       rather than against a literal, so the assertion is about which stamp
       was read and not about the timezone the suite runs in. */
    const lastHeard = nightly.querySelectorAll('td')[3].textContent;
    expect(lastHeard).toBe(fmt.dateTime(NIGHTLY_RUN, DATE_FORMATS.usersLastLogin));
    expect(lastHeard).not.toBe(fmt.dateTime(SEVEN_MINUTES_AGO, DATE_FORMATS.usersLastLogin));
  });
});
