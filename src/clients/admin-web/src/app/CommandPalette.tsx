import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeartPulse, Search, Users as UsersIcon, Wheat, type LucideIcon } from 'lucide-react';
import { LoadFailed, Masked, NoMatch, isPartlyMasked, isRedacted } from '@/components/state';
import { PersonName } from '@/components/ui/PersonName';
import { matchesQuery, searchHaystack } from '@/components/data/searchIndex';
import { useAdminScope } from '@/hooks/useAdminScope';
import { useFarmsList, type FarmSummary } from '@/hooks/useFarms';
import { useUsersList, type UserSummary } from '@/hooks/useUsers';
import { fmt } from '@/lib/format';
import { ModuleKeys } from '@/lib/moduleKeys';
import { DRILLDOWN_MODULE, DRILLDOWN_PATH, NAV } from './nav';

/**
 * THE COMMAND PALETTE — v2. Cmd-K, and it now knows about people.
 *
 * ══ 1. WHERE IT IS MOUNTED IS A SECURITY DECISION (A46) ══════════════════
 *
 * This component used to be mounted at `App.tsx:242` as of `ab71a07c`,
 * OUTSIDE `RequireAuth`,
 * next to `<Routes>`. That was harmless for exactly as long as it listed
 * eleven static page names: pressing Cmd-K on the sign-in screen opened a
 * menu of words the reader already knew.
 *
 * Indexing entities is what makes it dangerous, and indexing entities is the
 * entire point of v2. The moment this list carries farm names, owners and
 * farmer phone numbers, that PII sits one keystroke from an unauthenticated
 * screen. The v3 prototype identified the same latency and dealt with it by
 * withholding the palette from `login.html` (`login.html:91` loads `data.js`
 * but not `app.js`) — an omission, not a rule, and an omission does not
 * survive a port.
 *
 * It is now mounted INSIDE `RequireAuth` **and** inside `RequireScope`
 * (`App.tsx`). Inside RequireAuth because of the paragraph above. Inside
 * RequireScope as well because every entry below is scoped to one
 * organisation and `canRead` fails closed until the scope resolves
 * (`useAdminScope.ts:86`) — mounted above RequireScope this would be a
 * keystroke that opens an empty dialog on the org-switcher interstitial,
 * which reads as a broken shortcut rather than as a permission boundary.
 *
 * This is the frontend form of the founder's standing rule that
 * farmer-sensitive information is not for general internal eyes.
 *
 * ══ 2. EVERY ENTRY IS FILTERED THROUGH canRead (A46, B16) ════════════════
 *
 * The old palette offered all eleven destinations to everyone, so an admin
 * without `ops.errors` could select "API Errors" and be bounced straight to
 * `/403` by the route's own `EntitlementGuard`. A menu that lists doors that
 * are locked is worse than a shorter menu.
 *
 * The module key per destination lives in `./nav.ts` beside the destination
 * itself, and `CommandPalette.test.tsx` walks the REAL route table in
 * `App.tsx` and asserts the two agree — so this filter cannot drift away from
 * the guard it is mirroring.
 *
 * ══ 3. WHAT A REDACTED VALUE DOES HERE ═══════════════════════════════════
 *
 * Two separate rules, and the second is the one a port forgets:
 *
 *   a. A withheld value is never PRINTED. Names go through `PersonName`,
 *      phones through `Masked`; the literal `**redacted**` marker never
 *      reaches the DOM (Task 5, Task 6).
 *   b. A withheld value is never INDEXED. A farmer whose name the server
 *      refused to send must not become findable by that name here — building
 *      the haystack from the raw DTO would make the palette a way to confirm
 *      a name the reader was explicitly denied. A row with nothing visible at
 *      all is not listed.
 *
 * A PARTLY masked phone (`98******12`) is a third case and is kept: it is
 * shown as sent and it is indexed, because an operator on a call can match
 * the last two digits. It is not used as a deep-link value — see §5.
 *
 * ══ 4. THE INDEX IS MEMOISED ON THE ROWS, NEVER ON THE QUERY ═════════════
 *
 * `searchKey` (T6) generates up to 48 spellings for a three-word Marathi
 * name. Task 8 measured the build at ~60-100 ms over 3,000 rows against
 * ~0.4 ms to scan it. Rebuilding inside a keystroke handler turns an instant
 * search into a laggy one, which makes people retype.
 *
 * Three things hold the rule here rather than hoping for it:
 *   - `NAV_ENTRIES` is built ONCE, at module scope. `NAV` is static.
 *   - the farm and user indexes are `useMemo`d on the ROW ARRAYS and on
 *     nothing else. The query is not a dependency and must never become one.
 *   - `EMPTY_FARMS` / `EMPTY_USERS` are module constants, because
 *     `data?.items ?? []` mints a new array on every render and would defeat
 *     the memo silently — nothing would break, it would just be slow.
 * `CommandPalette.test.tsx` counts `searchKey` calls across five keystrokes
 * and asserts the count does not move.
 *
 * ══ 5. THE DEEP LINK — PORTED, NOT INVENTED ══════════════════════════════
 *
 * v3 generates `all-farms.html?q=<farm name>` and `users.html?q=<phone>`
 * (`app.js:723,726`), and the destination seeds its search box from that
 * param exactly once (`app.js:705-707`, `users.html:684-685`). Arriving with
 * the param also forces the summary-first list OPEN, so the jump lands on the
 * person rather than on the summary — `all-farms.html:636` and
 * `silent-churn.html:674` spell it `if (A.param('q')) opened = true;`, and
 * `suffering.html:677` does the same thing by un-hiding the list directly.
 *
 * THE PARAM IS `search`, NOT `q`, AND THAT IS NOT A PREFERENCE.
 * `?q` collides with nothing in this console — it is simply read by nothing.
 * `useListUrlState` commits its draft into `search` by default and `DataList`
 * reads `search?.paramKey ?? 'search'`; the two live screens this palette
 * jumps to already read `?search` today, server-side, and already seed their
 * input from it (`FarmsListPage.tsx:17,19`, `UsersPage.tsx:14,15`). Emitting
 * `q` would have produced a link that looks right in a review and does
 * nothing in either the current console or the ported one.
 *
 * No `?open=1` is written either, and that is deliberate rather than
 * forgotten: `DataList` already counts a typed search as one of the three
 * ways a summary-first list opens (`DataList.tsx`, `listOpen`), so writing
 * the flag as well would be a second mechanism for one behaviour — exactly
 * what Task 8 asked the next task not to add.
 *
 * ══ 6. WHAT IT CAN AND CANNOT SEE, SAID OUT LOUD ═════════════════════════
 *
 * The palette holds the FIRST PAGE of farms and users — the same 40 and 50
 * the two list screens fetch, under the same query keys, so opening it on
 * `/farms` costs nothing. It does not and must not pull every row: the
 * measured production ceiling is about 32 simultaneous requests on a 2-vCPU
 * box.
 *
 * So it says so, in the footer, with the server's own totals — and when a
 * query is typed it offers a row that hands the whole query to the SERVER's
 * search. "Nothing matches" over a partial index, with no way forward, is the
 * silent-failure shape this redesign exists to remove.
 *
 * ══ 7. D4 — THE THREE SHORTCUT BADGES ARE NOT COMING BACK ════════════════
 *
 * Founder, 2026-08-31: "drop , drop remove". Task 10 deleted the ⌘1 / ⌘2 / ⌘F
 * chips from the sidebar because nothing bound them. This handler binds
 * Cmd-K (or Ctrl-K) and Escape, and nothing else. Do not add them.
 */

/* The first page of each list — the SAME page size the screens use, so the
   query key matches theirs and the palette reuses their cache entry.
   `FarmsListPage.tsx:11` PAGE_SIZE 40, `UsersPage.tsx:9` PAGE_SIZE 50. */
const FARM_PAGE = 1;
const FARM_PAGE_SIZE = 40;
const USER_PAGE = 1;
const USER_PAGE_SIZE = 50;

/** Stable empty arrays — see §4. A fresh `[]` per render defeats the memo. */
const EMPTY_FARMS: readonly FarmSummary[] = [];
const EMPTY_USERS: readonly UserSummary[] = [];

/** How many rows are rendered at once. The rest are counted, not drawn. */
const MAX_RESULTS = 50;

interface Entry {
  id: string;
  group: string;
  Icon: LucideIcon;
  /** What the reader sees. May be a `PersonName`, so it is a node. */
  label: ReactNode;
  /** The second line: an owner's phone, a person's phone, a destination. */
  sub?: ReactNode;
  /** Where selecting it goes. Already query-encoded. */
  to: string;
  /** Lowercased haystack: the visible values plus their romanisations. */
  haystack: string;
}

/* ── the values a reader is allowed to see ─────────────────────────────── */

/**
 * A value that may be shown AND indexed, or null.
 *
 * `**redacted**` is not a string here, it is a permission fact: it is not
 * printed and — the half a port forgets — it is not indexed either (§3b).
 */
function visible(v: string | null | undefined): string | null {
  const t = v?.trim();
  if (!t || isRedacted(t)) return null;
  return t;
}

/**
 * A value that can be handed to the SERVER as a search term, or null.
 *
 * `98******12` is real enough to read and to match by eye, and it is indexed
 * for that reason — but sending it to the server's `LIKE` would return
 * nothing and the jump would look broken. So a partly masked value is shown,
 * is searchable HERE, and is never the deep-link term.
 */
function linkable(v: string | null): string | null {
  return v && !isPartlyMasked(v) ? v : null;
}

/** A grouped figure that is always a string. `fmt.num` returns null for a
 *  missing value, and `${null}` in a template literal prints the word "null"
 *  into the sentence — the same trap `count()` exists for in `facets.ts`. */
function n(v: number): string {
  return fmt.num(v) ?? String(v);
}

/** `/farms?search=…`, `/users?search=…`. Empty term → the plain list. */
function deepLink(path: string, term: string | null): string {
  return term ? `${path}?search=${encodeURIComponent(term)}` : path;
}

/* ── the static half of the index, built once ──────────────────────────── */

const NAV_ENTRIES: Array<Entry & { module: string | null }> = NAV.map((item) => ({
  id: `nav:${item.to}`,
  group: item.group,
  Icon: item.Icon,
  label: item.label,
  sub: undefined,
  to: item.to,
  haystack: searchHaystack([item.label, item.group]),
  module: item.module,
}));

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  /**
   * TWO BINDINGS. Cmd-K (or Ctrl-K) toggles, Escape closes. D4 removed the
   * other three; see §7. Registered on the window because the shortcut has to
   * work from inside any screen's own input.
   */
  useEffect(() => {
    const down = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  /* The dialog is a separate component so the entity queries MOUNT WITH IT.
     A closed palette fetches nothing at all — no farm names, no phone
     numbers — which is the cheapest possible form of the rule in §1. */
  if (!open) return null;
  return <PaletteDialog onClose={() => setOpen(false)} />;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const navigate = useNavigate();
  const { canRead } = useAdminScope();

  /* Fail-closed: `canRead` returns false until the scope resolves, so an
     unresolved scope yields a palette of the three ungated screens and
     nothing else — never a farm name, never a phone number. */
  const canReadFarms = canRead(ModuleKeys.FarmsList);
  const canReadUsers = canRead(ModuleKeys.AdminUsers);
  const canReadHealth = canRead(DRILLDOWN_MODULE);

  /* The request itself is gated, not just the render (see `useFarms.ts`). */
  const farms = useFarmsList(FARM_PAGE, FARM_PAGE_SIZE, undefined, undefined, {
    enabled: canReadFarms || canReadHealth,
  });
  const users = useUsersList(USER_PAGE, USER_PAGE_SIZE, undefined, {
    enabled: canReadUsers,
  });

  const farmRows = farms.data?.data?.items ?? EMPTY_FARMS;
  const userRows = users.data?.data?.items ?? EMPTY_USERS;

  /**
   * THE EXPENSIVE HALF. Memoised on the row array and on nothing else (§4).
   *
   * One haystack per farm, shared by both of that farm's destinations, so a
   * farm is romanised once however many ways there are to reach it.
   */
  const farmIndex = useMemo(
    () =>
      farmRows.flatMap((farm) => {
        const name = visible(farm.name);
        const phone = visible(farm.ownerPhone);
        /* Nothing the reader may see means nothing to search by and nothing
           to show. The row is not listed at all. */
        if (!name && !phone) return [];
        return [
          {
            farm,
            name,
            phone,
            haystack: searchHaystack([name, phone]),
          },
        ];
      }),
    [farmRows],
  );

  const userIndex = useMemo(
    () =>
      userRows.flatMap((user) => {
        const name = visible(user.displayName);
        const phone = visible(user.phone);
        if (!name && !phone) return [];
        return [{ user, name, phone, haystack: searchHaystack([name, phone]) }];
      }),
    [userRows],
  );

  /* ── the entries, assembled per permission ────────────────────────────
     Cheap: filters and node construction only. No romanisation happens here,
     which is why `canRead` changing identity every render costs nothing. */

  const entries: Entry[] = [];

  for (const entry of NAV_ENTRIES) {
    if (entry.module === null || canRead(entry.module)) entries.push(entry);
  }

  if (canReadFarms) {
    for (const row of farmIndex) {
      entries.push({
        id: `farm:${row.farm.farmId}`,
        group: 'Farms',
        Icon: Wheat,
        /* A farm in this product is named for its farmer and is very often
           written in Devanagari, so it goes through the same script-aware
           renderer a person's name does rather than acquiring a fifth copy
           of the font check (A34). */
        label: <PersonName name={row.farm.name} fallback={row.farm.farmId} />,
        sub: row.phone ? <Masked value={row.phone} /> : undefined,
        to: deepLink('/farms', linkable(row.name) ?? linkable(row.phone)),
        haystack: row.haystack,
      });
    }
  }

  if (canReadHealth) {
    for (const row of farmIndex) {
      entries.push({
        id: `health:${row.farm.farmId}`,
        group: 'Farmer Health',
        Icon: HeartPulse,
        label: <PersonName name={row.farm.name} fallback={row.farm.farmId} />,
        /* The drilldown needs no search term: the farm id IS the address, so
           this jump carries no name and no phone number in the url. */
        sub: 'Farmer-health drilldown',
        to: `${DRILLDOWN_PATH}/${encodeURIComponent(row.farm.farmId)}`,
        haystack: row.haystack,
      });
    }
  }

  if (canReadUsers) {
    for (const row of userIndex) {
      entries.push({
        id: `user:${row.user.userId}`,
        group: 'Users',
        Icon: UsersIcon,
        /* v3 labels a person by name and falls back to the phone
           (`app.js:726`). `PersonName` does the falling back, and `Masked`
           handles the case where the name was withheld. */
        label: <PersonName name={row.user.displayName} fallback={row.phone ?? row.user.userId} />,
        sub: row.phone ? <Masked value={row.phone} /> : undefined,
        /* v3 deep-links a person by PHONE, which is the value the users
           search actually matches on. */
        to: deepLink('/users', linkable(row.phone) ?? linkable(row.name)),
        haystack: row.haystack,
      });
    }
  }

  /* ── the scan ─────────────────────────────────────────────────────────
     A plain substring test over a haystack that already contains every
     plausible romanisation. Over-matching is paid for on the index side
     (founder ruling, 2026-08-31); adding fuzziness here as well would return
     rows a support person cannot explain to the farmer on the call. */
  const trimmed = query.trim();
  const matched = entries.filter((e) => matchesQuery(e.haystack, trimmed));

  /* When the local index cannot answer, hand the question to the server —
     which holds every page, not just the first. Only offered for a list the
     reader may actually open. */
  const escapeHatches: Entry[] = [];
  if (trimmed) {
    if (canReadFarms) {
      escapeHatches.push({
        id: 'all:farms',
        group: 'Search the server',
        Icon: Wheat,
        label: `Search all farms for “${trimmed}”`,
        sub: 'Opens All Farms with this search applied',
        to: deepLink('/farms', trimmed),
        haystack: '',
      });
    }
    if (canReadUsers) {
      escapeHatches.push({
        id: 'all:users',
        group: 'Search the server',
        Icon: UsersIcon,
        label: `Search all people for “${trimmed}”`,
        sub: 'Opens Users with this search applied',
        to: deepLink('/users', trimmed),
        haystack: '',
      });
    }
  }

  const results = [...matched, ...escapeHatches];
  const shown = results.slice(0, MAX_RESULTS);
  const active = Math.min(idx, Math.max(0, shown.length - 1));

  const select = useCallback(
    (to: string) => {
      navigate(to);
      onClose();
    },
    [navigate, onClose],
  );

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, shown.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && shown[active]) select(shown[active].to);
  }

  /* ── what it searched, in words ───────────────────────────────────────
     Only figures it actually has. A source that is still loading or that
     failed is NOT counted as zero — that is the fabricated-zero defect this
     redesign exists to remove. */
  function heldLine(
    label: string,
    allowed: boolean,
    held: number,
    total: number | undefined,
    ready: boolean,
  ): string | null {
    if (!allowed) return null;
    if (!ready) return `${label} still loading`;
    if (total === undefined || total <= held) return `${n(held)} ${label}`;
    return `the first ${n(held)} of ${n(total)} ${label}`;
  }

  const scopeParts = [
    `${n(NAV_ENTRIES.filter((e) => e.module === null || canRead(e.module)).length)} screens`,
    heldLine(
      'farms',
      canReadFarms || canReadHealth,
      farmIndex.length,
      farms.data?.data?.totalCount,
      !farms.isLoading && !farms.isError,
    ),
    heldLine(
      'people',
      canReadUsers,
      userIndex.length,
      users.data?.data?.totalCount,
      !users.isLoading && !users.isError,
    ),
  ].filter(Boolean) as string[];

  const listId = 'cmdk-results';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-text-1/20 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search the console"
        className="w-full max-w-xl overflow-hidden rounded-panel bg-page shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search size={16} aria-hidden="true" className="flex-none text-text-3" strokeWidth={2.5} />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `cmdk-${shown[active].id}` : undefined}
            aria-label="Search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIdx(0);
            }}
            onKeyDown={onKey}
            placeholder="Jump to a screen, a farm or a person"
            className="flex-1 bg-transparent text-[15px] font-semibold text-text-1 outline-none placeholder:text-text-3"
          />
          <kbd className="rounded-chip bg-wash px-1.5 py-0.5 text-[11px] text-text-3">ESC</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {/* A source that BROKE is named. Silently listing no farms because
              the request failed is the same lie as an empty table headed
              "No farms — great!". */}
          {farms.isError && (
            <LoadFailed
              error={farms.error}
              onRetry={() => void farms.refetch()}
              what="the farm index"
              className="mb-2"
            />
          )}
          {users.isError && (
            <LoadFailed
              error={users.error}
              onRetry={() => void users.refetch()}
              what="the people index"
              className="mb-2"
            />
          )}

          {shown.length === 0 && trimmed !== '' && (
            <NoMatch
              filterInWords={`“${trimmed}”`}
              onClear={() => {
                setQuery('');
                setIdx(0);
              }}
              searchesOver={`Searched ${scopeParts.join(', ')}.`}
            />
          )}

          <div id={listId} role="listbox" aria-label="Results">
            {shown.map((entry, i) => (
              <button
                key={entry.id}
                id={`cmdk-${entry.id}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setIdx(i)}
                onClick={() => select(entry.to)}
                className={`flex w-full items-center gap-3 rounded-chip px-3 py-2.5 text-left text-[15px] font-semibold transition-colors ${
                  i === active ? 'bg-wash text-text-1' : 'text-text-1 hover:bg-wash'
                }`}
              >
                <span className="grid size-7 flex-none place-items-center rounded-chip bg-wash text-text-3">
                  <entry.Icon size={16} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.label}</span>
                  {entry.sub && (
                    <span className="block truncate text-[13px] font-normal text-text-3">
                      {entry.sub}
                    </span>
                  )}
                </span>
                <span className="flex-none text-[11px] font-normal text-text-3">{entry.group}</span>
              </button>
            ))}
          </div>
        </div>

        {/* THE SCOPE OF THE SEARCH, STATED. It holds one page of each list,
            not the whole console, and a palette that does not say so tells an
            operator "no such farmer" when it means "not in the first 40". */}
        <p className="border-t border-line px-4 py-2.5 text-[13px] text-text-3">
          Searched {scopeParts.join(', ')}.
          {results.length > shown.length && ` Showing the first ${n(shown.length)} matches.`}{' '}
          Enter to open &middot; Esc to close.
        </p>
      </div>
    </div>
  );
}
