import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AdminAuthProvider, useAdminAuth } from '@/app/AdminAuthProvider';
import { ActiveOrgProvider, useActiveOrg } from '@/app/ActiveOrgProvider';
import { AdminShell } from '@/app/AdminShell';
import { ConsoleBootBoundary } from '@/app/ConsoleBootBoundary';
import { CommandPalette } from '@/app/CommandPalette';
import { useAdminScope } from '@/hooks/useAdminScope';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { EntitlementGuard } from '@/components/EntitlementGuard';
import { ServerUnreachable } from '@/components/ServerUnreachable';
import { gotNoVerdict } from '@/lib/api';
import { ModuleKeys } from '@/lib/moduleKeys';
import { signInKey, type NoAccessState } from '@/lib/noAccessView';
import { queryClient } from '@/lib/queryClient';

const HomePage               = lazy(() => import('@/pages/HomePage'));
const LoginPage               = lazy(() => import('@/pages/LoginPage'));
const ForbiddenPage           = lazy(() => import('@/pages/ForbiddenPage'));
const NotFoundPage            = lazy(() => import('@/pages/NotFoundPage'));

const OpsLivePage             = lazy(() => import('@/pages/ops/OpsLivePage'));
const OpsErrorsPage           = lazy(() => import('@/pages/ops/OpsErrorsPage'));
const AppVersionsPage         = lazy(() => import('@/pages/ops/AppVersionsPage'));
const NorthStarPage           = lazy(() => import('@/pages/metrics/NorthStarPage'));
const FarmsListPage           = lazy(() => import('@/pages/farms/FarmsListPage'));
const SilentChurnPage         = lazy(() => import('@/pages/farms/SilentChurnPage'));
const SufferingPage           = lazy(() => import('@/pages/farms/SufferingPage'));
const ScheduleTemplatesPage   = lazy(() => import('@/pages/schedules/ScheduleTemplatesPage'));
const ScheduleCheckPage       = lazy(() => import('@/pages/schedules/ScheduleCheckPage'));
const UsersPage               = lazy(() => import('@/pages/users/UsersPage'));
const SettingsAdminsPage      = lazy(() => import('@/pages/settings/SettingsAdminsPage'));

// DWC v2 §4.3 — Farmer Health (Mode B landing + Mode A drilldown).
const FarmerHealthPage        = lazy(() => import('@/features/farmer-health/FarmerHealthPage'));
const FarmerHealthDrilldown   = lazy(() => import('@/features/farmer-health/FarmerHealthDrilldown'));
const MisPage                 = lazy(() => import('@/features/mis/MisPage'));

/* THE ONLY CATCH SITE THAT SEES EVERY QUERY (the QueryCache that re-asks the
   scope when the server contradicts it) now lives with the console's one
   QueryClient in `lib/queryClient.ts`, unchanged: the SMS sign-in keeps that
   client in its own module so api.ts can empty it at every end of a session. */

function Fallback({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="grid min-h-[400px] place-items-center text-body text-text-2">{text}</div>
  );
}

/**
 * Authentication gate — JWT must exist. No scope check here.
 *   loading     → spinner. A sign-out takes the screens down at the press, and the page then
 *                 stays here while the server is told: it says so.
 *   unreachable → the stored session could not be renewed for want of an answer: say so
 *   anonymous   → /login. The page that was asked for is not remembered: whoever signs in next
 *                 always starts on the home page, never on the page of the person before.
 *
 * CR-2d join: this is the SMS sign-in's gate. The September console's deep-link return
 * (`state.from` = the whole url, spent by the old LoginPage; Preservation Register A9) is not
 * carried: the SMS sign-in decides the first page after a sign-in, and it is always the home
 * page, because the last person to use this tab may have been somebody else.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, retry, signingOut } = useAdminAuth();
  if (status === 'loading') return <Fallback text={signingOut ? 'Signing out…' : undefined} />;
  if (status === 'unreachable') return <ServerUnreachable onRetry={retry} />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Scope gate — must live inside <RequireAuth> and <ActiveOrgProvider>.
 *   loading   → the fallback
 *   no verdict (no answer, 429, 5xx) → "The server could not be reached" (never /403)
 *   other error → /403, not on the team
 *   unresolved (Unauthorized) → /403 (no memberships — never going to work)
 *   ambiguous → full-page OrgSwitcher, "Choose your active organization"
 *   notInOrg  → full-page OrgSwitcher, "That organization is not in your memberships"
 *   resolved  → render children
 *
 * THREE OF THESE HAVE NO URL OF THEIR OWN and appear in no screenshot.
 * This is not a screen in the design; it is a gate above every screen, and a
 * design-led port rebuilds it as "if signed in, show the app".
 *
 * Both ways to /403 say why, and in which sign-in that was found (`signInKey`): the no-access
 * page shows a reason only in that sign-in, never to whoever signs in next (see `noAccessView`).
 * A server that gave no verdict has refused nobody, so it never lands on /403: that is the
 * SMS sign-in's `ServerUnreachable`, which replaces the September console's "We could not
 * check your access" /403 state for the same cases (a 500 or a dropped connection).
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
  const { session } = useAdminAuth();
  const { isLoading, isFetching, isError, error, refetch, outcome, memberships } = useAdminScope();
  const { activeOrgId, clear } = useActiveOrg();
  const [rejectedOrg, setRejectedOrg] = useState<string | null>(null);
  const notOnTeam: NoAccessState = {
    reason: 'not-on-team',
    account: signInKey(session) ?? undefined,
  };

  useEffect(() => {
    if (outcome !== 'NotInOrg' || !activeOrgId) return;
    setRejectedOrg(activeOrgId);
    clear();
  }, [outcome, activeOrgId, clear]);

  if (isLoading) return <Fallback />;
  if (isError) {
    // A server that did not answer has refused nobody: "Access denied" would be untrue.
    if (gotNoVerdict(error)) return <ServerUnreachable onRetry={refetch} retrying={isFetching} />;
    return <Navigate to="/403" state={notOnTeam} replace />;
  }

  if (outcome === 'Unauthorized') return <Navigate to="/403" state={notOnTeam} replace />;

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
 *
 * CR-2d join: since the SMS sign-in, AdminAuthProvider reaches the one client
 * through `lib/queryClient.ts` (login() and every end of a session EMPTY it)
 * rather than through useQueryClient(); the order is kept as it was.
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ActiveOrgProvider>
          <AdminAuthProvider>
            {/* TASK 26 STEP 7 — THE BOOT-FAILURE STATE.

                Every screen below is a `lazy()` import. `<Suspense>` covers a
                chunk that is still arriving; nothing covered a chunk that never
                arrives, and there was no error boundary anywhere in this
                application — so a rejected dynamic import (the ordinary
                consequence of a deploy while a console is open) unmounted the
                whole tree and left an operator looking at white.

                It wraps the routes rather than sitting inside one, because the
                shell is as capable of failing as a page is; and it is imported
                statically, never lazily, because a boundary that must itself be
                fetched cannot report a failed fetch. */}
            <ConsoleBootBoundary>
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
                    {/* B24: `/` opens Company MIS Overview (D-151 a default). Home moved to `/home`
                        and holds two ideas that make no request, so no single module gate fits and
                        there is no guard here. `/ops/voice` is not a route: the Voice Pipeline page
                        was a double of Company MIS Quality; its file stays for CR-2d. */}
                    <Route path="/" element={<Navigate to="/MIS/overview" replace />} />
                    <Route path="/home" element={<HomePage />} />

                    <Route path="/ops/live" element={
                      <EntitlementGuard module={ModuleKeys.OpsLive}><OpsLivePage /></EntitlementGuard>
                    } />
                    <Route path="/ops/errors" element={
                      <EntitlementGuard module={ModuleKeys.OpsErrors}><OpsErrorsPage /></EntitlementGuard>
                    } />
                    {/* spec: control-room-app-versions-2026-11-12 - gated on ops.live, the same key the
                        server route checks (CR-2d join, Task 3 Step 1). */}
                    <Route path="/ops/app-versions" element={
                      <EntitlementGuard module={ModuleKeys.OpsLive}><AppVersionsPage /></EntitlementGuard>
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
                    {/* Company MIS (CR-2b): seven explicit paths, not `/MIS/:section`,
                        because CommandPalette.test looks each nav path up as a declared
                        route. One lazy chunk; one company count per chosen range. */}
                    <Route path="/MIS/overview" element={
                      <EntitlementGuard module={ModuleKeys.MetricsNsm}><MisPage section="overview" /></EntitlementGuard>
                    } />
                    <Route path="/MIS/acquisition" element={
                      <EntitlementGuard module={ModuleKeys.MetricsNsm}><MisPage section="acquisition" /></EntitlementGuard>
                    } />
                    <Route path="/MIS/engagement" element={
                      <EntitlementGuard module={ModuleKeys.MetricsNsm}><MisPage section="engagement" /></EntitlementGuard>
                    } />
                    <Route path="/MIS/retention" element={
                      <EntitlementGuard module={ModuleKeys.MetricsNsm}><MisPage section="retention" /></EntitlementGuard>
                    } />
                    <Route path="/MIS/quality" element={
                      <EntitlementGuard module={ModuleKeys.MetricsNsm}><MisPage section="quality" /></EntitlementGuard>
                    } />
                    <Route path="/MIS/farms" element={
                      <EntitlementGuard module={ModuleKeys.MetricsNsm}><MisPage section="farms" /></EntitlementGuard>
                    } />
                    <Route path="/MIS/operations" element={
                      <EntitlementGuard module={ModuleKeys.MetricsNsm}><MisPage section="operations" /></EntitlementGuard>
                    } />
                    <Route path="/MIS" element={<Navigate to="/MIS/overview" replace />} />
                    {/* Schedules + Settings: no matching module key in W0-A's ModuleKey set yet.
                        Relying on RequireScope (any resolved scope) for now; specific module
                        gates land when schedule / admin-management surfaces add their keys. */}
                    <Route path="/schedules/templates" element={<ScheduleTemplatesPage />} />
                    {/* spec: plr-d10 lane SCH-A - the schedule check is a ShramSafal platform act: gated on
                        its own module key. As on the go-live line it has NO menu entry; the templates
                        page links to it (CR-2d D3, Task 3 Step 2). */}
                    <Route path="/schedules/check" element={
                      <EntitlementGuard module={ModuleKeys.ScheduleReview}><ScheduleCheckPage /></EntitlementGuard>
                    } />
                    <Route path="/settings/admins" element={<SettingsAdminsPage />} />

                    {/* TASK 27 STEP 2 — A REAL 404 REPLACES A SILENT BOUNCE (A43).

                        This was `<Navigate to="/" replace />`: every unknown
                        path landed on Home with the address bar rewritten and
                        nothing said. A typo, a stale bookmark and a BUG were
                        then indistinguishable — which is not a hypothesis, it
                        is how D11 lived its whole life. FarmsListPage sent
                        every row click to `/farms/:farmId`, a route that has
                        never been registered, and the catch-all swallowed all
                        of them into Home under a `cursor-pointer` table. The
                        mask is no longer load-bearing: Task 14 replaced that
                        row-click with DataList's expandable row, and there is
                        now no `navigate()` in this console pointing at an
                        unregistered path (verified by grep, not by build).

                        It stays INSIDE the shell route on purpose, so the
                        answer to "is this address real?" is still gated the
                        same way every other answer is: an anonymous visitor
                        is sent to /login by RequireAuth exactly as before,
                        and a signed-in one gets the nav on screen beside the
                        message rather than a dead end. */}
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </Suspense>
            </ConsoleBootBoundary>
          </AdminAuthProvider>
        </ActiveOrgProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
