import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';

const STORAGE_KEY = 'admin.active-org.v1';
const URL_PARAM = 'org';

interface ActiveOrgCtx {
  /** Currently-selected active org id (null = not chosen yet). */
  activeOrgId: string | null;
  /** Set the active org: persists to localStorage + the router's URL. */
  setActiveOrgId: (id: string | null) => void;
  /** Drop the selection entirely — storage AND url. Called on NotInOrg. */
  clear: () => void;
}

const Ctx = createContext<ActiveOrgCtx | null>(null);

/**
 * WHICH ORGANISATION'S DATA THIS CONSOLE IS SHOWING.
 *
 * Nothing about tenancy exists in the v3 prototype — a grep of all thirteen
 * files returns zero hits for org, tenant or scope. v3 is implicitly
 * single-tenant, so a design-led port produces a console where every list
 * silently returns the wrong organisation's rows. This provider, the header in
 * `lib/api.ts`, and the org segment in every query key are the whole of the
 * defence, and none of the three is visible in a screenshot.
 *
 * ── Precedence, unchanged: URL `?org=` → localStorage → null ──────────────
 * The url wins so a shared or bookmarked link opens on the organisation it was
 * captured for. Both reads are UUID-validated: a junk value in either source
 * reads as "no org", never as a header the server has to reject.
 *
 * ── WHAT CHANGED IN TASK 12: the url is now the ROUTER'S url ──────────────
 * This provider used to write `?org=` with a raw `window.history.replaceState`
 * and read it back off `window.location.href`. React Router does not observe
 * either, so the router's `location.search` could be one parameter behind the
 * address bar — and the next `setSearchParams` on any screen, even a perfectly
 * correct functional one, rebuilt the query string from that stale copy and
 * stripped the org straight back out of the shareable url. Task 7 proved it
 * and wrote it into `useListUrlState`'s header; this is the fix.
 *
 * Reading through `useSearchParams` also means BACK and FORWARD move the org,
 * because they move the router, which is what an operator expects of a value
 * that lives in the address bar.
 *
 * ── Why a url org is ADOPTED into storage ─────────────────────────────────
 * A `<Link>` to another screen carries no query string, so the org param
 * disappears the first time anyone clicks the sidebar. Deriving the active org
 * from the url alone would therefore change tenant on a navigation — silently,
 * and in the middle of a session. The effect below persists an org that
 * arrived by url so the fallback holds it after the param is gone. Following a
 * link with `?org=` is a deliberate switch, and a switch is meant to stick.
 *
 * Consumed by:
 *   - `lib/api.ts` (axios interceptor, via `getActiveOrgIdSnapshot`)
 *   - `useAdminScope` and every DATA hook (via `useOrgKey`, in the query key)
 *   - `AdminShell`'s topbar switcher and the full-page `OrgSwitcher`
 */
export function ActiveOrgProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawFromUrl = searchParams.get(URL_PARAM);
  const urlOrg = rawFromUrl && isUuidLike(rawFromUrl) ? rawFromUrl : null;

  const [storedOrg, setStoredOrg] = useState<string | null>(readFromStorage);

  const activeOrgId = urlOrg ?? storedOrg;

  useEffect(() => {
    activeOrgSingleton.current = activeOrgId;

    // Adoption — see "Why a url org is ADOPTED into storage" above.
    if (activeOrgId && activeOrgId !== storedOrg) {
      writeToStorage(activeOrgId);
      setStoredOrg(activeOrgId);
    }
  }, [activeOrgId, storedOrg]);

  const setActiveOrgId = useCallback(
    (id: string | null) => {
      /*
       * The snapshot is written SYNCHRONOUSLY, before React is told anything.
       *
       * Callers switch and then immediately act on the cache — `resetQueries()`
       * in the topbar switcher, `invalidateQueries()` in the full-page one.
       * Those kick off a refetch inside the same event handler, and the axios
       * request interceptor reads this snapshot a microtask later. If the only
       * writer were the effect above, that refetch could go out carrying the
       * PREVIOUS organisation's header while the query key already said the new
       * one — the neighbour's answer, filed under this org's name. One line
       * here removes the race instead of documenting it.
       */
      activeOrgSingleton.current = id;

      writeToStorage(id);
      setStoredOrg(id);

      /*
       * Functional form, and `replace`. Functional because it is the only form
       * that preserves the params this provider does not own (Task 7); replace
       * because choosing an organisation is not a place you navigate BACK out
       * of one press at a time.
       */
      setSearchParams(
        (prev) => {
          if (id) prev.set(URL_PARAM, id);
          else prev.delete(URL_PARAM);
          return prev;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clear = useCallback(() => setActiveOrgId(null), [setActiveOrgId]);

  const value = useMemo<ActiveOrgCtx>(
    () => ({ activeOrgId, setActiveOrgId, clear }),
    [activeOrgId, setActiveOrgId, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveOrg(): ActiveOrgCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useActiveOrg must be used inside ActiveOrgProvider');
  return c;
}

/**
 * Module-scoped mirror so non-React code can read the current active org.
 *
 * The axios request interceptor is module-scoped and cannot subscribe to
 * React; this is the bridge. `lib/returnTo.ts` uses the same shape for the
 * same reason.
 */
const activeOrgSingleton: { current: string | null } = { current: null };

/**
 * For the axios interceptor — the current active-org id.
 *
 * The header name `X-Active-Org-Id` is NOT a local naming choice. It is
 * pinned in three places outside this console: the CORS allowlist
 * (`AgriSync.Bootstrapper/Program.cs:151`), `AdminScopeHelper`'s read
 * (`AdminScopeHelper.cs:25`), and an architecture test that fails the build if
 * the CORS entry disappears (`AdminAuthGateTests.cs:169-170`). Rename it and
 * the browser drops it at preflight; the server then falls back to "no org",
 * which looks like an empty console rather than like a bug.
 */
export function getActiveOrgIdSnapshot(): string | null {
  return activeOrgSingleton.current;
}

function readFromStorage(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && isUuidLike(v) ? v : null;
  } catch {
    return null;
  }
}

function writeToStorage(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Private browsing denies the quota. The selection still holds for this
       tab; only its survival across a reload is lost, and refusing to switch
       organisation over that would be the larger failure. */
  }
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
