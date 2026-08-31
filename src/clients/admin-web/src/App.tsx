import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminAuthProvider, useAdminAuth } from '@/app/AdminAuthProvider';
import { ActiveOrgProvider, useActiveOrg } from '@/app/ActiveOrgProvider';
import { AdminShell } from '@/app/AdminShell';
import { CommandPalette } from '@/app/CommandPalette';
import { useAdminScope } from '@/hooks/useAdminScope';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { EntitlementGuard } from '@/components/EntitlementGuard';
import { ModuleKeys } from '@/lib/moduleKeys';
import { describeAdminDenial } from '@/lib/adminErrors';
import { currentPathWithQuery, setLoginRedirectHandler } from '@/lib/returnTo';

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

/**
 * THE ONLY CATCH SITE THAT SEES EVERY QUERY.
 *
 * `AdminScopeAmbiguousError` and `AdminModuleForbiddenError` had zero catch
 * sites in this console. They still have to be *acted* on somewhere, and the
 * action is the same for both, for one reason: each of them is the server
 * contradicting the scope this client is currently gating on.
 *
 * The client caches `/admin/me/scope` for 60s and decides what to show from
 * that cache. If a data request comes back `admin_module_forbidden` for a
 * module the cached scope says is readable, the cache is wrong — the grant was
 * revoked, or the active org moved underneath it. Re-asking makes the console
 * gate on the truth within one request instead of within a minute. Doing
 * nothing leaves a revoked admin looking at a nav item they may no longer open.
 *
 * It cannot recurse: `/admin/me/scope` never returns 428 or 403. It answers
 * 200 with an `outcome` precisely so the client does not have to read error
 * codes to decide what to render (AdminEndpoints.cs:36-40, verified). So there
 * is no loop guard here, and that absence is deliberate rather than forgotten.
 *
 * It does NOT navigate. A background refetch failing is not a reason to yank a
 * working screen out from under someone; the four outcomes below, and the
 * panel's own honest-state, are where a denial becomes visible.
 */
const queryCache = new QueryCache({
  onError: (error) => {
    if (!describeAdminDenial(error)) return;
    void queryClient.invalidateQueries({ queryKey: ['admin', 'me', 'scope'] });
  },
});

const queryClient = new QueryClient({
  queryCache,
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
 *
 * `state.from` carries the WHOLE url, not the pathname. It used to be
 * `location.pathname`, which threw away the query string — and the query
 * string is where every piece of this console's url state lives: `page`,
 * `search`, `tier`, `weeks`, `days`, and `org`, which decides whose data the
 * page shows. A bookmarked `/farms?page=7&tier=B&org=<uuid>` came back as
 * `/farms` after signing in: page one, no filter, and possibly a different
 * organisation. See `lib/returnTo.ts` for why the browser url is reconciled
 * with the router's.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAdminAuth();
  const location = useLocation();
  if (status === 'loading') return <Fallback />;
  if (status === 'anonymous')
    return <Navigate to="/login" state={{ from: currentPathWithQuery(location) }} replace />;
  return <>{children}</>;
}

/**
 * Hands the router to the module-scoped axios interceptor.
 *
 * The interceptor cannot call hooks, so a 401 could only reach for
 * `window.location.assign('/login')` — a full reload, which cannot carry
 * router state, which means the url the user was on is gone by the time
 * LoginPage renders. This is the same bridge pattern, and the same reason, as
 * `getActiveOrgIdSnapshot()` in ActiveOrgProvider.
 *
 * `logout()` runs alongside the navigation because the interceptor has already
 * cleared the stored session: without it this provider still reports
 * `authenticated`, and the browser Back button walks straight back into a
 * shell with no token. The hard reload used to do that reset by accident.
 */
function LoginRedirectBridge() {
  const navigate = useNavigate();
  const { logout } = useAdminAuth();

  useEffect(
    () =>
      setLoginRedirectHandler((returnTo) => {
        logout();
        navigate('/login', { state: { from: returnTo }, replace: true });
      }),
    [navigate, logout],
  );

  return null;
}

/**
 * Scope gate — must live inside <RequireAuth> and <ActiveOrgProvider>.
 *   loading   → the fallback
 *   isError   → /403, saying the check FAILED rather than that it denied
 *   unresolved (Unauthorized) → /403 (no memberships — never going to work)
 *   ambiguous → full-page OrgSwitcher, "Choose your active organization"
 *   notInOrg  → full-page OrgSwitcher, "That organization is not in your memberships"
 *   resolved  → render children
 *
 * THREE OF THESE SIX HAVE NO URL OF THEIR OWN and appear in no screenshot.
 * This is not a screen in the design; it is a gate above every screen, and a
 * design-led port rebuilds it as "if signed in, show the app".
 *
 * `scopeUnavailable` is the one addition. A 500 or a dropped connection on
 * `/admin/me/scope` used to land on a page headed "403 · Access denied",
 * which is a lie in the most alarming possible direction: it tells an admin
 * their access was taken away when the truth is that the question could not be
 * asked. The route is unchanged — only what /403 is allowed to claim.
 *
 * TASK 12 STEP 5 — THE NotInOrg SENTENCE IS NOW TRUE.
 *
 * `clear()` was declared on ActiveOrgProvider and called from nowhere, so
 * "The previous selection has been cleared." was simply false: the rejected
 * org id stayed in localStorage AND in the url, and it was sent again on the
 * next request and on every reload after that. A console that tells an
 * operator it has done something and has not is worse than one that says
 * nothing. It is called below.
 *
 * Clearing has a consequence the copy must survive: the scope refetches
 * without an org header, and the server's next answer is usually `Ambiguous`
 * — which would replace "that organization is not yours" with the generic
 * "choose one" and lose the only explanation of what went wrong. So the
 * rejected id is latched for this mount, and the NotInOrg wording outranks
 * `Ambiguous` until a new organisation is actually selected.
 */
export function RequireScope({ children }: { children: ReactNode }) {
  const { isLoading, isError, outcome, memberships } = useAdminScope();
  const { activeOrgId, clear } = useActiveOrg();
  const [rejectedOrg, setRejectedOrg] = useState<string | null>(null);

  useEffect(() => {
    if (outcome !== 'NotInOrg' || !activeOrgId) return;
    setRejectedOrg(activeOrgId);
    clear();
  }, [outcome, activeOrgId, clear]);

  if (isLoading) return <Fallback />;
  if (isError) return <Navigate to="/403" state={{ scopeUnavailable: true }} replace />;

  if (outcome === 'Unauthorized') return <Navigate to="/403" replace />;

  // Checked BEFORE Ambiguous: after the clear above, the server answers
  // Ambiguous, and the generic headline would bury the reason.
  const rejected =
    outcome === 'NotInOrg' ||
    (rejectedOrg !== null && activeOrgId === null && outcome !== 'Resolved');

  if (rejected) {
    return (
      <OrgSwitcher
        memberships={memberships}
        fullPage
        headline="That organization is not in your memberships"
        subline="Pick an organization you actually belong to. The previous selection has been cleared."
      />
    );
  }

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

  return <>{children}</>;
}

/**
 * ORDER IS LOAD-BEARING (Preservation Register A45).
 *
 *   QueryClient > BrowserRouter > ActiveOrg > AdminAuth
 *
 * Reordering compiles fine and type-checks fine, then breaks org-keyed scope
 * invalidation at runtime: AdminAuthProvider calls useQueryClient() and must
 * sit inside QueryClientProvider, and ActiveOrgProvider must WRAP
 * AdminAuthProvider because the scope query key ends in the active org
 * (useAdminScope.ts:72) and login() invalidates that exact key
 * (AdminAuthProvider.tsx:44). Flip the last two and login invalidates a key
 * that no longer means what the invalidator thought it meant — nothing throws.
 *
 * The plan's Step 1 lists five, led by ThemeProvider. That provider was
 * deleted with the dark-mode toggle it existed to serve (D1, founder
 * 2026-08-31, Task 3); light mode is locked in globals.css and declared on
 * <html data-mode="light">, so there is nothing left for a theme context to
 * hold, and `useTheme` — which Step 1 also asks to keep failing fast — no
 * longer exists. `useAdminAuth` and `useActiveOrg` still throw by name.
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ActiveOrgProvider>
          <AdminAuthProvider>
            <LoginRedirectBridge />
            <Suspense fallback={<Fallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/403" element={<ForbiddenPage />} />
                <Route
                  element={
                    <RequireAuth>
                      <RequireScope>
                        {/* TASK 13 MOVED THIS INSIDE THE GATE. IT IS A SECURITY
                            CHANGE, NOT A TIDY-UP (Preservation Register A46).

                            It used to sit beside <Routes>, outside RequireAuth,
                            which was harmless while the palette listed eleven
                            static page names. Task 13 made it index farm names,
                            owners and farmer phone numbers — the whole point of
                            the v2 palette — and that PII would then have been
                            one keystroke away from the sign-in screen. The v3
                            prototype dodged the same problem by not loading
                            app.js on login.html; an omission is not a rule and
                            does not survive a port.

                            It is inside RequireScope as well, because every
                            entry it can offer is scoped to one organisation and
                            `canRead` fails closed until the scope resolves.
                            Above this line it would be a keystroke that opens
                            an empty dialog on the org-switcher interstitial.

                            `CommandPalette.test.tsx` fails if it moves back
                            out. */}
                        <CommandPalette />
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
  );
}
