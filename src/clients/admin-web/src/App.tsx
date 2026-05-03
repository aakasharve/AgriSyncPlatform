import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/app/ThemeProvider';
import { AdminAuthProvider, useAdminAuth } from '@/app/AdminAuthProvider';
import { ActiveOrgProvider } from '@/app/ActiveOrgProvider';
import { WheatWindShader } from '@/app/WheatWindShader';
import { AdminShell } from '@/app/AdminShell';
import { CommandPalette } from '@/app/CommandPalette';
import { useAdminScope } from '@/hooks/useAdminScope';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { EntitlementGuard } from '@/components/EntitlementGuard';
import { ModuleKeys } from '@/lib/moduleKeys';

const HomePage               = lazy(() => import('@/pages/HomePage'));
const LoginPage               = lazy(() => import('@/pages/LoginPage'));
const ForbiddenPage           = lazy(() => import('@/pages/ForbiddenPage'));

const OpsLivePage             = lazy(() => import('@/pages/ops/OpsLivePage'));
const OpsErrorsPage           = lazy(() => import('@/pages/ops/OpsErrorsPage'));
const OpsVoicePage            = lazy(() => import('@/pages/ops/OpsVoicePage'));
const NorthStarPage           = lazy(() => import('@/pages/metrics/NorthStarPage'));
const FarmsListPage           = lazy(() => import('@/pages/farms/FarmsListPage'));
const SilentChurnPage         = lazy(() => import('@/pages/farms/SilentChurnPage'));
const SufferingPage           = lazy(() => import('@/pages/farms/SufferingPage'));
const ScheduleTemplatesPage   = lazy(() => import('@/pages/schedules/ScheduleTemplatesPage'));
const UsersPage               = lazy(() => import('@/pages/users/UsersPage'));
const SettingsAdminsPage      = lazy(() => import('@/pages/settings/SettingsAdminsPage'));

// DWC v2 §4.3 — Farmer Health (Mode B landing + Mode A drilldown).
const FarmerHealthPage        = lazy(() => import('@/features/farmer-health/FarmerHealthPage'));
const FarmerHealthDrilldown   = lazy(() => import('@/features/farmer-health/FarmerHealthDrilldown'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Fallback() {
  return (
    <div className="grid min-h-[400px] place-items-center text-sm text-text-muted">Loading…</div>
  );
}

/**
 * Authentication gate — JWT must exist. No scope check here.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAdminAuth();
  const location = useLocation();
  if (status === 'loading') return <Fallback />;
  if (status === 'anonymous')
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

/**
 * Scope gate — must live inside <RequireAuth> and <ActiveOrgProvider>.
 *   loading → spinner
 *   unresolved (Unauthorized) → /403 (no memberships — never going to work)
 *   ambiguous → full-page OrgSwitcher
 *   notInOrg  → full-page OrgSwitcher (re-pick)
 *   resolved  → render children
 */
function RequireScope({ children }: { children: ReactNode }) {
  const { isLoading, isError, outcome, memberships } = useAdminScope();

  if (isLoading) return <Fallback />;
  if (isError) return <Navigate to="/403" replace />;

  if (outcome === 'Unauthorized') return <Navigate to="/403" replace />;

  if (outcome === 'Ambiguous') {
    return (
      <OrgSwitcher
        memberships={memberships}
        fullPage
        headline="Choose your active organization"
        subline={`You have ${memberships.length} admin memberships. Pick one to continue — you can switch later from the topbar.`}
      />
    );
  }

  if (outcome === 'NotInOrg') {
    return (
      <OrgSwitcher
        memberships={memberships}
        fullPage
        headline="That organization is not in your memberships"
        subline="Pick an organization you actually belong to. The previous selection has been cleared."
      />
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ActiveOrgProvider>
            <AdminAuthProvider>
              <WheatWindShader />
              <CommandPalette />
              <Suspense fallback={<Fallback />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/403" element={<ForbiddenPage />} />
                  <Route
                    element={
                      <RequireAuth>
                        <RequireScope>
                          <AdminShell />
                        </RequireScope>
                      </RequireAuth>
                    }
                  >
                    {/* HomePage is a KPI collage — individual cards can 403 independently without
                        hiding the whole page. No single module gate fits, so no guard here. */}
                    <Route path="/" element={<HomePage />} />

                    <Route path="/ops/live" element={
                      <EntitlementGuard module={ModuleKeys.OpsLive}><OpsLivePage /></EntitlementGuard>
                    } />
                    <Route path="/ops/errors" element={
                      <EntitlementGuard module={ModuleKeys.OpsErrors}><OpsErrorsPage /></EntitlementGuard>
                    } />
                    <Route path="/ops/voice" element={
                      <EntitlementGuard module={ModuleKeys.OpsVoice}><OpsVoicePage /></EntitlementGuard>
                    } />
                    <Route path="/metrics/nsm" element={
                      <EntitlementGuard module={ModuleKeys.MetricsNsm}><NorthStarPage /></EntitlementGuard>
                    } />
                    <Route path="/farms" element={
                      <EntitlementGuard module={ModuleKeys.FarmsList}><FarmsListPage /></EntitlementGuard>
                    } />
                    <Route path="/farms/silent-churn" element={
                      <EntitlementGuard module={ModuleKeys.FarmsSilentChurn}><SilentChurnPage /></EntitlementGuard>
                    } />
                    <Route path="/farms/suffering" element={
                      <EntitlementGuard module={ModuleKeys.FarmsSuffering}><SufferingPage /></EntitlementGuard>
                    } />
                    <Route path="/farmer-health" element={
                      <EntitlementGuard module={ModuleKeys.FarmerHealth}><FarmerHealthPage /></EntitlementGuard>
                    } />
                    <Route path="/farmer-health/:farmId" element={
                      <EntitlementGuard module={ModuleKeys.FarmerHealth}><FarmerHealthDrilldown /></EntitlementGuard>
                    } />
                    <Route path="/users" element={
                      <EntitlementGuard module={ModuleKeys.AdminUsers}><UsersPage /></EntitlementGuard>
                    } />
                    {/* Schedules + Settings: no matching module key in W0-A's ModuleKey set yet.
                        Relying on RequireScope (any resolved scope) for now; specific module
                        gates land when schedule / admin-management surfaces add their keys. */}
                    <Route path="/schedules/templates" element={<ScheduleTemplatesPage />} />
                    <Route path="/settings/admins" element={<SettingsAdminsPage />} />

                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </AdminAuthProvider>
          </ActiveOrgProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
