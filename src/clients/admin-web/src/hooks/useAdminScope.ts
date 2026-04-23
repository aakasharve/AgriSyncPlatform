import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useActiveOrg } from '@/app/ActiveOrgProvider';

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

export interface MeScopeResponse {
  outcome: ResolveOutcome;
  scope: AdminScopeView | null;
  memberships: MembershipSummary[];
}

export interface UseAdminScopeResult {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: MeScopeResponse | undefined;
  /** Convenience — true only when outcome === 'Resolved'. */
  isResolved: boolean;
  /** The resolved scope, or null if the caller is not in a resolved state. */
  scope: AdminScopeView | null;
  /** For the org-switcher UI — present when Ambiguous / NotInOrg / Resolved. */
  memberships: MembershipSummary[];
  outcome: ResolveOutcome | null;
  /**
   * Permission helpers. All return false when the scope isn't resolved.
   * Cheap — mirrors the server-side AdminScope.CanRead / CanWrite / CanExport.
   */
  canRead: (moduleKey: string) => boolean;
  canWrite: (moduleKey: string) => boolean;
  canExport: (moduleKey: string) => boolean;
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
  const { activeOrgId } = useActiveOrg();

  const q = useQuery<MeScopeResponse>({
    queryKey: ['admin', 'me', 'scope', activeOrgId ?? 'none'],
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
    isError: q.isError,
    error: q.error,
    data: q.data,
    isResolved: q.data?.outcome === 'Resolved',
    scope,
    memberships: q.data?.memberships ?? [],
    outcome: q.data?.outcome ?? null,
    canRead: (k) => has(k, (m) => m.canRead),
    canWrite: (k) => has(k, (m) => m.canWrite),
    canExport: (k) => has(k, (m) => m.canExport),
  };
}
