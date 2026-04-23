import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'admin.active-org.v1';
const URL_PARAM = 'org';

interface ActiveOrgCtx {
  /** Currently-selected active org id (null = not chosen yet). */
  activeOrgId: string | null;
  /** Set the active org: persists to localStorage + URL, triggers a re-render. */
  setActiveOrgId: (id: string | null) => void;
  /** Clear selection (used when resolver returns NotInOrg). */
  clear: () => void;
}

const Ctx = createContext<ActiveOrgCtx | null>(null);

/**
 * Single source of truth for the active-org selection. Source precedence on
 * first load: URL `?org=<id>` → localStorage → null.
 *
 * Writes propagate to BOTH URL and localStorage so refresh/share both restore
 * the same selection.
 *
 * Consumed by:
 *   - src/lib/api.ts (axios interceptor reads it on every admin request)
 *   - useAdminScope hook (feeds it into the /me/scope query key)
 *   - OrgSwitcher (writes on selection)
 */
export function ActiveOrgProvider({ children }: { children: ReactNode }) {
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const fromUrl = new URL(window.location.href).searchParams.get(URL_PARAM);
    if (fromUrl && isUuidLike(fromUrl)) return fromUrl;
    return readFromStorage();
  });

  // Keep a mutable ref so the axios interceptor (module-scoped) can read
  // the current value without depending on React render cycles.
  const ref = useRef(activeOrgId);
  useEffect(() => {
    ref.current = activeOrgId;
    activeOrgSingleton.current = activeOrgId;
  }, [activeOrgId]);

  const setActiveOrgId = useCallback((id: string | null) => {
    setActiveOrgIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
      syncUrl(id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      syncUrl(null);
    }
  }, []);

  const clear = useCallback(() => setActiveOrgId(null), [setActiveOrgId]);

  const value = useMemo<ActiveOrgCtx>(
    () => ({ activeOrgId, setActiveOrgId, clear }),
    [activeOrgId, setActiveOrgId, clear]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveOrg(): ActiveOrgCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useActiveOrg must be used inside ActiveOrgProvider');
  return c;
}

/**
 * Module-scoped ref mirror so non-React code (axios interceptor) can read
 * the current active-org id without a subscription. Kept in sync by the
 * provider's effect above.
 */
const activeOrgSingleton: { current: string | null } = { current: null };

/** For axios interceptor — reads the current active-org id snapshot. */
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

function syncUrl(id: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(URL_PARAM, id);
  else url.searchParams.delete(URL_PARAM);
  window.history.replaceState({}, '', url.toString());
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
