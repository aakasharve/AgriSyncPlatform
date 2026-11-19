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

describe('the two original message variants are unchanged (A13)', () => {
  it('names the module when EntitlementGuard refused one', async () => {
    renderForbidden({ from: '/ops/live', module: 'ops.live' });

    expect(await screen.findByText(/Your admin scope does not grant access to/)).toBeInTheDocument();
    expect(screen.getByText('ops.live')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '403 · Access denied' })).toBeInTheDocument();
  });

  it('falls back to the no-membership copy, with the pointer to /settings/admins', async () => {
    renderForbidden(null);

    expect(
      await screen.findByText(/Your account does not have an admin membership for this console/),
    ).toBeInTheDocument();
    expect(screen.getByText('/settings/admins')).toBeInTheDocument();
  });
});

describe('a failed CHECK is not a denial (Task 11)', () => {
  it('says so, and does not accuse the account of losing its access', async () => {
    // RequireScope sends this when /admin/me/scope errors. The page used to
    // greet a 500 with "403 · Access denied", which tells an admin their
    // permissions were revoked when the truth is that the question could not
    // be asked — the most alarming possible way to be wrong.
    renderForbidden({ scopeUnavailable: true });

    expect(
      await screen.findByRole('heading', { name: 'We could not check your access' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('403 · Access denied')).toBeNull();
    expect(screen.getByText(/not a permissions problem/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing about your account has changed/)).toBeInTheDocument();
  });
});

describe('both actions survive on every variant (A13)', () => {
  it.each([
    ['a module denial', { module: 'ops.live' }],
    ['no membership', null],
    ['an unavailable scope check', { scopeUnavailable: true }],
  ])('%s keeps Sign out and Go to login', async (_case, state) => {
    renderForbidden(state);

    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to login' })).toHaveAttribute('href', '/login');
  });

  it('sign out really clears the stored session', async () => {
    authStore.set({
      accessToken: 't',
      refreshToken: null,
      userId: 'u1',
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    });
    renderForbidden(null);

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(localStorage.getItem('admin.session.v1')).toBeNull();
  });
});
