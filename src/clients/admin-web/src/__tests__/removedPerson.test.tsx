import type { ReactElement } from 'react';
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { render, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import App from '@/App';
import { authStore } from '@/lib/auth';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * spec: trusted-control-room-2026-11-20 (CR-3, Task A7; K24).
 *
 * A_removed_person_sees_no_company_page. Removing a person ends their seat on the server, so their
 * next request is a 401 (`admin_no_membership` is a 403, a dead token a 401). The console tries one
 * renewal; the server refuses it (the refresh cookie is revoked with the seat); the session ends
 * and the console leaves for the login page. At no point is a company number on screen.
 *
 * Its own file: ending a session is a once-per-page-load act in `lib/api.ts`, so this is the only
 * test in the file. (The "Unauthorized scope lands on /403" half is in landing.byAccess.test.tsx.)
 */

const WAIT = 15_000;
const SESSION = {
  accessToken: 'token-of-a-removed-person',
  refreshToken: null,
  userId: '00000000-0000-0000-0000-0000000000bb',
  expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
  signedInAtUtc: new Date(Date.now()).toISOString(),
};

let stub: StubbedAdapter | null = null;
const renewalCalls: string[] = [];

afterEach(() => {
  stub?.restore();
  stub = null;
  const tree = App() as ReactElement;
  (tree.props as { client: QueryClient }).client.clear();
});

describe('a removed person', () => {
  it('A_removed_person_sees_no_company_page', async () => {
    authStore.set(SESSION);
    // Every request of the person is a 401 (their seat and refresh cookie are gone).
    stub = installAdapter(async () => ({ status: 401, data: {} }));
    // The renewal goes out on the default axios client (lib/sessionRenewal.ts) and is refused.
    axios.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      renewalCalls.push(`${(config.method ?? 'get').toUpperCase()} ${config.url}`);
      return Promise.reject({
        isAxiosError: true,
        config,
        message: 'Request failed with status code 401',
        response: { status: 401, data: {}, statusText: '401', headers: {}, config },
      });
    }) as AxiosAdapter;

    window.history.replaceState({}, '', '/MIS/overview');
    render(<App />);

    // The renewal was tried, once, and refused ...
    await waitFor(() => expect(renewalCalls.length).toBeGreaterThan(0), { timeout: WAIT });
    expect(renewalCalls[0]).toContain('/user/auth/refresh');
    // ... so the session ended: nothing is stored, and the console is on its way to /login.
    await waitFor(() => expect(authStore.get()).toBeNull(), { timeout: WAIT });
    // No company page, heading or figure is on screen.
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Home' })).not.toBeInTheDocument();
    // No data request other than the scope was sent.
    expect(stub.requests.every((r) => r.url.includes('/admin/me/scope'))).toBe(true);
  });
});
