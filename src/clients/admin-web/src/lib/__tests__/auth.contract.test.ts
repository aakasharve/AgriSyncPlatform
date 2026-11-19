import { createElement, useEffect } from 'react';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { authStore, decodeJwt, type AdminSession } from '@/lib/auth';
import { useAdminAuth } from '@/app/AdminAuthProvider';
import { queryClient as sharedQueryClient } from '@/lib/queryClient';
import { renderWithProviders } from '@/test/renderWithProviders';

/**
 * CHARACTERISATION TEST — Preservation Register A10.
 *
 * Session persistence with client-side expiry, the three-state auth machine, and
 * the invalidate-on-login / remove-on-logout asymmetry.
 *
 * The asymmetry is the security-carrying half. `login()` INVALIDATES the scope
 * query (AdminAuthProvider.tsx:44) and `logout()` REMOVES it (line 50). Swapping
 * them looks like a tidy-up and is not: an invalidate-on-logout leaves the
 * previous admin's resolved grants sitting in the cache of a shared browser tab,
 * where the next sign-in can read them before the refetch lands.
 *
 * CR-2d JOIN (plan D14 (3)): the expiry rule and the asymmetry above are the September
 * console's, and PR 95 (the SMS sign-in) replaced both; the tests that pinned them are retired
 * below by name, each with the PR 95 test that pins the rule that replaced it. A10 is now a
 * `changed` row of the Preservation Register.
 */

const SCOPE_KEY = ['admin', 'me', 'scope', 'org-1'];

function futureSession(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    userId: 'user-1',
    expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
    signedInAtUtc: new Date().toISOString(),
    ...overrides,
  };
}

/** Records every status the provider has published, in render order. */
const seen: string[] = [];
/**
 * Published from an effect rather than assigned during render — writing to
 * module scope during render is a side effect, and the console's own react-hooks
 * lint rules say so.
 */
const captured: { ctx: ReturnType<typeof useAdminAuth> | null } = { ctx: null };

function Probe() {
  const c = useAdminAuth();
  seen.push(c.status);
  useEffect(() => {
    captured.ctx = c;
  });
  return null;
}

afterEach(() => {
  seen.length = 0;
  captured.ctx = null;
  localStorage.clear();
});

describe('authStore persistence (A10)', () => {
  it('persists under exactly admin.session.v1', () => {
    const session = futureSession();
    authStore.set(session);
    expect(JSON.parse(localStorage.getItem('admin.session.v1') ?? 'null')).toEqual(session);
    expect(authStore.get()).toEqual(session);
    expect((authStore.get()?.accessToken ?? null)).toBe('access-token');
  });

  /*
   * RETIRED IN THE CR-2d JOIN (plan D14 (3)), three tests that pinned the September console's
   * rule "the session is over when its ACCESS TOKEN expires, decided in the browser":
   *   - "reads an expired session as null WITHOUT a network round trip"
   *   - "treats an expiry exactly at now as expired"
   *   - "leaves the expired blob in localStorage rather than self-cleaning"
   * PR 95 (the SMS sign-in) replaced that rule and the join keeps it (plan Task 2 Step 1): an
   * expired access token is RENEWED from the refresh cookie, and a sign-in is over only at its
   * sign-in time plus MAX_SESSION_HOURS (12), or when the server refuses it. Pinned by PR 95's own
   * tests (`npm run test:session`):
   *   src/test/lib/auth.test.ts             "how long a sign-in lasts" ("lasts 12 hours", "is over
   *                                         age at sign-in time plus 12 hours exactly"); "whether
   *                                         the access token runs out within a given time"
   *   src/test/lib/api.requests.test.ts     "a data request whose token has a minute or less left"
   *   src/test/lib/sessionRenewal.answers.test.ts "a renewal the server refuses", "a renewal that
   *                                         gets no verdict"
   */

  it('reads corrupt storage as null instead of throwing', () => {
    localStorage.setItem('admin.session.v1', 'not-json');
    expect(authStore.get()).toBeNull();
  });
});

describe('client-side authorization stays out of the auth path (A10 / D15)', () => {
  it('authenticates on expiresAtUtc alone — no JWT claim is inspected', () => {
    // decodeJwt exists (lib/auth.ts:15-23) and is deliberately NOT wired into
    // read(). A token that is not even a JWT still authenticates, because the
    // server is the authority (GET /admin/me/scope).
    authStore.set(futureSession({ accessToken: 'not-a-jwt' }));
    expect((authStore.get()?.accessToken ?? null)).toBe('not-a-jwt');
    expect(decodeJwt('not-a-jwt')).toEqual({});
  });

  it('decodeJwt still decodes a well-formed payload when called directly', () => {
    const payload = btoa(JSON.stringify({ sub: 'user-1' })).replace(/=+$/, '');
    expect(decodeJwt('header.' + payload + '.signature')).toEqual({ sub: 'user-1' });
  });
});

describe('AdminAuthProvider three-state machine (A10)', () => {
  it('starts at loading and settles to anonymous with no stored session', () => {
    // The loading state is what stops a hard refresh flashing the login page at
    // an admin who is in fact signed in (App.tsx:56).
    renderWithProviders(createElement(Probe));

    expect(seen[0]).toBe('loading');
    expect(seen[seen.length - 1]).toBe('anonymous');
    expect(captured.ctx?.session).toBeNull();
  });

  it('starts at loading and settles to authenticated with a live session', () => {
    authStore.set(futureSession());
    renderWithProviders(createElement(Probe));

    expect(seen[0]).toBe('loading');
    expect(seen[seen.length - 1]).toBe('authenticated');
    expect(captured.ctx?.session?.userId).toBe('user-1');
  });

  /*
   * RETIRED IN THE CR-2d JOIN (plan D14 (3)): "settles to anonymous when the stored session has
   * expired" (an expired ACCESS TOKEN meant anonymous, with no request). PR 95's rule: on start
   * the console renews an expired access token from the refresh cookie; it is anonymous only when
   * the server refuses (or the sign-in is over 12 hours old), and "the server could not be
   * reached" when the renewal gets no verdict. Pinned by src/test/lib/sessionRenewal.answers.test.ts
   * ("a renewal the server refuses", "a renewal that gets no verdict") and
   * src/test/lib/sessionRenewal.needs-renewal.test.ts.
   */
});

/*
 * RETIRED IN THE CR-2d JOIN (plan D14 (3)), three tests of the September console's
 * "login invalidates and logout removes — not the other way round (A10)":
 *   - "login() marks the scope query stale but KEEPS the cached entry"
 *   - "logout() REMOVES the scope query so the next user cannot inherit the grants"
 *   - "both operations match the scope key by prefix, whatever org is appended" (and that other
 *     cached surfaces SURVIVE a logout)
 * PR 95 replaced the asymmetry with something stronger, and the join keeps it: there is one
 * shared cache (lib/queryClient.ts), and every end of a session EMPTIES it, scope and every
 * screen's rows alike, before the login page is loaded afresh. Pinned by PR 95's own tests:
 *   src/test/lib/api.signOut.server-answers.test.ts "empties the shared data cache", "a data
 *                                                   request made after the sign-out is done never
 *                                                   reaches the server"
 *   src/test/lib/api.endSession.ended.test.ts       "empties the shared data cache"
 * and, through the console's own Sign out button, by src/app/__tests__/AdminShell.signOutEmpties.test.tsx.
 * The sign-in half has no PR 95 test (its suite does not mount the React provider), so it is
 * pinned here, as the joined console does it.
 */
describe('sign-in empties the shared cache (PR 95, kept by the CR-2d join; A10 changed)', () => {
  it('login() empties the one shared cache, so nobody inherits the grants or rows of the person before', () => {
    renderWithProviders(createElement(Probe));
    sharedQueryClient.setQueryData(SCOPE_KEY, { outcome: 'Resolved' });
    sharedQueryClient.setQueryData(['farms', 'list', 1], { rows: ['a previous admin’s farm'] });

    act(() => captured.ctx?.login(futureSession()));

    expect(sharedQueryClient.getQueryData(SCOPE_KEY)).toBeUndefined();
    expect(sharedQueryClient.getQueryData(['farms', 'list', 1])).toBeUndefined();
    expect(captured.ctx?.status).toBe('authenticated');
    expect(authStore.get()?.userId).toBe('user-1');
  });
});
