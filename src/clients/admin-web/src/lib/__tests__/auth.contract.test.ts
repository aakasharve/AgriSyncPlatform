import { createElement, useEffect } from 'react';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { authStore, decodeJwt, type AdminSession } from '@/lib/auth';
import { useAdminAuth } from '@/app/AdminAuthProvider';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';

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
 */

const SCOPE_KEY = ['admin', 'me', 'scope', 'org-1'];

function futureSession(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    userId: 'user-1',
    expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
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

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
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
    expect(authStore.getAccessToken()).toBe('access-token');
  });

  it('reads an expired session as null WITHOUT a network round trip', () => {
    // lib/auth.ts:30. Expiry is decided client-side from expiresAtUtc, so a
    // stale tab knows it is signed out before it asks anyone.
    stub = installAdapter(async () => ({ status: 200, data: {} }));
    localStorage.setItem(
      'admin.session.v1',
      JSON.stringify(futureSession({ expiresAtUtc: new Date(Date.now() - 1_000).toISOString() })),
    );

    expect(authStore.get()).toBeNull();
    expect(authStore.getAccessToken()).toBeNull();
    expect(stub.requests).toHaveLength(0);
  });

  it('treats an expiry exactly at now as expired', () => {
    // `<=` at lib/auth.ts:30, not `<`.
    const now = Date.now();
    localStorage.setItem(
      'admin.session.v1',
      JSON.stringify(futureSession({ expiresAtUtc: new Date(now).toISOString() })),
    );
    expect(authStore.get()).toBeNull();
  });

  it('leaves the expired blob in localStorage rather than self-cleaning', () => {
    // Current behaviour, recorded as-is: read() returns null but does not
    // remove. Only an explicit clear() (logout, or the 401 interceptor) removes
    // the key.
    const expired = futureSession({ expiresAtUtc: new Date(Date.now() - 1_000).toISOString() });
    localStorage.setItem('admin.session.v1', JSON.stringify(expired));

    expect(authStore.get()).toBeNull();
    expect(localStorage.getItem('admin.session.v1')).not.toBeNull();

    authStore.clear();
    expect(localStorage.getItem('admin.session.v1')).toBeNull();
  });

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
    expect(authStore.getAccessToken()).toBe('not-a-jwt');
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

  it('settles to anonymous when the stored session has expired', () => {
    stub = installAdapter(async () => ({ status: 200, data: {} }));
    localStorage.setItem(
      'admin.session.v1',
      JSON.stringify(futureSession({ expiresAtUtc: new Date(Date.now() - 1_000).toISOString() })),
    );

    renderWithProviders(createElement(Probe));

    expect(seen[seen.length - 1]).toBe('anonymous');
    expect(stub.requests).toHaveLength(0);
  });
});

describe('login invalidates and logout removes — not the other way round (A10)', () => {
  it('login() marks the scope query stale but KEEPS the cached entry', () => {
    const queryClient = makeTestQueryClient();
    renderWithProviders(createElement(Probe), { queryClient });
    queryClient.setQueryData(SCOPE_KEY, { outcome: 'Resolved' });

    act(() => captured.ctx?.login(futureSession()));

    expect(queryClient.getQueryData(SCOPE_KEY)).toEqual({ outcome: 'Resolved' });
    expect(queryClient.getQueryState(SCOPE_KEY)?.isInvalidated).toBe(true);
    expect(captured.ctx?.status).toBe('authenticated');
    expect(authStore.get()?.userId).toBe('user-1');
  });

  it('logout() REMOVES the scope query so the next user cannot inherit the grants', () => {
    const queryClient = makeTestQueryClient();
    renderWithProviders(createElement(Probe), { queryClient });
    queryClient.setQueryData(SCOPE_KEY, { outcome: 'Resolved' });

    act(() => captured.ctx?.logout());

    expect(queryClient.getQueryData(SCOPE_KEY)).toBeUndefined();
    expect(queryClient.getQueryCache().find({ queryKey: SCOPE_KEY })).toBeUndefined();
    expect(captured.ctx?.status).toBe('anonymous');
    expect(captured.ctx?.session).toBeNull();
    expect(localStorage.getItem('admin.session.v1')).toBeNull();
  });

  it('both operations match the scope key by prefix, whatever org is appended', () => {
    const queryClient = makeTestQueryClient();
    renderWithProviders(createElement(Probe), { queryClient });
    queryClient.setQueryData(['admin', 'me', 'scope', 'none'], { outcome: 'Ambiguous' });
    queryClient.setQueryData(['admin', 'me', 'scope', 'org-2'], { outcome: 'Resolved' });
    queryClient.setQueryData(['ops', 'health'], { untouched: true });

    act(() => captured.ctx?.logout());

    expect(queryClient.getQueryData(['admin', 'me', 'scope', 'none'])).toBeUndefined();
    expect(queryClient.getQueryData(['admin', 'me', 'scope', 'org-2'])).toBeUndefined();
    // Only the scope key is swept — other cached surfaces survive a logout.
    expect(queryClient.getQueryData(['ops', 'health'])).toEqual({ untouched: true });
  });
});
