import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/app/ThemeProvider';
import { AdminAuthProvider, useAdminAuth } from '@/app/AdminAuthProvider';
import { WheatWindShader } from '@/app/WheatWindShader';
import { AdminShell } from '@/app/AdminShell';

const HomePage = lazy(() => import('@/pages/HomePage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const ForbiddenPage = lazy(() => import('@/pages/ForbiddenPage'));
const PlaceholderPage = lazy(() => import('@/pages/PlaceholderPage'));
const OpsLivePage = lazy(() => import('@/pages/ops/OpsLivePage'));
const OpsErrorsPage = lazy(() => import('@/pages/ops/OpsErrorsPage'));
const OpsVoicePage = lazy(() => import('@/pages/ops/OpsVoicePage'));

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

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { status } = useAdminAuth();
  const location = useLocation();
  if (status === 'loading') return <Fallback />;
  if (status === 'anonymous')
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (status === 'non-admin') return <Navigate to="/403" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AdminAuthProvider>
          <BrowserRouter>
            <WheatWindShader />
            <Suspense fallback={<Fallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/403" element={<ForbiddenPage />} />
                <Route
                  element={
                    <RequireAdmin>
                      <AdminShell />
                    </RequireAdmin>
                  }
                >
                  <Route path="/" element={<HomePage />} />

                  <Route path="/ops/live"   element={<OpsLivePage />} />
                  <Route path="/ops/errors" element={<OpsErrorsPage />} />
                  <Route path="/ops/voice"  element={<OpsVoicePage />} />
                  <Route
                    path="/metrics/nsm"
                    element={
                      <PlaceholderPage
                        title="WVFD · North Star"
                        phase="Phase 3"
                        bullets={[
                          'Weekly trend line + goal=4.5',
                          'Per-farm breakdown table',
                          'Matches Metabase card exactly',
                        ]}
                      />
                    }
                  />
                  <Route
                    path="/farms"
                    element={
                      <PlaceholderPage
                        title="All Farms"
                        phase="Phase 4"
                        bullets={['Searchable, filterable, sortable', 'URL state', 'Drill-down to /farms/:farmId']}
                      />
                    }
                  />
                  <Route
                    path="/farms/silent-churn"
                    element={<PlaceholderPage title="Silent Churn" phase="Phase 4" />}
                  />
                  <Route
                    path="/farms/suffering"
                    element={<PlaceholderPage title="Suffering Watchlist" phase="Phase 4" />}
                  />
                  <Route
                    path="/schedules/templates"
                    element={<PlaceholderPage title="Schedule Templates" phase="Phase 5" />}
                  />
                  <Route
                    path="/users"
                    element={<PlaceholderPage title="Users" phase="Phase 5" />}
                  />
                  <Route
                    path="/settings/admins"
                    element={
                      <PlaceholderPage
                        title="Admin Users"
                        phase="Phase 6"
                        bullets={[
                          'Add/remove admin · writes to ssf.admin_users',
                          'Every write emits admin.added / admin.removed audit event',
                          'IAdminResolver unions config ∪ DB at JWT issuance',
                        ]}
                      />
                    }
                  />

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AdminAuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
