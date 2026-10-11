// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves
 *
 * The offline presence session (marker only, empty accessToken) must NEVER be
 * turned into an Authorization header, by either transport, and server-bound
 * calls made while only presence exists must fail cleanly (network error), not
 * pretend to be authenticated.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { agriSyncClient } from '../AgriSyncClient';
import { apiFetch } from '../apiFetch';
import { clearAuthSession, getPresenceSession, setAuthSession } from '../../storage/AuthTokenStore';

vi.mock('../../storage/endFarmerSession', () => ({ endFarmerSessionLocally: vi.fn() }));

const KEY = 'agrisync_auth_session_v1';

function seedPresenceOnly(): void {
    clearAuthSession();
    window.localStorage.setItem(KEY, JSON.stringify({
        userId: 'u-field',
        expiresAtUtc: new Date(Date.now() - 3 * 3600_000).toISOString(),
    }));
    expect(getPresenceSession()).not.toBeNull(); // precondition: presence exists
}

beforeEach(() => {
    window.localStorage.clear();
    clearAuthSession();
});
afterEach(() => vi.unstubAllGlobals());

describe('presence session is never an Authorization header', () => {
    it('axios request interceptor attaches nothing', () => {
        seedPresenceOnly();
        const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
        const out = (agriSyncClient as unknown as {
            attachAccessToken(c: InternalAxiosRequestConfig): InternalAxiosRequestConfig;
        }).attachAccessToken(config);
        expect(out.headers.get('Authorization')).toBeUndefined();
    });

    it('apiFetch sends no Authorization, and an offline call rejects cleanly', async () => {
        seedPresenceOnly();
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        vi.stubGlobal('fetch', fetchMock);

        await expect(apiFetch('/anything', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(TypeError);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
        expect(headers.has('Authorization')).toBe(false);
    });

    it('control: with a REAL in-memory token the header IS attached (the test can fail)', () => {
        setAuthSession({
            userId: 'u-field',
            accessToken: 'tok-real',
            expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
        });
        const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
        const out = (agriSyncClient as unknown as {
            attachAccessToken(c: InternalAxiosRequestConfig): InternalAxiosRequestConfig;
        }).attachAccessToken(config);
        expect(out.headers.get('Authorization')).toBe('Bearer tok-real');
    });
});
