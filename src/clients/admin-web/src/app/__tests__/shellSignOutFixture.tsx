import { Route, Routes } from 'react-router-dom';
import type { QueryClient } from '@tanstack/react-query';
import { AdminShell } from '@/app/AdminShell';
import { authStore } from '@/lib/auth';
import type { MeScopeResponse } from '@/hooks/useAdminScope';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * The shell's sign-out tests, one press per file (plan CR-2d D14 (3)).
 *
 * WHY THEY LIVE APART FROM AdminShell.test.tsx. In the SMS sign-in (PR 95) a press of Sign out
 * ends the PAGE, not only the session: from the press no data request leaves and no renewal
 * starts (a latch in lib/api.ts that is never lifted), and the login page is then loaded afresh,
 * which is what gives the next person a clean page. jsdom cannot load a page afresh, and vitest
 * gives each test FILE a fresh page, not each test. So a press inside AdminShell.test.tsx left
 * every later test in that file on a page that had already signed out: their requests never
 * left and they waited for answers that could not come. Each press now has a file of its own,
 * and AdminShell.test.tsx keeps every other test, unchanged.
 *
 * The same helpers as AdminShell.test.tsx, for these files only. Made-up names and numbers.
 */

export const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const ORG_A_NAME = 'Shivar Farmer Producer Company';

/** A JWT-shaped string carrying real claims. Only the payload is read. */
function tokenWith(claims: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(claims));
  const binary = String.fromCharCode(...bytes);
  const payload = btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${payload}.signature`;
}

export function signIn(claims: Record<string, unknown>) {
  authStore.set({
    accessToken: tokenWith(claims),
    refreshToken: null,
    userId: String(claims.sub ?? 'user-1'),
    expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
    signedInAtUtc: new Date(Date.now()).toISOString(),
  });
}

function scopeResponse(): MeScopeResponse {
  return {
    outcome: 'Resolved',
    scope: {
      userId: 'user-1',
      orgId: ORG_A,
      orgType: 'FPO',
      orgRole: 'Owner',
      isPlatformAdmin: false,
      modules: [],
    },
    memberships: [{ orgId: ORG_A, orgName: ORG_A_NAME, orgType: 'FPO', orgRole: 'Owner' }],
  };
}

/** Every request answered as the scope endpoint answers (the sign-out call takes any 2xx). */
export function serve(): StubbedAdapter {
  return installAdapter(async () => ({ status: 200, data: scopeResponse() }));
}

/** The shell as a layout route with a child that renders a fixed string and nothing else. */
export function renderShell({ queryClient = makeTestQueryClient() }: { queryClient?: QueryClient } = {}) {
  return renderWithProviders(
    <Routes>
      <Route element={<AdminShell />}>
        <Route path="*" element={<div>page body</div>} />
      </Route>
    </Routes>,
    { route: '/', queryClient },
  );
}

let locationDescriptor: PropertyDescriptor | undefined;

/**
 * Records the page loads the console asks for. jsdom's `window.location.assign` is not
 * configurable, so the whole property is swapped (the same way api.contract.test.ts does it);
 * `restoreLocation()` puts it back.
 */
export function recordPageLoads(): string[] {
  const loads: string[] = [];
  locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/', search: '', href: 'http://localhost/', assign: (to: string) => loads.push(to) },
  });
  return loads;
}

export function restoreLocation() {
  if (locationDescriptor) {
    Object.defineProperty(window, 'location', locationDescriptor);
    locationDescriptor = undefined;
  }
}
