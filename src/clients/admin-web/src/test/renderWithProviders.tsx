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
 * `route` SETS THE ORG. Say it that way round, because until Task 12 it did
 * not, and the warning that used to stand here is the thing that changed.
 *
 * `ActiveOrgProvider` read `window.location.href` directly, so `route` drove
 * the router and nothing else: a test passing `route: '/?org=<uuid>'` got "no
 * org", silently, and had to write the real jsdom url instead. Task 12 Step 2
 * moved the read onto `useSearchParams`, and `route` is now the single way a
 * test says which organisation is active — the same single way the app has.
 *
 * A stale warning is worse than no warning: it teaches the next author to
 * reach for `window.history.replaceState`, which under a MemoryRouter now sets
 * an org that nothing reads. If you need `?org=` in a test, pass it in `route`.
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
