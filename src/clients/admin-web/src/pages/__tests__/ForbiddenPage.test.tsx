import { Navigate, Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import ForbiddenPage from '@/pages/ForbiddenPage';
import { authStore } from '@/lib/auth';
import { renderWithProviders } from '@/test/renderWithProviders';

/**
 * Preservation Register A13 — /403 is where every denial in this console
 * lands, it sits DELIBERATELY outside RequireScope, and until Task 10 put one
 * in the shell it held the only sign-out control in the application.
 *
 * Reached the way the guards reach it: by a navigation carrying router state.
 */
function renderForbidden(state: unknown) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Navigate to="/403" state={state} replace />} />
      <Route path="/403" element={<ForbiddenPage />} />
    </Routes>,
    { route: '/' },
  );
}

afterEach(() => {
  localStorage.clear();
});

/*
 * RETIRED IN THE CR-2d JOIN (plan D14 (3), Task 2 Step 1): six tests of the September console's
 * /403 page, which PR 95 (the SMS sign-in) replaced with its no-access page; the join keeps PR 95's
 * ForbiddenPage (one of the ten files both lanes changed, kept on the sign-in side):
 *   - "the two original message variants are unchanged (A13) names the module when
 *     EntitlementGuard refused one" ("403 · Access denied", the module key shown)
 *   - "... falls back to the no-membership copy, with the pointer to /settings/admins"
 *   - "a failed CHECK is not a denial (Task 11) says so, and does not accuse the account of
 *     losing its access" (the /403 "We could not check your access" state)
 *   - "both actions survive on every variant (A13) %s keeps Sign out and Go to login", its three
 *     cases (a module denial, no membership, an unavailable scope check)
 * PR 95's page: three cases chosen by `noAccessView` (not on the team / this one page is closed /
 * no reason), a reason shown only to the sign-in it was found in, no module key on screen, Sign
 * out, and "Back to the home page" where the rest of the console still opens; it has no "Go to
 * login" (Sign out is the way to the login page). A scope check with no verdict never comes here:
 * it shows "The server could not be reached" in place. Pinned by PR 95's own tests
 * (`npm run test:session`): src/test/lib/noAccessView.test.ts ("the no-access page gives no
 * reason ...", "... gives a reason to the account it is true for", "a 'not on the team' entry
 * left by one sign-in"), src/test/lib/api.signOut.server-answers.test.ts ("the login page opens,
 * with no reason"); and through the whole console by deepLink.contract.test.tsx ("a GUARDED route
 * still turns that same scope away", "a 500 on /admin/me/scope says the server could not be
 * reached").
 */
describe('sign out on /403 (A13)', () => {
  it('sign out really clears the stored session', async () => {
    authStore.set({
      accessToken: 't',
      refreshToken: null,
      userId: 'u1',
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
      signedInAtUtc: new Date(Date.now()).toISOString(),
    });
    renderForbidden(null);

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(localStorage.getItem('admin.session.v1')).toBeNull();
  });
});
