import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { adminApi } from '@/lib/api';
import { authStore } from '@/lib/auth';
import { queryClient as sharedQueryClient } from '@/lib/queryClient';
import type { StubbedAdapter } from '@/test/stubAdapter';
import {
  ORG_A_NAME, recordPageLoads, renderShell, restoreLocation, serve, signIn,
} from './shellSignOutFixture';

/**
 * spec: company-mis-real-numbers-2026-11-15 (plan CR-2d D14 (3)). Adapted by the test-writer.
 *
 * WAS: AdminShell.test.tsx, "sign out (B3, A13) empties this tab of the previous admin, not just
 * of their permissions": after Sign out, the previous admin's rows were gone from the test's own
 * QueryClient. It, and three tests after it in that file (B14 "refetches what THIS screen is
 * subscribed to", B14 "states the age once real data has arrived", B15 "the toast host ... is
 * mounted, polite, and empty"), failed in the join for one reason: they ran on a page that had
 * already signed out, which the SMS sign-in (PR 95) never leaves standing; it loads the login page
 * afresh. Those three keep their assertions in AdminShell.test.tsx, now that no press of Sign out
 * comes before them (see shellSignOutFixture.tsx). This one is adapted to assert PR 95's
 * guarantee, through the console's own Sign out button:
 *
 *   1. at the press, the stored session is gone and the ONE shared cache the console renders
 *      from (lib/queryClient.ts) holds nothing of the previous admin, rows and grants alike;
 *   2. from the press, no data request reaches the server;
 *   3. the login page is asked for afresh (a page load, not a router move), with no reason.
 *
 * PR 95's own tests pin the same rule under the hood: src/test/lib/api.signOut.server-answers.test.ts
 * ("empties the shared data cache", "a data request made after the sign-out is done never reaches
 * the server", "the login page opens, with no reason").
 */

let stub: StubbedAdapter | undefined;

afterEach(() => {
  stub?.restore();
  stub = undefined;
  restoreLocation();
  sharedQueryClient.clear();
});

describe('sign out (B3, A13)', () => {
  it('empties this tab of the previous admin, not just of their permissions', async () => {
    stub = serve();
    signIn({ display_name: 'Test Admin' });
    // The shell rendered on the console's own shared cache, as App.tsx renders it.
    renderShell({ queryClient: sharedQueryClient });

    await screen.findByText(ORG_A_NAME);
    sharedQueryClient.setQueryData(['farms', 'list', 1], { rows: ['a previous admin’s farms'] });
    expect(sharedQueryClient.getQueryCache().findAll({ queryKey: ['admin', 'me', 'scope'] }).length).toBeGreaterThan(0);

    const loads = recordPageLoads();
    const before = stub.requests.length;
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    // 1. At the press: nobody is stored, and nothing loaded for them is left to render.
    expect(authStore.get()).toBeNull();
    expect(sharedQueryClient.getQueryData(['farms', 'list', 1])).toBeUndefined();
    expect(sharedQueryClient.getQueryCache().findAll({ queryKey: ['admin', 'me', 'scope'] })).toEqual([]);

    // 2. From the press: a data request never reaches the server.
    await expect(adminApi.get('/shramsafal/admin/farms')).rejects.toBeDefined();
    const after = stub.requests.slice(before).map((r) => r.url);
    expect(after.filter((url) => !url.startsWith('/user/auth/'))).toEqual([]);

    // 3. The login page, asked for afresh, with no reason (the person signed out themselves).
    await waitFor(() => expect(loads).toEqual(['/login']));
  });
});
