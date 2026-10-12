// @vitest-environment jsdom
/**
 * Offline COLD START - spec: 2026-08-25-prod-cutover-waves
 *
 * Unlike AuthProvider.test.tsx (which mocks AuthTokenStore and hands the
 * provider a warm session that cannot exist after a real reload), this file
 * uses the REAL AuthTokenStore + localStorage. Only the network edge
 * (agriSyncClient.refreshSession) is faked, and the fake behaves like the real
 * one: 'refreshed' calls setAuthSession, 'rejected' calls clearAuthSession,
 * 'unreachable' touches nothing.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RefreshOutcome } from '../../../infrastructure/api/transport';

vi.mock('../../../infrastructure/api/AgriSyncClient', () => {
    const spy = vi.fn();
    return {
        agriSyncClient: {
            get refreshSession() { return spy; },
            login: vi.fn(),
            register: vi.fn(),
            beginLogout: vi.fn(() => Promise.resolve()),
            completePendingLogout: vi.fn(() => Promise.resolve("none")),
            _spy: spy,
        },
    };
});
vi.mock('../../../infrastructure/storage/endFarmerSession', () => ({
    endFarmerSessionLocally: vi.fn(),
}));
vi.mock('../../../infrastructure/security/tenantDekClient', () => ({ clearCachedDek: vi.fn() }));
vi.mock('../../../infrastructure/consent/ConsentTokenClient', () => ({ clearCachedConsentToken: vi.fn() }));
vi.mock('../../../infrastructure/storage/RememberDeviceStore', () => ({
    getRememberDevice: vi.fn(() => false),
    setRememberDevice: vi.fn(),
    clearRememberDevice: vi.fn(),
}));
vi.mock('../../../infrastructure/storage/RefreshSessionStore', () => ({
    clearNativeRefreshSession: vi.fn(() => Promise.resolve()),
}));

import { AuthProvider, useAuth } from '../AuthProvider';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import {
    getAuthSession,
    getPresenceSession,
    setAuthSession,
    clearAuthSession,
} from '../../../infrastructure/storage/AuthTokenStore';

const KEY = 'agrisync_auth_session_v1';
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function spy(): ReturnType<typeof vi.fn> {
    return (agriSyncClient as unknown as { _spy: ReturnType<typeof vi.fn> })._spy;
}

/** A cold start: the marker is on disk, the module's in-memory token is empty. */
function coldStartWithMarker(userId = 'u-field', expiresOffsetMs = -3 * 60 * 60 * 1000): void {
    clearAuthSession();
    window.localStorage.setItem(KEY, JSON.stringify({ userId, expiresAtUtc: iso(expiresOffsetMs) }));
}

const refreshedOutcome = (userId = 'u-field', token = 'tok-real'): RefreshOutcome => {
    const session = { userId, accessToken: token, expiresAtUtc: iso(15 * 60 * 1000) };
    setAuthSession(session); // the real client does this before returning
    return { kind: 'refreshed', session };
};

function Probe(): React.ReactElement {
    const a = useAuth();
    return (
        <div>
            <span data-testid="status">{a.authStatus}</span>
            <span data-testid="token">{a.session ? (a.session.accessToken === '' ? '<empty>' : a.session.accessToken) : '<none>'}</span>
            <span data-testid="user">{a.session?.userId ?? '<none>'}</span>
            <span data-testid="offline">{a.isOfflinePresence ? 'yes' : 'no'}</span>
            <button data-testid="logout" onClick={() => void a.logout()} />
        </div>
    );
}

function Shell(): React.ReactElement {
    const { authStatus, isAuthenticated } = useAuth();
    if (authStatus === 'checking') return <div data-testid="splash" />;
    return isAuthenticated ? <div data-testid="app-content" /> : <div data-testid="login-page" />;
}

const status = () => screen.getByTestId('status').textContent;

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    clearAuthSession();
    spy().mockReset();
});
afterEach(() => cleanup());

describe('AuthProvider - offline cold start (real AuthTokenStore)', () => {
    it('marker present + unreachable => authenticated offline, nothing cleared, no token', async () => {
        coldStartWithMarker();
        expect(getAuthSession()).toBeNull(); // precondition: truly cold
        spy().mockResolvedValueOnce({ kind: 'unreachable' });

        render(<AuthProvider><Probe /></AuthProvider>);

        await waitFor(() => expect(status()).toBe('authenticated'));
        expect(screen.getByTestId('user').textContent).toBe('u-field');
        expect(screen.getByTestId('token').textContent).toBe('<empty>');
        expect(screen.getByTestId('offline').textContent).toBe('yes');
        expect(JSON.parse(window.localStorage.getItem(KEY)!).userId).toBe('u-field');
        // and it is still not a usable transport session
        expect(getAuthSession()).toBeNull();
    });

    it('renders the app shell, not the login page', async () => {
        coldStartWithMarker();
        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        render(<AuthProvider><Shell /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument());
        expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    });

    it('marker present + rejected (401) => cleared + login', async () => {
        coldStartWithMarker();
        spy().mockImplementationOnce(async () => { clearAuthSession(); return { kind: 'rejected' }; });
        render(<AuthProvider><Shell /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
        expect(window.localStorage.getItem(KEY)).toBeNull();
        expect(getPresenceSession()).toBeNull();
    });

    it('no marker + unreachable => anonymous exactly as before', async () => {
        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(status()).toBe('anonymous'));
        expect(screen.getByTestId('offline').textContent).toBe('no');
    });

    it('marker older than the 14-day offline reopening window + unreachable => anonymous', async () => {
        coldStartWithMarker('u-field', -15 * DAY);
        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(status()).toBe('anonymous'));
    });

    it('an access-token expiry weeks in the past is still honoured (that is the normal cold start)', async () => {
        coldStartWithMarker('u-field', -10 * DAY);
        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(status()).toBe('authenticated'));
    });

    it('logout clears the marker; the next offline cold start is anonymous', async () => {
        coldStartWithMarker();
        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        const first = render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(status()).toBe('authenticated'));
        await act(async () => { screen.getByTestId('logout').click(); });
        await waitFor(() => expect(status()).toBe('anonymous'));
        expect(window.localStorage.getItem(KEY)).toBeNull();
        first.unmount();

        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(status()).toBe('anonymous'));
    });

    it('a second user overwrites the marker; a cold start presents only that user', async () => {
        setAuthSession({ userId: 'user-A', accessToken: 'a', expiresAtUtc: iso(60_000) });
        setAuthSession({ userId: 'user-B', accessToken: 'b', expiresAtUtc: iso(60_000) });
        // simulate reload: drop only the in-memory token, keep the marker
        const raw = window.localStorage.getItem(KEY)!;
        clearAuthSession();
        window.localStorage.setItem(KEY, raw);
        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(status()).toBe('authenticated'));
        expect(screen.getByTestId('user').textContent).toBe('user-B');
    });

    it("'online' after an offline cold start re-runs refresh and establishes a REAL session", async () => {
        coldStartWithMarker();
        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('offline').textContent).toBe('yes'));
        expect(spy()).toHaveBeenCalledTimes(1);

        spy().mockImplementationOnce(async () => refreshedOutcome());
        await act(async () => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(screen.getByTestId('token').textContent).toBe('tok-real'));
        expect(spy()).toHaveBeenCalledTimes(2);
        expect(status()).toBe('authenticated');
        expect(screen.getByTestId('offline').textContent).toBe('no');
        expect(getAuthSession()?.accessToken).toBe('tok-real');
    });

    it('a server-side revoked user is cleared on the first ONLINE refresh', async () => {
        coldStartWithMarker();
        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        render(<AuthProvider><Shell /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument());

        spy().mockImplementationOnce(async () => { clearAuthSession(); return { kind: 'rejected' }; });
        await act(async () => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
        expect(window.localStorage.getItem(KEY)).toBeNull();
    });

    it("still unreachable on 'online' keeps the offline presence and clears nothing", async () => {
        coldStartWithMarker();
        spy().mockResolvedValue({ kind: 'unreachable' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('offline').textContent).toBe('yes'));
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => expect(spy()).toHaveBeenCalledTimes(2));
        expect(status()).toBe('authenticated');
        expect(window.localStorage.getItem(KEY)).not.toBeNull();
    });

    describe('sync-tick recovery (no online/visibilitychange event)', () => {
        afterEach(() => { vi.useRealTimers(); });

        it('re-runs refresh on a 15 s tick while in presence mode and establishes a REAL session', async () => {
            coldStartWithMarker();
            spy().mockResolvedValueOnce({ kind: 'unreachable' });
            render(<AuthProvider><Probe /></AuthProvider>);
            await waitFor(() => expect(screen.getByTestId('offline').textContent).toBe('yes'));
            expect(spy()).toHaveBeenCalledTimes(1);

            vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
            // re-arm under fake timers: toggle presence off/on is not possible, so
            // unmount + remount under fake timers instead.
            cleanup();
            coldStartWithMarker();
            spy().mockReset();
            spy().mockResolvedValueOnce({ kind: 'unreachable' });
            render(<AuthProvider><Probe /></AuthProvider>);
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });
            expect(screen.getByTestId('offline').textContent).toBe('yes');
            const before = spy().mock.calls.length;

            spy().mockImplementationOnce(async () => refreshedOutcome());
            await act(async () => { vi.advanceTimersByTime(15_000); });
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });

            expect(spy().mock.calls.length).toBe(before + 1);
            expect(screen.getByTestId('token').textContent).toBe('tok-real');
            expect(screen.getByTestId('offline').textContent).toBe('no');
        });

        it('a tick that is still unreachable clears nothing, and stops ticking once a normal session exists', async () => {
            vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
            coldStartWithMarker();
            spy().mockResolvedValue({ kind: 'unreachable' });
            render(<AuthProvider><Probe /></AuthProvider>);
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });
            const base = spy().mock.calls.length;

            await act(async () => { vi.advanceTimersByTime(15_000); });
            expect(spy().mock.calls.length).toBe(base + 1);
            expect(status()).toBe('authenticated');
            expect(window.localStorage.getItem(KEY)).not.toBeNull();

            spy().mockImplementationOnce(async () => refreshedOutcome());
            await act(async () => { vi.advanceTimersByTime(15_000); });
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });
            const afterReal = spy().mock.calls.length;
            await act(async () => { vi.advanceTimersByTime(60_000); });
            expect(spy().mock.calls.length).toBe(afterReal);
        });

        it('does not tick when there is no offline presence', async () => {
            vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
            spy().mockResolvedValue({ kind: 'unreachable' });
            render(<AuthProvider><Probe /></AuthProvider>);
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });
            const base = spy().mock.calls.length;
            await act(async () => { vi.advanceTimersByTime(60_000); });
            expect(spy().mock.calls.length).toBe(base);
        });
    });

    it("'online' does NOT trigger a refresh when there is no offline presence", async () => {
        spy().mockResolvedValueOnce({ kind: 'unreachable' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(status()).toBe('anonymous'));
        await act(async () => { window.dispatchEvent(new Event('online')); });
        expect(spy()).toHaveBeenCalledTimes(1);
    });

    describe('storage / auth-changed events in a presence tab', () => {
        async function presenceTab(userId = 'u-field') {
            coldStartWithMarker(userId);
            spy().mockResolvedValue({ kind: 'unreachable' });
            render(<AuthProvider><Probe /></AuthProvider>);
            await waitFor(() => expect(screen.getByTestId('offline').textContent).toBe('yes'));
        }

        it('keeps the presence session when a storage event fires and the same-user marker survives', async () => {
            await presenceTab();
            await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); });
            expect(status()).toBe('authenticated');
            expect(screen.getByTestId('offline').textContent).toBe('yes');
            await act(async () => { window.dispatchEvent(new Event('agrisync:auth-session-changed')); });
            expect(status()).toBe('authenticated');
        });

        it('fails closed when the marker is gone', async () => {
            await presenceTab();
            window.localStorage.removeItem(KEY);
            await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); });
            expect(status()).toBe('anonymous');
        });

        it("fails closed when another user's marker appears", async () => {
            await presenceTab('user-A');
            window.localStorage.setItem(KEY, JSON.stringify({ userId: 'user-B', expiresAtUtc: iso(60_000) }));
            await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); });
            expect(status()).toBe('anonymous');
        });

        it('fails closed when the marker is no longer valid under the age rule', async () => {
            await presenceTab();
            window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u-field', expiresAtUtc: iso(-15 * DAY) }));
            await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); });
            expect(status()).toBe('anonymous');
        });

        it('an anonymous tab is NOT promoted to presence by a storage event', async () => {
            spy().mockResolvedValue({ kind: 'unreachable' });
            render(<AuthProvider><Probe /></AuthProvider>);
            await waitFor(() => expect(status()).toBe('anonymous'));
            window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u-field', expiresAtUtc: iso(60_000) }));
            await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); });
            expect(status()).toBe('anonymous');
        });
    });
});
