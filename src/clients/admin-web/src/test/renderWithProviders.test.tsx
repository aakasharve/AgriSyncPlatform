import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import { useTheme } from '@/app/ThemeProvider';
import { useActiveOrg } from '@/app/ActiveOrgProvider';
import { useAdminAuth } from '@/app/AdminAuthProvider';
import { makeTestQueryClient, renderWithProviders } from './renderWithProviders';

/**
 * A self-test for the harness, not for the console.
 *
 * Task 2 writes the characterisation tests that lock the console's behaviour.
 * This file exists because those tests are only worth what the harness under
 * them is worth: every one of the five providers has a fail-fast throw or an
 * internal `useQueryClient()` that turns a wrong nesting order into a mount
 * error, so a probe that consumes all five is a direct proof of A45 rather
 * than a claim about it.
 *
 * It also means `npm run test` passes because something ran — not because
 * `passWithNoTests` was switched on over an empty suite.
 */
function Probe() {
  const { theme } = useTheme();              // throws outside ThemeProvider
  const { activeOrgId } = useActiveOrg();    // throws outside ActiveOrgProvider
  const { status } = useAdminAuth();         // throws outside AdminAuthProvider
  const { pathname } = useLocation();        // throws outside a Router
  const fetching = useIsFetching();          // throws outside QueryClientProvider

  return (
    <dl>
      <dd data-testid="theme">{theme}</dd>
      <dd data-testid="org">{activeOrgId ?? 'none'}</dd>
      <dd data-testid="auth">{status}</dd>
      <dd data-testid="path">{pathname}</dd>
      <dd data-testid="fetching">{String(fetching)}</dd>
    </dl>
  );
}

describe('renderWithProviders', () => {
  it('mounts children inside all five providers, in App.tsx order', () => {
    renderWithProviders(<Probe />);

    // Each of these resolving at all is the assertion: the corresponding
    // provider was present and above the consumer.
    expect(screen.getByTestId('theme')).toHaveTextContent('fresh');
    expect(screen.getByTestId('org')).toHaveTextContent('none');
    expect(screen.getByTestId('path')).toHaveTextContent('/');
    expect(screen.getByTestId('fetching')).toHaveTextContent('0');

    // AdminAuthProvider starts at 'loading' and settles in an effect
    // (AdminAuthProvider.tsx:25-33). React's act() inside render flushes it,
    // so with an empty localStorage the settled value is 'anonymous'.
    expect(screen.getByTestId('auth')).toHaveTextContent('anonymous');
  });

  it('starts the router at the requested route', () => {
    renderWithProviders(<Probe />, { route: '/ops/errors' });
    expect(screen.getByTestId('path')).toHaveTextContent('/ops/errors');
  });

  it('hands back the query client it mounted, configured not to retry', () => {
    const queryClient = makeTestQueryClient();
    const result = renderWithProviders(<Probe />, { queryClient });

    expect(result.queryClient).toBe(queryClient);
    // retry:false so a deliberate error surfaces on the first attempt rather
    // than being retried into a timeout that reads as a flake.
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(0);
  });
});
