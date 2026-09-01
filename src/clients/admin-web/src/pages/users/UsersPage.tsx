import { Users } from 'lucide-react';
import { DataList } from '@/components/data';
import type { DataListColumn } from '@/components/data';
import { Masked, NotMeasured, NotMeasuredPanel } from '@/components/state';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { PersonName } from '@/components/ui/PersonName';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { useListUrlState } from '@/lib/useListUrlState';
import { useUsersList } from '@/hooks/useUsers';
import type { UserSummary } from '@/hooks/useUsers';

/**
 * USERS — the account list, and the screen where an absence has to say why.
 *
 * ── WHAT SURVIVES EXACTLY ────────────────────────────────────────────────
 *  A17  server pagination at 50 per page, `?page` in the URL, `totalPages`
 *       derived from the SERVER's totalCount. The client never slices.
 *  A18  `?search` URL-synced.
 *  A20  the functional updater (never the object form, which drops `?org=`)
 *       and page reset to 1 on a search change.
 *  A21  the search draft is NOT URL-synced until Enter or the Search button.
 *       The trim lives in `useListUrlState` (T7), not here.
 *  A24  the AdminResponse envelope behind the freshness chip.
 *  A25  `keepPreviousData` (narrowed to the org in `lib/orgQuery.ts`) plus the
 *       "Refreshing…" swap that replaces the row count.
 *  A51  the per-surface date formats, from `DATE_FORMATS` rather than loose
 *       `format()` literals in this file — two-digit year on Created,
 *       date-and-time on the sign-in column, four-digit year in the expanded
 *       row's prose. They differ on purpose.
 *  B4   the pager, hidden when there is one page.
 *  B12  a skeleton shaped like this table.
 *  B13  the background-fetch indicator.
 *  D9   "No users found" is gone. Four causes, and a fifth this feed forces.
 *
 * ── 🛑 THE FEED CANNOT RETURN A ROW. Verified in the repo 2026-09-01 ──────
 * `GetUsersListAsync` (`AdminMisRepository.cs:250-288`) runs
 *
 *     SELECT u.user_id, u.phone, u.display_name, u.email,
 *            u.created_at, u.last_login_at
 *     FROM public.users u
 *
 * `public.users` has TEN columns and four of those six are not among them.
 * The table is created at `20260308072006_Phase2UserInitial.cs:38-52` with
 * `Id`, `phone`, `display_name`, `password_hash`, `credential_created_at_utc`,
 * `created_at_utc`, `is_active`, and gains `auth_mode`,
 * `phone_verified_at_utc` and `preferred_language` at
 * `20260420161342_AddUserIdentityAugmentations.cs`. There is no `user_id`, no
 * `email`, no `created_at` and no `last_login_at`, and no migration renames
 * anything (`RenameColumn` appears once in the repo, on a different table).
 * Two other repositories address the same table CORRECTLY —
 * `AdminFarmerHealthRepository.cs:142` joins `public.users u ON u."Id" = …`
 * and `UserDirectoryService.cs:19` selects `display_name` — so this is one
 * query's mistake, not a schema the rest of the code disagrees about.
 *
 * The reader command therefore raises `42703 undefined_column`, and the method
 * ends `catch { return new UsersListDto([], 0, page, pageSize); }` (`:287`).
 * **Every request is answered `{ items: [], totalCount: 0 }` with HTTP 200.**
 * The count query above it is fine and its result is discarded with the
 * exception.
 *
 * Nothing on this side can fix that: it is one SQL statement in a backend this
 * plan explicitly does not change ("Change Surface — Backend: no backend
 * changes"). What this side CAN do is refuse to call the result a measurement.
 * An empty list here goes to `NotMeasuredPanel`, not to `MeasuredZero`, whose
 * closing sentence — "This is a measured zero, not a missing feed" — is the
 * one sentence on this screen we can prove wrong.
 *
 * ── WHAT THE FEED CARRIES, AND WHAT IT DOES NOT ──────────────────────────
 * `UserSummaryDto` (`UsersAdminDto.cs:9-16`) is userId, phone, displayName,
 * email, apps, createdAt, lastLoginAt. Three of those are structurally empty
 * rather than merely absent, which is why they are not columns:
 *
 *   `apps`   is the LITERAL `[]`, written into every row at
 *            `AdminMisRepository.cs:283`. The grants are real and are in
 *            `public.memberships` (`AppMembershipConfiguration.cs:11`, with
 *            `app_id`, `role`, `is_revoked`); this query never joins them. A
 *            column of identical em dashes would say "this person has opened
 *            no app", which is a per-row claim built from a whole-feed
 *            absence.
 *   `email`  has no column on `public.users` at all. Sign-in is a phone number
 *            and a one-time code; there is nothing for an email column to read
 *            and nothing for the search box to match.
 *   `role`   — v3's first filter — is not on the account either. It is a
 *            property of a MEMBERSHIP (one role per app), so "the user's role"
 *            is not a single value this feed could carry even if it joined.
 *
 * All three are stated once, in words, at the foot of the screen. v3 draws
 * columns for the first two and three filter groups over all three, and none
 * of that is buildable here — the same finding Task 14 reached about v3's crop
 * / village / plan / land-record facets.
 *
 * ── NO FACETS, AND THEREFORE NO CROSS-FILTER SETTING ─────────────────────
 * Task 17 Step 5 says "cross-filtered facet counts OFF". There are no facets
 * to set it on. v3's three groups are role, app band and last-active band, and
 * every one of them rests on a field above. A fourth built from `lastLoginAt`
 * would be worse than none: `lastLoginAt` is null on every row (there is no
 * column), so it would offer one button holding 100% of them — the control
 * that filters nothing which Task 14 refused to ship.
 *
 * And a client-side facet on a SERVER-paginated list filters the fifty rows in
 * hand, not the set. That is the same reason the tier filter on All Farms is a
 * screen control rather than a `DataList` facet.
 *
 * ── NO SUMMARY-FIRST GATE ────────────────────────────────────────────────
 * v3 hides this table behind "Show all" (`users.html:573`). Task 14 dropped
 * that gate on All Farms for a reason that applies here word for word: with no
 * facets to read first, the gate hides the table for no reason and adds a
 * click to every visit. Silent Churn and Suffering keep it because their
 * summaries ARE the answer; here the rows are.
 */

/** 50 per page (A17, B4). The server's floor is 10 and its ceiling 200
 *  (`AdminEndpoints.cs:241`, `Math.Clamp(pageSize, 10, 200)`). */
const PAGE_SIZE = 50;

/**
 * DOES THIS PRODUCT RECORD WHEN SOMEBODY SIGNED IN? Verified 2026-09-01: NO.
 *
 * This constant is the whole of Step 4's second half, and it is deliberately a
 * named boolean rather than an `if (!user.lastLoginAt)` buried in a cell.
 *
 * The founder's sentence is that a person who has NEVER signed in is a
 * different person from one whose last sign-in we failed to record. That is
 * true, and it is exactly why a null cannot be rendered as "never" here:
 * `public.users` has no `last_login_at` column, so a null is not the fact
 * "this account has never been used" — it is the fact "this product does not
 * keep that time". Printing "never" over it would invent a finding about a
 * person, on the screen whose job is to stop that happening.
 *
 * So the console knows both readings, renders them differently, and currently
 * emits only the second. The day the column exists, this flips to `true` and
 * the "never" reading — already written and already tested — starts arriving.
 * That is Task 15's pattern: the never-logged hold-out shipped as a live guard
 * over a case its feed could not produce.
 */
const FEED_RECORDS_SIGN_IN = false;

/** What the row can say about a sign-in. Three readings, never two. */
type SignInReading =
  | { kind: 'at'; when: string }
  | { kind: 'never' }
  | { kind: 'unrecorded' };

/**
 * The reading, as a pure function. `feedRecordsSignIn` is a PARAMETER rather
 * than a module read for one reason: both branches have to be reachable from
 * outside, or "this console can tell the two apart" is a claim with nothing
 * behind it. `SignInCell` takes the same parameter and is what the test drives
 * — module-private here, because exporting a non-component beside a component
 * costs a `react-refresh/only-export-components` warning and buys nothing the
 * component does not already expose.
 */
function readSignIn(user: UserSummary, feedRecordsSignIn: boolean): SignInReading {
  const when = fmt.dateTime(user.lastLoginAt, DATE_FORMATS.usersLastLogin);
  if (when !== null) return { kind: 'at', when };
  return feedRecordsSignIn ? { kind: 'never' } : { kind: 'unrecorded' };
}

const NEVER_SIGNED_IN =
  'This account exists and has never been used to sign in. That is a recorded fact about the person, not a gap in the data.';

const SIGN_IN_NOT_RECORDED =
  'This product does not keep a sign-in time. public.users has no last-login column, so this blank says nothing about whether the person has ever signed in — it says we never wrote it down.';

/**
 * The Last-sign-in cell. Exported so the two readings can be rendered side by
 * side; the two words a reader sees are "never" and "not measured", from
 * `STATE_WORD`, and they must never collapse into one em dash.
 */
export function SignInCell({
  user,
  feedRecordsSignIn = FEED_RECORDS_SIGN_IN,
}: {
  user: UserSummary;
  feedRecordsSignIn?: boolean;
}) {
  const reading = readSignIn(user, feedRecordsSignIn);
  if (reading.kind === 'at') return <span className="tabular-nums">{reading.when}</span>;
  if (reading.kind === 'never') return <NotMeasured state="never" why={NEVER_SIGNED_IN} />;
  return <NotMeasured why={SIGN_IN_NOT_RECORDED} />;
}

/** Step 4's first half — the two bare em dashes at the old lines 61-62. A dash
 *  on its own makes the reader supply the reason, and the reason they supply
 *  is usually "nothing". Each of these says which absence it is. */
const NO_NAME =
  'No display name came back for this account. The name is required when an account is created, so a blank here is a gap in what was sent, not a person without a name.';

const NO_CREATED_AT =
  'No creation date came back for this account, so there is no date to show. That is a missing value, not a new account.';

const COLUMNS: DataListColumn<UserSummary>[] = [
  {
    key: 'phone',
    label: 'Phone',
    /**
     * B16 — THE PHONE IS THE ACCOUNT, so the column stays; it is the login
     * identity, not a contact detail, and an operator matching a person on a
     * call has nothing else to match on.
     *
     * It renders through `Masked`, which respects whatever the server sends:
     * `98******12` is shown AS SENT (the last two digits are still a usable
     * fact), a withheld number shows the ACCOUNT ID instead and the literal
     * `**redacted**` never reaches the DOM, and a null becomes "— not
     * measured" rather than an empty cell.
     *
     * 🔴 THE SERVER DOES NOT MASK IT TODAY. `GetUsersListHandler` takes no
     * `IResponseRedactor` and calls none; repo-wide only
     * `GetFarmerHealthHandler` and `GetCohortPatternsHandler` do. That is now
     * four admin endpoints checked and four that redact nothing
     * (`/admin/farms`, `/admin/farms/silent-churn`, `/admin/farms/suffering`
     * — which carries no phone — and this one). Register row B16 is NOT
     * ticked; the frontend half is done and cannot leak the marker the day
     * the server switches masking on.
     */
    render: (u) => <Masked value={u.phone} fallback={u.userId} />,
    sortType: 'text',
    /* A withheld number sorts as ABSENT rather than under `*` — an order
       derived from the permission is not an order derived from the data. */
    sortValue: (u) => (u.phone === '**redacted**' ? null : u.phone),
    defaultDir: 'asc',
  },
  {
    key: 'name',
    label: 'Name',
    /* A34 — a Devanagari name renders in Noto Sans Devanagari, through the one
       renderer, not a fifth copy of the script check. `PersonName` falls back
       to a bare em dash when it has nothing, so the absent case is taken
       BEFORE it, not handed to it. */
    render: (u) =>
      u.displayName?.trim() ? (
        <PersonName name={u.displayName} fallback={u.userId} />
      ) : (
        <NotMeasured why={NO_NAME} />
      ),
    sortType: 'text',
    /**
     * NO `state` ON ANY COLUMN OF THIS SCREEN, and that is a decision rather
     * than an omission.
     *
     * `state` exists so a cell that HOLDS A VALUE but carries an honesty state
     * still sorts as missing — "0 errors" against "we have no reading"
     * (`sortRows.ts:83`, `types.ts` on `DataListColumn.state`). Every absence
     * on this screen is already an absent `sortValue`, and `resolve` treats
     * null, undefined and '' as missing on its own (`sortRows.ts:86`). A
     * `state` here would be configuration that looks load-bearing, is not, and
     * would survive any mutation aimed at it.
     *
     * The one case that could have diverged is folded into the value instead:
     * `display_name` is NOT NULL (`UserConfiguration.cs:30-33`), so the absence
     * that actually reaches this column is a name of pure whitespace — a
     * non-empty string that would otherwise sort ahead of every real name while
     * the cell beside it read "not measured". Trimming here is what keeps the
     * order and the cell telling the same story.
     */
    sortValue: (u) => (u.displayName === '**redacted**' ? null : u.displayName?.trim()),
    defaultDir: 'asc',
  },
  {
    key: 'created',
    label: 'Created',
    /* A51 — two-digit year here, date AND time on the sign-in column, and they
       differ on purpose: one is a record, the other a recency. Both from
       `DATE_FORMATS`. */
    render: (u) => fmt.date(u.createdAt, DATE_FORMATS.usersCreated) ?? <NotMeasured why={NO_CREATED_AT} />,
    sortType: 'date',
    /* An absent or unparseable date resolves to MISSING on its own
       (`sortRows.ts:86,100`) and parks at the bottom in both directions — see
       the note on the Name column for why no `state` is declared. */
    sortValue: (u) => u.createdAt,
    defaultDir: 'desc',
  },
  {
    key: 'lastSignIn',
    /* "Last Login" became "Last sign-in" for the same reason Task 16 renamed
       Total Errors: the header has to describe what the cell can hold, and
       what this one holds today is the absence of a record. */
    label: 'Last sign-in',
    render: (u) => <SignInCell user={u} />,
    sortType: 'date',
    /* A null `lastLoginAt` resolves to MISSING on its own, so an unrecorded
       sign-in parks at the bottom in BOTH directions rather than sorting as
       the oldest one — see the note on the Name column. */
    sortValue: (u) => u.lastLoginAt,
    defaultDir: 'desc',
  },
];

/** The expandable row. Every line is a field on the row — there is no typed
 *  prose about a person here. v3's detail closes with "Has never signed in.";
 *  that sentence is the fabrication this screen exists to refuse. */
function userDetail(user: UserSummary) {
  /* A51 — a THIRD format, and the same choice `farmDetail` makes: a four-digit
     year reads as prose here, where the two-digit column form would not. */
  const created = fmt.date(user.createdAt, DATE_FORMATS.churnLastLog);
  const signIn = readSignIn(user, FEED_RECORDS_SIGN_IN);

  return (
    <div className="flex flex-col gap-3">
      <p>
        {created
          ? `This account was created on ${created}.`
          : 'No creation date came back for this account.'}{' '}
        {/* Guarded on the reading, not written once for every row. A row that
            DOES carry a sign-in time must not be told its sign-in is not
            recorded — that would be the same fabrication pointing the other
            way. */}
        {signIn.kind === 'at'
          ? `It last signed in on ${signIn.when}.`
          : signIn.kind === 'never'
            ? 'It has never been used to sign in.'
            : 'Whether it has ever been used to sign in is not recorded by this product.'}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-[13px]">
        {/* The identifier an operator files a ticket with, and the only value
            on the row that names no person. */}
        <dt className="text-text-3">Account id</dt>
        <dd className="tabular-nums text-text-2">{user.userId}</dd>
        <dt className="text-text-3">Phone</dt>
        <dd className="text-text-2">
          <Masked value={user.phone} fallback={user.userId} />
        </dd>
        <dt className="text-text-3">Last sign-in</dt>
        <dd className="text-text-2">
          <SignInCell user={user} />
        </dd>
      </dl>
    </div>
  );
}

export default function UsersPage() {
  /* `?page` and `?search`. `DataList` runs its own instance of this hook for
     `?search`, `?sort` and `?dir`; both read the same router params and both
     write through the same functional updater, which is the only reason two
     instances are safe (A20). */
  const url = useListUrlState();
  const page = url.page;
  const search = url.get('search') ?? undefined;

  const { data, isLoading, isFetching, isError, error, refetch } = useUsersList(
    page,
    PAGE_SIZE,
    search,
  );

  const items = data?.data?.items ?? [];
  const totalCount = data?.data?.totalCount ?? 0;

  /**
   * THE ENVELOPE SENDS `lastRefreshedUtc`, NOT `lastRefreshed`.
   *
   * `AdminMetaDto` is `(Source, Window, LastRefreshedUtc, TtlSeconds)`
   * (`AdminResponseDto.cs:11-16`) and its own doc-comment says the frontend
   * reads `LastRefreshedUtc`. `lib/api.ts:144-145` declares `lastRefreshed`
   * REQUIRED and `lastRefreshedUtc` optional — the opposite way round. So the
   * key every screen reads is `undefined` against the real server.
   *
   * Read both here. Correcting the shared type would change the freshness chip
   * on three already-shipped screens from outside their tasks, which is the
   * change `FreshnessChip.tsx` refused to make for the same reason; it is
   * reported and routed instead.
   */
  const lastRefreshed = data?.meta?.lastRefreshed ?? data?.meta?.lastRefreshedUtc;

  /* NEVER `new Date()` — that is D5, the fabricated freshness. When the server
     sends no time we say so rather than filling the gap. */
  const checkedAt =
    fmt.dateTime(lastRefreshed, DATE_FORMATS.usersLastLogin) ?? 'a time the server did not report';

  /** True when the client is holding one page of a larger set. */
  const pageScoped = totalCount > items.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-[-0.01em] text-text-1">
            <Users size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Users
          </h1>
          {/* No "in this organisation". `GetUsersListAsync(page, pageSize,
              search, ct)` takes no org parameter (`IAdminMisRepository.cs:16`),
              exactly like the three MIS feeds Task 16 corrected — the org in
              the query key separates the cache, it does not scope the data. */}
          <p className="mt-1 text-[15px] text-text-2">
            Every account this feed returns, platform-wide. The phone number is the account: it is
            the login identity, not a contact detail.
          </p>
        </div>
        <FreshnessChip source={data?.meta?.source ?? 'live'} lastRefreshed={lastRefreshed} />
      </div>

      {pageScoped && (
        /* The scope of the SORT, said once. Over a server-paginated list a
           column sort orders the rows in hand; the total beside it comes from
           the server and is exact. */
        <p className="text-[13px] text-text-3">
          Sorting a column orders the {fmt.num(items.length)} accounts on this page, not all{' '}
          {fmt.num(totalCount)}.
        </p>
      )}

      <DataList<UserSummary>
        id="users"
        label="Accounts"
        caption="Every account this feed returns, with the phone number that is the account, the name, when the account was created and when it last signed in. Select a row to open its detail."
        noun={{ one: 'account', many: 'accounts' }}
        rows={items}
        rowKey={(u) => u.userId}
        columns={COLUMNS}
        /* A17 / B4 — the page count comes from the SERVER's totalCount. The
           client holds fifty rows and never slices a full set. */
        pagination={{
          mode: 'server',
          page,
          pageSize: PAGE_SIZE,
          totalCount,
          onPage: url.setPage,
        }}
        /* The server asks for newest first (`ORDER BY u.created_at DESC`), so
           the default the reader lands on agrees with the order the page was
           composed in rather than quietly contradicting it. */
        defaultSort={{ key: 'created', dir: 'desc' }}
        search={{
          mode: 'server',
          /* A21 — draft state; the URL is written on Enter or the Search
             button and at no other moment. The trim is `useListUrlState`'s. */
          commit: 'submit',
          paramKey: 'search',
          placeholder: 'Search by phone or name…',
          label: 'Search accounts',
          /* From the query behind the box: `u.phone LIKE @s OR
             LOWER(u.display_name) LIKE LOWER(@s)` with `%term%` either side
             (`AdminMisRepository.cs:263,271`). Part of a number matches; the
             name match ignores case. v3's placeholder offers email and app as
             well, and this endpoint searches neither. */
          searchesOver:
            'The server matches any part of the phone number, and the name regardless of case. Nothing else on the account is searched.',
        }}
        /* NO ROW EDGE. v3 marks the accounts that never signed in — "one row in
           nineteen: an edge on every row would be decoration, an edge on one of
           them is a finding" (`users.html:257-260`). Here it would be on every
           row, because no row has a sign-in time, and it would assert the very
           claim `SignInCell` refuses to make. */
        expand={userDetail}
        states={{
          isLoading,
          isFetching,
          /* D9 — "No users found" was rendered over a 500, a timeout and a
             403 alike. `isError` appears in three files in the whole console
             and this screen was not one of them. */
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: search
              ? 'No account came back for that search'
              : 'The account list came back empty',
            checkedAt,
            /* THE FIFTH CAUSE. Not "we looked and there is nobody" — this feed
               cannot say that, and today it cannot say anything else either.
               See the file header for the four missing columns. */
            unproven: (
              <>
                <p>
                  The request succeeded and carried no accounts. That is not the same as there being
                  none, because this endpoint answers a database failure the same way: its query ends
                  in a bare catch that returns an empty list with a success code, so a broken query
                  and an empty platform arrive looking identical.
                </p>
                <p className="mt-2">
                  <b>And here the query is broken.</b> Verified in the repository on 1 September
                  2026: it asks <code>public.users</code> for four columns that table does not have
                  — a user id, an email, a created date and a last-login time, all under names the
                  schema never defined. Until that one statement is corrected this list is empty for
                  every reader, whoever they are and however many accounts exist.
                </p>
                <p className="mt-2">
                  The server reported this answer at {checkedAt}.
                </p>
              </>
            ),
          },
        }}
        /* B12 — shaped like the real thing: four columns. */
        skeleton={{ rows: 8, cells: 4 }}
      />

      <NotMeasuredPanel
        title="What this screen does not carry"
        why={
          <>
            <p>
              <b>Whether a person has ever signed in is not recorded.</b> There is no last-login
              column on an account, so every sign-in cell reads &ldquo;not measured&rdquo;. An
              account that has never been used and an account whose last use we failed to write down
              are different things, and this console currently cannot tell you which one you are
              looking at.
            </p>
            <p className="mt-2">
              <b>There is no email and no app list.</b> An account is a phone number and a one-time
              code; no email is stored anywhere. The app grants are real and live in
              <code> public.memberships</code>, but this feed never reads them and sends an empty
              list on every row — which is why neither is a column here. Role is a property of a
              grant rather than of a person, so there is no role filter either.
            </p>
            <p className="mt-2">
              <b>The phone numbers are not masked by the server.</b> This endpoint returns them in
              full to every admin who can open the screen. The screen renders whatever it is sent
              and will show a partly-hidden number the moment the server starts sending one, but the
              hiding has to happen on the server, and today it does not.
            </p>
            <p className="mt-2">
              <b>This list is not scoped to an organisation.</b> The endpoint takes no organisation
              and returns every account on the platform, so switching organisation in the top bar
              does not change who is on this list.
            </p>
          </>
        }
      />
    </div>
  );
}
