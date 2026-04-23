import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminScope } from '@/hooks/useAdminScope';

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
 */
export function EntitlementGuard({ module, require = 'read', children, fallback }: EntitlementGuardProps) {
  const { isLoading, isResolved, canRead, canWrite, canExport } = useAdminScope();
  const location = useLocation();

  if (isLoading) return null;
  if (!isResolved) {
    return fallback ? <>{fallback}</> : <Navigate to="/403" state={{ from: location.pathname }} replace />;
  }

  const allowed =
    require === 'write' ? canWrite(module) : require === 'export' ? canExport(module) : canRead(module);

  if (!allowed) {
    return fallback ? <>{fallback}</> : <Navigate to="/403" state={{ from: location.pathname, module }} replace />;
  }

  return <>{children}</>;
}
