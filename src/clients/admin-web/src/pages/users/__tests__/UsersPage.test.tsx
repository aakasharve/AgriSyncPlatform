import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles } from '@/test/stubAdapter';
import type { StubbedAdapter } from '@/test/stubAdapter';
import type { UserSummary } from '@/hooks/useUsers';
import UsersPage, { SignInCell } from '../UsersPage';

/**
 * USERS — the account list.
 *
 * Two assertions carry this file and they are the first two describe blocks.
 *
 *  1. AN EMPTY ANSWER FROM THIS FEED IS NOT A MEASUREMENT. `GetUsersListAsync`
 *     asks `public.users` for four columns it does not have and ends in
 *     `catch { return new UsersListDto([], 0, page, pageSize); }`, so every
 *     request is answered `{ items: [], totalCount: 0 }` with HTTP 200. A
 *     screen that printed "This is a measured zero, not a missing feed" over
 *     that would be stating, in as many words, the one thing we can prove
 *     false about it.
 *
 *  2. "NEVER SIGNED IN" AND "NOT RECORDED" ARE DIFFERENT PEOPLE. The console
 *     renders them differently and, on today's feed, only ever emits the
 *     second — because there is no last-login column to ground the first.
 *     Collapsing the two into one em dash is the defect; a test that cannot
 *     see the difference is how it would arrive.
 */

const ORG = '11111111-1111-1111-1111-111111111111';

function user(over: Partial<UserSummary> = {}): UserSummary {
  return {
    userId: 'aaaaaaaa-0000-0000-0000-000000000001',
    phone: '9876543210',
    displayName: 'कांबळे',
    email: null,
    apps: [],
    createdAt: '2026-03-14T10:00:00Z',
    lastLoginAt: null,
    ...over,
  };
}

const LAST_REFRESHED = '2026-09-01T08:30:00.000Z';

/**
 * THE REAL ENVELOPE, and the key name is the point.
 *
 * `AdminMetaDto` is `(Source, Window, LastRefreshedUtc, TtlSeconds)`
 * (`AdminResponseDto.cs:11-16`), so the server sends `lastRefreshedUtc`.
 * `lib/api.ts:144-145` declares `lastRefreshed` required and
 * `lastRefreshedUtc` optional — the opposite way round. Stubbing the key the
 * TYPE names would characterise a response this server does not send, and the
 * screen would look freshness-correct against a shape it never meets.
 */
function envelope(items: UserSummary[], totalCount = items.length, page = 1) {
  return {
    data: { items, totalCount, page, pageSize: 50 },
    meta: {
      source: 'live',
      window: 'current',
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

function serve(items: UserSummary[], totalCount = items.length) {
  stub = installAdapter(async (req) => {
    const page = Number(new URL(req.url, 'http://x').searchParams.get('page') ?? 1);
    return { status: 200, data: envelope(items, totalCount, page) };
  });
  return stub;
}

function renderUsers(route = `/users?org=${ORG}`) {
  return renderWithProviders(<UsersPage />, { route });
}

function table() {
  return screen.getByRole('table', { name: 'Accounts' });
}

/** The list's own subtree. The screen carries a second `role="status"` block —
 *  the standing note — so an unscoped query would be ambiguous, not wrong. */
function list(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-list="users"]')!;
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

function cells(tr: HTMLTableRowElement): HTMLTableCellElement[] {
  return [...tr.querySelectorAll('td')];
}

/**
 * Waits for the SKELETON TO GO, not for the correct outcome.
 *
 * Every cause below has to be able to assert the WRONG rendering first — that
 * is what makes the red name the defect rather than a missing element. So the
 * anchor is the one event that happens in every world, including the world
 * where a 500 is drawn as "No users found".
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

/* ═══════════ 1. AN EMPTY ANSWER HERE IS NOT A MEASUREMENT (D9, Step 4) */

describe('an absence names its cause, and an empty list is never called a measured zero', () => {
  it('does not claim a measured zero over an answer this feed cannot measure', async () => {
    serve([]);
    renderUsers();
    await settled();

    /*
     * ASSERTED FIRST, ON PURPOSE. `MeasuredZero` closes every one of its
     * renderings with this sentence, and on this screen it is provably false:
     * `AdminMisRepository.cs:250-288` selects `u.user_id`, `u.email`,
     * `u.created_at` and `u.last_login_at` from a table
     * (`20260308072006_Phase2UserInitial.cs:38-52` plus
     * `20260420161342_AddUserIdentityAugmentations.cs`) that defines none of
     * them, and closes `catch { return new UsersListDto([], 0, …); }`. A
     * missing feed is EXACTLY what this is.
     */
    expect(
      screen.queryByText(/This is a measured zero, not a missing feed/),
      'the empty account list was presented as a measured zero — this feed answers a broken query with an empty list and HTTP 200, and its query IS broken, so "not a missing feed" is the one sentence about this screen we can prove wrong',
    ).toBeNull();

    /* And the old string, which said the same thing more quietly. */
    expect(
      screen.queryByText('No users found'),
      'the console still renders "No users found" — one sentence covering a 500, a timeout, a 403 and a swallowed database failure alike (D9)',
    ).toBeNull();

    await screen.findByText('The account list came back empty');
    expect(stateBlock()).toHaveAttribute('data-state', 'unmeasured');
    expect(
      screen.getByText(/its query ends in a bare catch that returns an empty list with a success code/),
    ).toBeInTheDocument();
    expect(screen.getByText(/four columns that table does not have/)).toBeInTheDocument();

    /*
     * AND THE TIME IT NAMES COMES FROM THE KEY THE SERVER ACTUALLY SENDS.
     * Merged into this mount rather than given its own: same fixture, same
     * render, and the suite is at a measured timing cliff that one more
     * parallel file makes worse (Task 14's precedent, Task 29's problem).
     *
     * The envelope carries `lastRefreshedUtc`. A screen reading only
     * `lastRefreshed` — the key `lib/api.ts` marks REQUIRED — gets `undefined`
     * and falls through to "a time the server did not report" while the
     * freshness chip beside it still says "Live · now".
     */
    expect(
      screen.queryByText(/a time the server did not report/),
      'the screen read `meta.lastRefreshed` only, and the server sends `meta.lastRefreshedUtc` (AdminMetaDto.cs:15) — so it reported having no timestamp while holding one',
    ).toBeNull();
    expect(screen.getByText(/The server reported this answer at 01 Sep 26/)).toBeInTheDocument();
  });

  it('renders a 500 as a failure with a retry, not as an empty account list', async () => {
    const u = userEvent.setup();
    stub = installAdapter(async () => ({ status: 500, data: {} }));
    renderUsers();
    await settled();

    expect(
      screen.queryByText('No users found'),
      'a broken request rendered as "No users found" — a 500 was reported to the operator as a platform with nobody on it',
    ).toBeNull();
    expect(
      screen.queryByText(/The account list came back empty/),
      'a 500 rendered as the empty-list block — a request that never arrived was reported as an answer that did',
    ).toBeNull();

    await screen.findByRole('alert');
    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    expect(screen.getByText(/Request failed with status code 500/)).toBeInTheDocument();

    const before = stub.requests.length;
    await u.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(stub!.requests.length).toBeGreaterThan(before));
  });

  it('renders a TIMEOUT and a 403 as their own causes, and never as an empty list', async () => {
    stub = installAdapter(async () => {
      throw Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' });
    });
    const first = renderUsers();
    await settled();
    expect(
      screen.queryByText('No users found'),
      'a timed-out request rendered as "No users found" — a request that never came back was reported as a clean answer',
    ).toBeNull();
    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    expect(screen.getByText(/timeout of 20000ms exceeded/)).toBeInTheDocument();
    first.unmount();
    stub.restore();

    stub = installAdapter(async () => ({
      status: 403,
      data: { code: 'admin_module_forbidden', moduleKey: 'admin.users' },
    }));
    renderUsers();
    await settled();
    expect(
      screen.queryByText('No users found'),
      'a refused permission rendered as "No users found" — an admin who may not see this list was told there is nobody on it',
    ).toBeNull();
    expect(stateBlock('alert')).toHaveAttribute('data-state', 'load-failed');
    /* Named by `describeAdminDenial`, never the raw code. */
    expect(screen.getByText('Your admin access does not include this screen.')).toBeInTheDocument();
  });

  it('shows a skeleton shaped like this table while the first request is in flight (B12)', async () => {
    stub = installAdapter(neverSettles);
    renderUsers();

    const loading = await screen.findByRole('status', { name: 'Loading Accounts' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('tbody > tr')).toHaveLength(8);
    /* Four columns, because the table has four. */
    expect(loading.querySelectorAll('tbody > tr')[0].querySelectorAll('td')).toHaveLength(4);
  });
});

/* ═════ 2. "NEVER SIGNED IN" IS NOT "NOT RECORDED" (Step 4, second half) */

describe('a sign-in that never happened and a sign-in nobody wrote down are different', () => {
  it('renders the two readings differently — two rows, two words, never one dash', () => {
    const row = user({ lastLoginAt: null });

    render(
      <table>
        <tbody>
          <tr data-row="never">
            <td>
              <SignInCell user={row} feedRecordsSignIn />
            </td>
          </tr>
          <tr data-row="unrecorded">
            <td>
              <SignInCell user={row} feedRecordsSignIn={false} />
            </td>
          </tr>
        </tbody>
      </table>,
    );

    const never = document.querySelector('[data-row="never"] td')!;
    const unrecorded = document.querySelector('[data-row="unrecorded"] td')!;

    /*
     * THE COLLAPSE IS ASSERTED FIRST. If both branches render the same state,
     * the console is telling an operator that a person who has never used the
     * app and a person whose last use we failed to record are the same person
     * — which is the whole reason this cell is a function and not an `||`.
     */
    expect(
      never.textContent,
      'the two sign-in readings rendered identically — "never signed in" is a fact about a person and "not recorded" is a fact about our records, and this cell collapsed them into one em dash',
    ).not.toEqual(unrecorded.textContent);

    expect(never.querySelector('[data-state="never"]')).not.toBeNull();
    expect(never.textContent).toContain('never');
    expect(unrecorded.querySelector('[data-state="unmeasured"]')).not.toBeNull();
    expect(unrecorded.textContent).toContain('not measured');
    /* Neither is a bare dash: the word underneath is what a screen-reader user
       hears, and it is not decoration. */
    expect(never.textContent!.replace(/[—\s]/g, '')).not.toEqual('');
    expect(unrecorded.textContent!.replace(/[—\s]/g, '')).not.toEqual('');
  });

  it('never claims "never signed in" from today\'s feed, and says why the cell is blank', async () => {
    const u = userEvent.setup();
    serve([user({ userId: 'u1', lastLoginAt: null })]);
    renderUsers();
    await settled();

    const signIn = cells(dataRows()[0])[3];

    /*
     * THE FABRICATION, ASSERTED FIRST. `public.users` has no last-login
     * column, so a null is not the finding "this account has never been used".
     * Printing "never" over it invents a fact about a person on the screen
     * whose job is to stop that.
     */
    expect(
      signIn.querySelector('[data-state="never"]'),
      'the screen claimed an account had NEVER signed in — public.users has no last-login column, so a null is the absence of a record, not a record of absence',
    ).toBeNull();
    expect(signIn.querySelector('[data-state="unmeasured"]')).not.toBeNull();
    expect(signIn.textContent).toContain('not measured');
    expect(signIn.querySelector('[title]')?.getAttribute('title')).toMatch(
      /no last-login column/,
    );

    /* And the screen states the consequence in words, not only in a tooltip. */
    expect(
      screen.getByText(/An account nobody has ever used and an account whose last use we\s+failed to write down/),
    ).toBeInTheDocument();

    /* The expanded row must not close with v3's "Has never signed in." */
    await u.click(dataRows()[0]);
    expect(
      screen.queryByText(/Has never signed in/),
      'the expanded row asserted the account had never signed in — v3 writes that sentence from sample data this feed cannot produce',
    ).toBeNull();
    expect(
      screen.getByText(/Whether it has ever been used to sign in is not recorded/),
    ).toBeInTheDocument();
  });

  it('shows a recorded sign-in as a time, and parks an unrecorded one last in BOTH directions', async () => {
    const u = userEvent.setup();
    serve([
      user({ userId: 'u1', displayName: 'Signed in', lastLoginAt: '2026-08-30T04:20:00Z' }),
      user({ userId: 'u2', displayName: 'No record', lastLoginAt: null }),
    ]);
    renderUsers();
    await settled();

    const signIn = cells(dataRows().find((r) => r.textContent?.includes('Signed in'))!)[3];
    expect(signIn.textContent).toMatch(/30 Aug 26/);
    expect(
      signIn.querySelector('[data-state]'),
      'a recorded sign-in rendered as an honesty state — a time we DO hold was drawn as a value we do not',
    ).toBeNull();

    /*
     * A cell carrying an honesty state sorts as MISSING in both directions.
     * Without that, an unrecorded sign-in sorts as an empty string and lands
     * at the top of an ascending sort — the console would open on the accounts
     * it knows least about and present them as the oldest sign-ins.
     */
    /* And the expanded row tells the SAME story as the cell. The standing
       sentence on this screen is "not recorded"; printing it over a row that
       DOES carry a time is the same fabrication pointing the other way. */
    await u.click(dataRows().find((r) => r.textContent?.includes('Signed in'))!);
    /* SCOPED TO THIS ROW'S DETAIL. `ExpandableRow` keeps every detail row in
       the DOM behind `hidden` (`ExpandableRow.tsx:118`), so a document-wide
       query here would read the OTHER account's detail and pass or fail for
       the wrong reason. */
    const detail = within(document.getElementById('users-detail-u1')!);
    expect(
      detail.queryByText(/Whether it has ever been used to sign in is not recorded/),
      'the expanded row said the sign-in was not recorded on an account whose sign-in time it was displaying two cells away',
    ).toBeNull();
    expect(detail.getByText(/It last signed in on 30 Aug 26/)).toBeInTheDocument();

    const header = screen.getByRole('button', { name: /Last sign-in/ });
    await u.click(header);
    expect(dataRows().at(-1)!.textContent).toContain('No record');
    await u.click(header);
    expect(
      dataRows().at(-1)!.textContent,
      'flipping the sort brought the account with NO sign-in record to the top — an absence was ordered as if it were a value',
    ).toContain('No record');
  });
});

/* ══════════════ 3. THE PHONE IS THE ACCOUNT, AND IT IS MASKED (B16, Step 3) */

describe('the phone column renders what the server sends, and never the marker', () => {
  it('shows the account id for a withheld number and never prints **redacted**', async () => {
    serve([user({ userId: 'ffffffff-0000-0000-0000-00000000000f', phone: '**redacted**' })]);
    renderUsers();
    await settled();

    /*
     * ASSERTED FIRST. A withheld value is a permission fact, not a string.
     * Rendering `{u.phone}` raw prints the server's marker into the table —
     * the defect `Masked` exists to make impossible, and the one that survives
     * review because the sample data never contains it.
     */
    expect(
      screen.queryByText('**redacted**'),
      'the phone cell printed the literal marker **redacted** into the table — the server withheld this account\'s number and the screen rendered the marker instead of the account id',
    ).toBeNull();

    const phone = cells(dataRows()[0])[0];
    expect(phone).toHaveTextContent('ffffffff-0000-0000-0000-00000000000f');
    expect(phone.querySelector('[data-masked="redacted"]')).not.toBeNull();
  });

  it('shows a partly-hidden number exactly as sent, and an absent one as an absence', async () => {
    serve([
      user({ userId: 'u1', phone: '98******12' }),
      user({ userId: 'u2', phone: '', displayName: 'Second' }),
    ]);
    renderUsers();
    await settled();

    /* Shown AS SENT: an operator can still match the last two digits on a
       call, so swallowing it would destroy a usable fact. */
    const partial = cells(dataRows()[0])[0];
    expect(partial).toHaveTextContent('98******12');
    expect(partial.querySelector('[data-masked="partial"]')).not.toBeNull();

    /* Nothing at all is NOT a blank cell — the account id identifies the row
       without naming the person. The DOM keeps the two apart even though the
       eye cannot: a WITHHELD number is `redacted`, an absent one is `none`,
       and only the first is a statement about the reader's permission. */
    const absent = cells(dataRows()[1])[0];
    expect(absent).toHaveTextContent('u2');
    expect(absent.querySelector('[data-masked="none"]')).not.toBeNull();
    expect(
      absent.querySelector('[data-masked="redacted"]'),
      'an account with no phone number was reported as one the reader may not see — a missing value was dressed as a permission fact',
    ).toBeNull();

    /* AND THE SCREEN SAYS THE SERVER DOES NOT MASK, rather than implying it
       does. B16 is NOT satisfied and no frontend change can satisfy it:
       `GetUsersListHandler` takes no `IResponseRedactor`. Four admin endpoints
       checked now, four that redact nothing. */
    expect(
      screen.getByText(/Every admin who can open this screen sees complete numbers/),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════ 4. AN ABSENCE SAYS WHY (Step 4, first half) */

describe('every absent value carries its reason (Step 4)', () => {
  it('replaces the bare em dashes on name and created with reasons that differ', async () => {
    const u = userEvent.setup();
    serve([
      user({ userId: 'u1', phone: '9000000001', displayName: '   ', createdAt: '' }),
      user({ userId: 'u2', phone: '9000000002', displayName: 'Aabha' }),
    ]);
    renderUsers();
    await settled();

    const [, name, created] = cells(
      dataRows().find((r) => r.textContent?.includes('9000000001'))!,
    );

    /*
     * The old screen rendered `{u.displayName ?? '—'}` and `{u.email ?? '—'}`
     * — a dash with no reason, which makes the reader supply one, and the one
     * they supply is usually "nothing". Two absences, two reasons, and the
     * reasons are not the same sentence.
     */
    const nameWhy = name.querySelector('[title]')?.getAttribute('title') ?? '';
    const createdWhy = created.querySelector('[title]')?.getAttribute('title') ?? '';

    expect(nameWhy, 'the missing name printed a dash with no reason attached').not.toEqual('');
    expect(createdWhy, 'the missing created date printed a dash with no reason attached').not.toEqual('');
    expect(
      nameWhy,
      'two different absences carry the same reason — a shared sentence is a dash with extra steps',
    ).not.toEqual(createdWhy);

    /*
     * AND THE ORDER AGREES WITH THE CELL. `display_name` is NOT NULL, so the
     * absence that reaches this column is whitespace — a non-empty string that
     * sorts ahead of every real name unless the column trims it. A row reading
     * "not measured" sitting at the top of an A-Z sort is the cell and the
     * order telling two different stories about the same person.
     */
    await u.click(screen.getByRole('button', { name: /Name/ }));
    /* The NAME cell of the last row — not the row, whose Last-sign-in cell
       also reads "not measured" on every row of this feed and would make the
       assertion true whatever the order. */
    expect(
      cells(dataRows().at(-1)!)[1].textContent,
      'a name of pure whitespace sorted as a value and led the A-Z order, while its own cell read "not measured"',
    ).toContain('not measured');
  });

  it('renders a Devanagari name in the Devanagari face, through the one renderer (A34)', async () => {
    serve([user({ userId: 'u1', displayName: 'कांबळे' })]);
    renderUsers();
    await settled();

    const name = cells(dataRows()[0])[1];
    const rendered = name.querySelector('[data-script]')!;
    expect(rendered).toHaveAttribute('data-script', 'devanagari');
    expect(rendered.getAttribute('style')).toContain('Noto Sans Devanagari');
  });
});

/* ═════════ 5. SERVER PAGINATION AND THE DRAFT SEARCH (A17, A18, A20, A21, B4) */

describe('the list is paginated by the server and searched on commit', () => {
  it('asks for 50 per page, pages from the SERVER total, and hides the pager on one page', async () => {
    const u = userEvent.setup();
    serve([user({ userId: 'u1' })], 130);
    renderUsers();
    await settled();

    expect(stub!.requests[0].url).toContain('pageSize=50');
    expect(stub!.requests[0].url).toContain('page=1');

    /* 130 over 50 is three pages — derived from the server's count, never
       from the one row in hand. */
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();

    await u.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(stub!.requests.at(-1)!.url).toContain('page=2'));

    /* One page, no pager — hidden, not disabled, which is what the console
       does today on all three paginated screens. */
    stub!.restore();
    serve([user({ userId: 'u1' })], 1);
    const only = renderUsers('/users?org=' + ORG);
    await settled();
    expect(within(only.container).queryByText(/Page 1 of/)).toBeNull();
  });

  it('keeps the draft out of the URL until Enter, then resets the page and keeps the org', async () => {
    const u = userEvent.setup();
    serve([user({ userId: 'u1' })], 130);
    renderUsers(`/users?org=${ORG}&page=3`);
    await settled();

    const box = screen.getByRole('textbox', { name: 'Search accounts' });
    await u.type(box, '  98765  ');

    /* A21 — typing is not a query. Syncing per keystroke would push a history
       entry and a server round trip per character. */
    expect(
      stub!.requests.some((r) => r.url.includes('search=')),
      'the search box refetched while the operator was still typing — the draft is not URL state until Enter or the Search button',
    ).toBe(false);

    /*
     * A21 HAS TWO CONTRACTS AND THEY ARE NOT INTERCHANGEABLE. Farms and Users
     * commit on Enter or the Search button and at NO other moment; API Errors
     * commits on blur as well. Which one a screen uses is invisible in review
     * and changes WHEN a filter applies, so leaving the box has to be asserted
     * as a non-event rather than assumed to be one.
     */
    await u.tab();
    expect(
      stub!.requests.some((r) => r.url.includes('search=')),
      'leaving the search box applied the filter — this screen uses the draft contract (commit on Enter or the button), and swapping it for the blur-or-enter contract silently changes when a query runs',
    ).toBe(false);

    /* The button is half the contract: the blur-or-enter form does not render
       one at all, so asking for it by name pins which contract is in use. */
    await u.click(screen.getByRole('button', { name: /Search/ }));

    await waitFor(() => expect(stub!.requests.at(-1)!.url).toContain('search=98765'));
    const last = stub!.requests.at(-1)!.url;
    /* The trim lives in `useListUrlState` (T7 / Task 14), not in this screen —
       verified rather than assumed. */
    expect(last).not.toContain('%20');
    /* A20 — a filter change that left the reader on page 3 would show an empty
       list for a search that matched. */
    expect(last).toContain('page=1');
    /* The org is a header, and it survives because the URL write is the
       functional updater. Losing it is one organisation's data read under
       another's scope. */
    expect(stub!.requests.at(-1)!.headers['X-Active-Org-Id']).toBe(ORG);
  });

  it('answers an empty SEARCH as a no-match, not as an empty platform', async () => {
    serve([], 0);
    renderUsers(`/users?org=${ORG}&search=zzz`);
    await settled();

    /*
     * A term that matched nothing is a fact about the box you typed in. Saying
     * "the account list came back empty" over it would be a fact about the
     * platform, which is the collapse §6.1 exists to prevent.
     */
    expect(
      screen.queryByText('The account list came back empty'),
      'a search that matched nothing was reported as an empty account list — a fact about the query was stated as a fact about the platform',
    ).toBeNull();
    expect(stateBlock()).toHaveAttribute('data-state', 'no-match');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    expect(
      screen.getByText(/The server matches any part of the phone number/),
    ).toBeInTheDocument();
  });

  it('swaps the row count for Refreshing on a background fetch only (A25, B13)', async () => {
    const u = userEvent.setup();
    serve([user({ userId: 'u1' })], 130);
    const { container } = renderUsers();
    await settled();

    expect(container.textContent).toContain('1 of 130 accounts');

    /* A first load shows the skeleton; only a poll shows the indicator. */
    stub!.restore();
    stub = installAdapter(neverSettles);
    await u.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByText(/Refreshing/);
    expect(screen.queryByRole('status', { name: /Loading/ })).toBeNull();
  });
});
