import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';

/** Server contract — mirrors the AdminScope projection returned by /admin/me/scope. */
export interface AdminScopeView {
  userId: string;
  orgId: string;
  orgType: string;
  orgRole: string;
  isPlatformAdmin: boolean;
  modules: ReadonlyArray<{
    key: string;
    canRead: boolean;
    canExport: boolean;
    canWrite: boolean;
  }>;
}

export interface MembershipSummary {
  orgId: string;
  orgName: string;
  orgType: string;
  orgRole: string;
}

export type ResolveOutcome = 'Resolved' | 'Unauthorized' | 'Ambiguous' | 'NotInOrg';

/**
 * CR-3 (Task A3): what the server knows about a control-room team seat. `null` for a scope that is
 * not the platform's own. `ticks` are the server's tick keys (`company_numbers`, `farmer_phones`, ...).
 * `doorSessionRequired` is true when the session did not begin at the console's own sign-in (H10).
 */
export interface ControlRoomScope {
  isFounder: boolean;
  startingRole: string | null;
  ticks: string[];
  doorSessionRequired: boolean;
}

export interface MeScopeResponse {
  outcome: ResolveOutcome;
  scope: AdminScopeView | null;
  memberships: MembershipSummary[];
  /** Additive (A3). An older server sends none: it reads as null. */
  controlRoom?: ControlRoomScope | null;
}

export interface UseAdminScopeResult {
  isLoading: boolean;
  /** True while a request for the scope is in the air, the first one or a later one. */
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** Asks the server for the scope again. */
  refetch: () => void;
  data: MeScopeResponse | undefined;
  /** Convenience — true only when outcome === 'Resolved'. */
  isResolved: boolean;
  /** The resolved scope, or null if the caller is not in a resolved state. */
  scope: AdminScopeView | null;
  /** For the org-switcher UI — present when Ambiguous / NotInOrg / Resolved. */
  memberships: MembershipSummary[];
  outcome: ResolveOutcome | null;
  /** True only for a resolved scope that is the founder's (the Platform Owner seat). */
  isPlatformAdmin: boolean;
  /** The control-room part of the answer, or null (not a platform seat, or an older server). */
  controlRoom: ControlRoomScope | null;
  /**
   * Permission helpers. All return false when the scope isn't resolved.
   * Cheap — mirrors the server-side AdminScope.CanRead / CanWrite / CanExport.
   */
  canRead: (moduleKey: string) => boolean;
  canWrite: (moduleKey: string) => boolean;
  canExport: (moduleKey: string) => boolean;
}

/**
 * The server pins `controlRoom` on the answer (A3). It is read there first and, defensively, on
 * the scope object: the same fact must not be lost to where a server put it.
 */
export function readControlRoom(data: MeScopeResponse | undefined): ControlRoomScope | null {
  if (!data) return null;
  const own = data.controlRoom ?? (data.scope as { controlRoom?: ControlRoomScope | null } | null)?.controlRoom;
  return own ?? null;
}

/**
 * React Query wrapper around GET /admin/me/scope.
 *
 * The query key includes the active-org id so switching orgs refetches (vs.
 * serving a cached scope from the wrong org). On success, the backend
 * guarantees exactly one of four outcomes — consumers branch on it.
 *
 * Used by:
 *   - AdminAuthProvider to compute session status
 *   - EntitlementGuard to gate route rendering
 *   - OrgSwitcher to drive selection UI
 */
export function useAdminScope(): UseAdminScopeResult {
  // The same helper every DATA key uses, so the scope key and the data keys
  // cannot drift apart on how they spell "no organisation selected".
  const org = useOrgKey();

  const q = useQuery<MeScopeResponse>({
    queryKey: ['admin', 'me', 'scope', org],
    queryFn: async () => {
      const res = await adminApi.get<MeScopeResponse>('/shramsafal/admin/me/scope');
      return res.data;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const scope = q.data?.scope ?? null;

  const has = (needle: string, pred: (m: AdminScopeView['modules'][number]) => boolean) => {
    if (!scope) return false;
    return scope.modules.some((m) => m.key === needle && pred(m));
  };

  return {
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: () => void q.refetch(),
    data: q.data,
    isResolved: q.data?.outcome === 'Resolved',
    scope,
    memberships: q.data?.memberships ?? [],
    outcome: q.data?.outcome ?? null,
    isPlatformAdmin: scope?.isPlatformAdmin === true,
    controlRoom: readControlRoom(q.data),
    canRead: (k) => has(k, (m) => m.canRead),
    canWrite: (k) => has(k, (m) => m.canWrite),
    canExport: (k) => has(k, (m) => m.canExport),
  };
}
