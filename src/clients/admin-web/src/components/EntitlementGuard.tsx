import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminAuth } from '@/app/AdminAuthProvider';
import { useAdminScope } from '@/hooks/useAdminScope';
import { signInKey, type NoAccessState } from '@/lib/noAccessView';

interface EntitlementGuardProps {
  /** Module key from ModuleKeys.* — e.g. ModuleKeys.OpsLive. */
  module: string;
  /** Access level required. Defaults to 'read'. */
  require?: 'read' | 'write' | 'export';
  /** Rendered only when the caller has the required access. */
  children: ReactNode;
  /** Optional custom fallback. Defaults to a redirect to /403. */
  fallback?: ReactNode;
}

/**
 * Route / component-level permission gate. Wraps pages or large sub-trees
 * that should only render when the caller's AdminScope grants the module.
 *
 * Usage:
 *   <EntitlementGuard module={ModuleKeys.OpsLive}>
 *     <OpsLivePage />
 *   </EntitlementGuard>
 *
 * When the scope query is loading the guard renders nothing to avoid a flash
 * of forbidden → content. Parent routes should show the shell-level spinner
 * via RequireScope higher in the tree.
 *
 * What it sends to /403 names the sign-in it was found in (`signInKey`): the no-access page
 * shows a reason only in that sign-in, never to whoever signs in next (see `noAccessView`). A
 * scope that is not resolved sends no reason, so the page says only that the page is not open
 * to this account.
 */
export function EntitlementGuard({ module, require = 'read', children, fallback }: EntitlementGuardProps) {
  const { session } = useAdminAuth();
  const { isLoading, isResolved, canRead, canWrite, canExport } = useAdminScope();
  const location = useLocation();
  const account = signInKey(session) ?? undefined;

  if (isLoading) return null;
  if (!isResolved) {
    const state: NoAccessState = { from: location.pathname, account };
    return fallback ? <>{fallback}</> : <Navigate to="/403" state={state} replace />;
  }

  const allowed =
    require === 'write' ? canWrite(module) : require === 'export' ? canExport(module) : canRead(module);

  if (!allowed) {
    const state: NoAccessState = { from: location.pathname, module, account };
    return fallback ? <>{fallback}</> : <Navigate to="/403" state={state} replace />;
  }

  return <>{children}</>;
}
