import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import ForbiddenPage from '@/pages/ForbiddenPage';
import { authStore } from '@/lib/auth';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { StubbedAdapter } from '@/test/stubAdapter';
import { restoreLocation, serve, signIn, recordPageLoads, renderShell } from './shellSignOutFixture';

/**
 * THE SHELL'S SIGN OUT (B3, A13), moved out of AdminShell.test.tsx in the CR-2d join with its
 * assertions unchanged: why it needs a file of its own is in `shellSignOutFixture.tsx`. One press
 * of Sign out per file; the press is the last thing this file does.
 */

let stub: StubbedAdapter | undefined;

afterEach(() => {
  stub?.restore();
  stub = undefined;
  restoreLocation();
});

describe('sign out (B3, A13)', () => {
  it('leaves the /403 sign-out in place — a denied admin still needs one', () => {
    // A13. The shell's control is an ADDITION; the console had exactly one
    // sign-out anywhere and /403 is outside the shell by design.
    signIn({ display_name: 'Test Admin' });
    renderWithProviders(<ForbiddenPage />);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('is in the shell — an admin on a working screen can now leave', async () => {
    stub = serve();
    signIn({ display_name: 'Test Admin' });
    renderShell();

    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    // The SMS sign-in then loads the login page afresh; recorded here, not followed (jsdom).
    recordPageLoads();
    await userEvent.click(signOut);

    expect(authStore.get()).toBeNull();
  });
});
