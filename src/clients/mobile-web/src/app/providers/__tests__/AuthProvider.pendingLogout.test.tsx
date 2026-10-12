// @vitest-environment jsdom
/**
 * PENDING LOGOUT - spec: 2026-08-25-prod-cutover-waves
 *
 * REAL AuthProvider + REAL AgriSyncClient + REAL stores. Only the wire is
 * faked (authHttp adapter), and it models the server: a refresh credential that
 * is valid until /user/auth/logout reaches it.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios';

vi.mock('../../../infrastructure/storage/endFarmerSession', () => ({ endFarmerSessionLocally: vi.fn() }));

import { AuthProvider, useAuth } from '../AuthProvider';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { hasPendingLogout } from '../../../infrastructure/storage/PendingLogoutStore';
import { clearAuthSession } from '../../../infrastructure/storage/AuthTokenStore';

type Mode = 'offline' | 'online' | 'server5xx';
const server = {
    mode: 'online' as Mode,
    credentialValid: true,
    currentUser: 'user-A',
    calls: [] as string[],
};

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse {
    return { data, status, statusText: String(status), headers: {}, config };
}

function installFakeServer(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agriSyncClient.authHttp.defaults as any).adapter = async (config: InternalAxiosRequestConfig) => {
        const url = config.url ?? '';
        server.calls.push(url);
        if (server.mode === 'offline') {
            throw new AxiosError('Network Error', 'ERR_NETWORK', config);
        }
        if (server.mode === 'server5xx') {
            throw new AxiosError('boom', 'ERR_BAD_RESPONSE', config, null, reply(config, 503, {}));
        }
        if (url.endsWith('/user/auth/logout')) {
            server.credentialValid = false;
            return reply(config, 200, {});
        }
        if (url.endsWith('/user/auth/refresh')) {
            if (!server.credentialValid) {
                throw new AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, null, reply(config, 401, {}));
            }
            return reply(config, 200, {
                userId: server.currentUser,
                accessToken: 'tok-' + server.currentUser,
                expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString(),
            });
        }
        if (url.endsWith('/user/auth/login')) {
            server.credentialValid = true;
            server.currentUser = 'user-B';
            return reply(config, 200, {
                userId: 'user-B',
                accessToken: 'tok-user-B',
                expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString(),
            });
        }
        throw new Error('unexpected ' + url);
    };
}

const count = (suffix: string) => server.calls.filter(u => u.endsWith(suffix)).length;

let api: ReturnType<typeof useAuth>;
function Probe(): React.ReactElement {
    api = useAuth();
    return <span data-testid="status">{api.authStatus}</span>;
}
const status = () => screen.getByTestId('status').textContent;

async function bootSignedIn() {
    server.mode = 'online';
    const view = render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(status()).toBe('authenticated'));
    return view;
}

beforeEach(() => {
    window.localStorage.clear();
    clearAuthSession();
    server.mode = 'online';
    server.credentialValid = true;
    server.currentUser = 'user-A';
    server.calls = [];
    installFakeServer();
});
afterEach(() => cleanup());

describe('offline logout => pending logout', () => {
    it('offline logout signs out at once and records a non-secret marker', async () => {
        const view = await bootSignedIn();
        server.mode = 'offline';
        await act(async () => { await api.logout(); });

        expect(status()).toBe('anonymous');
        expect(hasPendingLogout()).toBe(true);
        expect(server.credentialValid).toBe(true); // server was not told
        const stored = JSON.stringify(Object.entries(window.localStorage));
        expect(stored).not.toContain('tok-user-A');
        view.unmount();
    });

    it('cold start still OFFLINE after an offline logout => login screen, no refresh attempted', async () => {
        const view = await bootSignedIn();
        server.mode = 'offline';
        await act(async () => { await api.logout(); });
        view.unmount();
        server.calls = [];

        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(status()).toBe('anonymous'));
        expect(count('/user/auth/refresh')).toBe(0);
        expect(hasPendingLogout()).toBe(true);
    });

    it('cold start ONLINE after an offline logout => login screen, revoke called once, credential dead after', async () => {
        const view = await bootSignedIn();
        server.mode = 'offline';
        await act(async () => { await api.logout(); });
        view.unmount();
        server.calls = [];
        server.mode = 'online';

        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(count('/user/auth/logout')).toBe(1));
        expect(status()).toBe('anonymous');
        expect(count('/user/auth/refresh')).toBe(0); // never silently re-signed in
        expect(server.credentialValid).toBe(false);
        await waitFor(() => expect(hasPendingLogout()).toBe(false));

        // and the NEXT boot cannot sign in with the revoked credential
        cleanup();
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(count('/user/auth/refresh')).toBe(1));
        await waitFor(() => expect(status()).toBe('anonymous'));
    });

    it("'online' event after an offline logout performs the revoke exactly once, then stops", async () => {
        await bootSignedIn();
        server.mode = 'offline';
        await act(async () => { await api.logout(); });
        server.calls = [];
        server.mode = 'online';

        await act(async () => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => expect(hasPendingLogout()).toBe(false));
        await act(async () => { window.dispatchEvent(new Event('online')); });
        expect(count('/user/auth/logout')).toBe(1);
        expect(status()).toBe('anonymous');
    });

    it('a failing revoke is retried on each online event and never re-signs in', async () => {
        await bootSignedIn();
        server.mode = 'server5xx';
        await act(async () => { await api.logout(); });
        expect(hasPendingLogout()).toBe(true);
        const afterLogout = count('/user/auth/logout');

        await act(async () => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => expect(count('/user/auth/logout')).toBe(afterLogout + 1));
        expect(hasPendingLogout()).toBe(true);
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => expect(count('/user/auth/logout')).toBe(afterLogout + 2));
        expect(status()).toBe('anonymous');
        expect(count('/user/auth/refresh')).toBe(1); // only the original boot

        server.mode = 'online';
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => expect(hasPendingLogout()).toBe(false));
        expect(server.credentialValid).toBe(false);
    });

    it("user B's login first attempts A's owed revoke, then clears the marker", async () => {
        await bootSignedIn();
        server.mode = 'offline';
        await act(async () => { await api.logout(); });
        server.calls = [];
        server.mode = 'online';

        await act(async () => { await api.login('9999999999', 'pw'); });

        const logoutAt = server.calls.findIndex(u => u.endsWith('/user/auth/logout'));
        const loginAt = server.calls.findIndex(u => u.endsWith('/user/auth/login'));
        expect(logoutAt).toBeGreaterThanOrEqual(0);
        expect(logoutAt).toBeLessThan(loginAt); // A's revoke attempted BEFORE B's login
        expect(hasPendingLogout()).toBe(false);
        expect(status()).toBe('authenticated');
        expect(api.session?.userId).toBe('user-B');
    });

    it("a login that SUCCEEDS while A's revoke keeps failing still signs B in (marker cleared by the successful sign-in)", async () => {
        await bootSignedIn();
        server.mode = 'server5xx';
        await act(async () => { await api.logout(); });
        server.calls = [];
        const original = agriSyncClient.authHttp.defaults.adapter;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (agriSyncClient.authHttp.defaults as any).adapter = async (c: InternalAxiosRequestConfig) => {
            if ((c.url ?? '').endsWith('/user/auth/logout')) {
                server.calls.push(c.url ?? '');
                throw new AxiosError('boom', 'ERR_BAD_RESPONSE', c, null, reply(c, 503, {}));
            }
            server.mode = 'online';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (original as any)(c);
        };
        await act(async () => { await api.login('9999999999', 'pw'); });
        expect(count('/user/auth/logout')).toBe(1);
        expect(api.session?.userId).toBe('user-B');
        expect(hasPendingLogout()).toBe(false); // cleared by the SUCCESSFUL sign-in, not by the attempt
    });

    it('a FAILED offline login attempt keeps the marker; the next ONLINE reload shows login, retries the revoke, and never signs A back in', async () => {
        const view = await bootSignedIn();
        server.mode = 'offline';
        await act(async () => { await api.logout(); });
        expect(hasPendingLogout()).toBe(true);

        // tap Login while still offline: the attempt fails
        await act(async () => { await api.login('9999999999', 'pw').catch(() => undefined); });
        expect(hasPendingLogout()).toBe(true);
        expect(status()).toBe('anonymous');

        // back online, app reloaded
        view.unmount();
        server.calls = [];
        server.mode = 'online';
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(count('/user/auth/logout')).toBe(1));
        expect(status()).toBe('anonymous');
        expect(count('/user/auth/refresh')).toBe(0);
        expect(server.credentialValid).toBe(false);
        await waitFor(() => expect(hasPendingLogout()).toBe(false));
    });

    it('an ordinary ONLINE logout leaves nothing pending and revokes once', async () => {
        await bootSignedIn();
        server.calls = [];
        await act(async () => { await api.logout(); });
        expect(count('/user/auth/logout')).toBe(1);
        expect(hasPendingLogout()).toBe(false);
        expect(server.credentialValid).toBe(false);
    });

    it('refreshSession() itself refuses while a logout is pending (defence in depth for non-boot callers)', async () => {
        await bootSignedIn();
        server.mode = 'offline';
        await act(async () => { await api.logout(); });
        server.mode = 'online';
        server.calls = [];
        const outcome = await agriSyncClient.refreshSession();
        expect(outcome.kind).toBe('rejected');
        expect(count('/user/auth/refresh')).toBe(0);
    });
});
