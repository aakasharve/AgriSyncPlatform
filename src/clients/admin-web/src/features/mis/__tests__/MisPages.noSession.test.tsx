import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '@/lib/auth';
import { resetMisPeriod } from '@/features/mis/misPeriod';
import type { StubbedAdapter } from '@/test/stubAdapter';
import { MIS_NOW, misCalls, pageTextWithoutRange, renderMis, serveMis } from '@/test/misPage';

/**
 * CR-2b Task 4, "states that show no number": No_session_leaves_no_numbers. Moved out of
 * MisPages.test.tsx and adapted in the CR-2d join (plan D14 (3)) by the test-writer.
 *
 * WHAT CHANGED, AND WHY. The test pinned two things: no number is shown when the session is gone,
 * and a 401 from the count clears the session. The second was the September console's 401 rule.
 * PR 95 (the SMS sign-in) replaced it, and the join keeps it: a 401 asks for ONE renewal from the
 * refresh cookie, and the session ends only when the server refuses that renewal (PR 95's
 * src/test/lib/api.requests.renewal-refused-after-401.test.ts: "clears the session", "opens
 * /login?signedOut=ended", "does not send the data request again"). So "no session" is now
 * written the way it happens: the count answers 401 AND the server refuses the renewal. The claim
 * about the page is unchanged: no number on it.
 *
 * Why its own file: an ended session ends the page in the SMS sign-in (no data request leaves
 * after it until the login page is loaded afresh), and vitest gives each FILE a fresh page.
 */

let stub: StubbedAdapter | null = null;
let locationDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MIS_NOW);
  resetMisPeriod();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  vi.useRealTimers();
  if (locationDescriptor) {
    Object.defineProperty(window, 'location', locationDescriptor);
    locationDescriptor = undefined;
  }
});

/** The renewal call goes out on axios's default instance (lib/sessionRenewal.ts); the server refuses it. */
function refuseRenewals(): string[] {
  const calls: string[] = [];
  axios.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    calls.push(`${(config.method ?? 'get').toUpperCase()} ${config.url ?? ''}`);
    return Promise.reject({
      response: { status: 401, data: {}, statusText: '401', headers: {}, config },
      config,
      isAxiosError: true,
      message: 'Request failed with status code 401',
    });
  }) as AxiosAdapter;
  return calls;
}

/** Records the page loads the console asks for (jsdom cannot follow one). */
function recordPageLoads(): string[] {
  const loads: string[] = [];
  locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/', search: '', href: 'http://localhost/', assign: (to: string) => loads.push(to) },
  });
  return loads;
}

describe('states that show no number (CR-2b Task 4)', () => {
  it('No_session_leaves_no_numbers', async () => {
    authStore.set({
      accessToken: 'token-mis',
      refreshToken: null,
      userId: '00000000-0000-0000-0000-0000000000bb',
      expiresAtUtc: new Date(MIS_NOW.getTime() + 3_600_000).toISOString(),
      signedInAtUtc: new Date(MIS_NOW.getTime()).toISOString(),
    });
    const renewals = refuseRenewals();
    const loads = recordPageLoads();
    stub = serveMis(async () => ({ status: 401, data: {} }));

    const { container } = renderMis('quality');

    await waitFor(() => expect(localStorage.getItem('admin.session.v1')).toBeNull());
    // One renewal was asked for and refused; the count was not sent again.
    expect(renewals).toHaveLength(1);
    expect(renewals[0]).toMatch(/^POST .*\/user\/auth\/refresh$/);
    expect(misCalls(stub)).toHaveLength(1);
    // The session ended the SMS sign-in's way: the login page, afresh, saying why.
    await waitFor(() => expect(loads).toEqual(['/login?signedOut=ended']));
    // And the page shows no number.
    expect(container.querySelectorAll('[data-mis-item]')).toHaveLength(0);
    expect(pageTextWithoutRange()).not.toMatch(/\d/);
  });
});
