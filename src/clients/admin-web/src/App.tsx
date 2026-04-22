import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/app/ThemeProvider';
import { AdminAuthProvider, useAdminAuth } from '@/app/AdminAuthProvider';
import { WheatWindShader } from '@/app/WheatWindShader';
import { AdminShell } from '@/app/AdminShell';
import { CommandPalette } from '@/app/CommandPalette';

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
            <CommandPalette />
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
                  <Route path="/metrics/nsm" element={<NorthStarPage />} />
                  <Route path="/farms"                 element={<FarmsListPage />} />
                  <Route path="/farms/silent-churn"   element={<SilentChurnPage />} />
                  <Route path="/farms/suffering"      element={<SufferingPage />} />
                  <Route path="/schedules/templates"  element={<ScheduleTemplatesPage />} />
                  <Route path="/users"                element={<UsersPage />} />
                  <Route path="/settings/admins"      element={<SettingsAdminsPage />} />

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
