// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves - Android pending-revoke slot.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError } from 'axios';

const slots = new Map<string, string>();
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));
vi.mock('@aparajita/capacitor-secure-storage', () => ({
    SecureStorage: {
        get: async (k: string) => slots.get(k) ?? null,
        set: async (k: string, v: string) => { slots.set(k, v); },
        remove: async (k: string) => { slots.delete(k); },
    },
}));

import { beginLogout, completePendingLogout } from '../resources/AuthResource';
import { hasPendingLogout } from '../../storage/PendingLogoutStore';
import { getNativeRefreshSession, setNativeRefreshSession, getPendingRevoke, PENDING_REVOKE_MAX_AGE_MS } from '../../storage/RefreshSessionStore';

const LIVE = 'agrisync_native_refresh_v1';
const PENDING = 'agrisync_native_pending_revoke_v1';

function transport(post: (url: string, body?: unknown) => Promise<unknown>) {
    return { authHttp: { post } } as never;
}

beforeEach(async () => {
    slots.clear();
    window.localStorage.clear();
    await setNativeRefreshSession({ refreshToken: 'RT-SECRET', deviceId: 'd', expiresAtUtc: '2099-01-01T00:00:00Z' });
});

describe('Android pending-revoke slot', () => {
    it('beginLogout MOVES a copy into the pending slot and marks pending; the live slot is untouched until the caller clears it', async () => {
        await beginLogout();
        expect(hasPendingLogout()).toBe(true);
        expect(await getPendingRevoke()).toBe('RT-SECRET');
        expect((await getNativeRefreshSession())?.refreshToken).toBe('RT-SECRET');
    });

    it('the token is never written to localStorage', async () => {
        await beginLogout();
        expect(JSON.stringify(Object.entries(window.localStorage))).not.toContain('RT-SECRET');
    });

    it('revoke success sends the slot token, then deletes slot and marker', async () => {
        await beginLogout();
        const post = vi.fn().mockResolvedValue({});
        expect(await completePendingLogout(transport(post))).toBe('done');
        expect(post).toHaveBeenCalledWith('/user/auth/logout', { refreshToken: 'RT-SECRET' });
        expect(slots.has(PENDING)).toBe(false);
        expect(hasPendingLogout()).toBe(false);
    });

    it('transport failure keeps slot + marker (retry); a later success clears them', async () => {
        await beginLogout();
        const offline = vi.fn().mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
        expect(await completePendingLogout(transport(offline))).toBe('retry');
        expect(slots.has(PENDING)).toBe(true);
        expect(hasPendingLogout()).toBe(true);
        expect(await completePendingLogout(transport(vi.fn().mockResolvedValue({})))).toBe('done');
        expect(slots.has(PENDING)).toBe(false);
    });

    it('a token older than the 14-day cap is deleted and never sent', async () => {
        slots.set(PENDING, JSON.stringify({
            refreshToken: 'RT-OLD',
            stashedAtUtc: new Date(Date.now() - PENDING_REVOKE_MAX_AGE_MS - 1000).toISOString(),
        }));
        expect(await getPendingRevoke()).toBeNull();
        expect(slots.has(PENDING)).toBe(false);
    });

    it('with the slot present but the marker cleared (user B signed in), the revoke is still retried', async () => {
        await beginLogout();
        window.localStorage.clear(); // marker dropped by a new login
        const post = vi.fn().mockResolvedValue({});
        expect(await completePendingLogout(transport(post))).toBe('done');
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('nothing pending => no network call', async () => {
        const post = vi.fn();
        expect(await completePendingLogout(transport(post))).toBe('none');
        expect(post).not.toHaveBeenCalled();
        void LIVE;
    });
});
