import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActiveOrgProvider } from '@/app/ActiveOrgProvider';
import { AdminAuthProvider } from '@/app/AdminAuthProvider';

/**
 * A QueryClient built for assertions rather than for a live console.
 *
 * `retry: false` so a deliberate 500 fails once and immediately, instead of
 * being retried into a test timeout. `staleTime: 0` / `gcTime: 0` so no result
 * survives into the next test — the app's own client uses `staleTime: 60_000`
 * (App.tsx:34-42), which would make a cached response look like a fresh fetch.
 */
export function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

/**
 * Mirrors the provider stack in App.tsx exactly:
 *
 *   QueryClientProvider > Router > ActiveOrgProvider > AdminAuthProvider
 *
 * It was five deep and led with ThemeProvider until Task 3 deleted that
 * provider with dark mode (D1). Four now, and the two constraints below are
 * the ones that were ever load-bearing.
 *
 * The order is load-bearing and is itself a preserved capability (Preservation
 * Register A45):
 *
 *  - AdminAuthProvider calls `useQueryClient()` (AdminAuthProvider.tsx:23), so
 *    it MUST sit inside QueryClientProvider or it throws on mount.
 *  - ActiveOrgProvider MUST wrap AdminAuthProvider: the /me/scope query key
 *    depends on the active org, and `login()` invalidates that exact key
 *    (AdminAuthProvider.tsx:44). Flip the two and login invalidates a key that
 *    no longer means what the invalidator thought it meant.
 *
 * ONE substitution, and it is the only difference from App.tsx: BrowserRouter
 * becomes MemoryRouter, because jsdom has no navigable history stack.
 *
 * CONSEQUENCE WORTH KNOWING BEFORE YOU WRITE A TEST: `route` below drives the
 * ROUTER only. ActiveOrgProvider does not read the router — it reads
 * `window.location.href` directly (ActiveOrgProvider.tsx:41) so that the axios
 * interceptor can see the value without a React subscription. A test that
 * needs `?org=<id>` to be picked up on mount must therefore set the real jsdom
 * URL (`window.history.replaceState({}, '', '/?org=<uuid>')`) BEFORE rendering.
 * Passing `route: '/?org=<uuid>'` here will not do it, and will silently
 * resolve to "no org" rather than fail.
 */
export function renderWithProviders(
  ui: ReactNode,
  { route = '/', queryClient = makeTestQueryClient() } = {},
) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <ActiveOrgProvider>
            <AdminAuthProvider>{ui}</AdminAuthProvider>
          </ActiveOrgProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
