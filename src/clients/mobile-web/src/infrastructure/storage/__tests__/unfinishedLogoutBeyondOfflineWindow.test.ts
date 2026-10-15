// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
//
// Founder decision 2026-10-12 (round 2): offline REOPENING stays 14 days, but an
// UNFINISHED logout (server revoke still owed) is remembered until the server
// credential is revoked or has expired (30 days). WEB side: the HttpOnly cookie is
// the credential and the non-secret PENDING_LOGOUT marker is the only memory.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError } from 'axios';
import { beginLogout, completePendingLogout } from '../../api/resources/AuthResource';
import { hasPendingLogout } from '../PendingLogoutStore';
import {
    PRESENCE_MAX_AGE_MS, getPresenceSession, setAuthSession, clearAuthSession,
} from '../AuthTokenStore';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-12T08:00:00Z');
const transport = (post: (u: string) => Promise<unknown>) => ({ authHttp: { post } }) as never;

beforeEach(() => {
    window.localStorage.clear();
    clearAuthSession();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('unfinished logout beyond the 14-day offline window (web)', () => {
    it('logged in, then logged out offline; day 15: NOT presented as signed in, marker still holds the revoke owed', async () => {
        setAuthSession({ userId: 'u1', accessToken: 'a', expiresAtUtc: new Date(T0 + 15 * 60_000).toISOString() });
        await beginLogout();
        clearAuthSession();
        vi.setSystemTime(T0 + 15 * DAY);

        expect(getPresenceSession()).toBeNull();
        expect(hasPendingLogout()).toBe(true); // was dropped at 14 days before this fix
    });

    it('a session left open (never logged out) is not presented as signed in after the 14-day window either', () => {
        setAuthSession({ userId: 'u1', accessToken: 'a', expiresAtUtc: new Date(T0 + 15 * 60_000).toISOString() });
        vi.setSystemTime(T0 + 15 * DAY);
        expect(getPresenceSession()).toBeNull();
    });

    it('reconnect at day 20: the revoke is sent (cookie carries the credential) and the marker is cleared', async () => {
        await beginLogout();
        vi.setSystemTime(T0 + 20 * DAY);
        expect(hasPendingLogout()).toBe(true);

        const post = vi.fn().mockResolvedValue({});
        expect(await completePendingLogout(transport(post))).toBe('done');
        expect(post).toHaveBeenCalledWith('/user/auth/logout');
        expect(hasPendingLogout()).toBe(false);
    });

    it('day 29, still offline: marker kept and the revoke is retried later', async () => {
        await beginLogout();
        vi.setSystemTime(T0 + 29 * DAY);
        const offline = vi.fn().mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
        expect(await completePendingLogout(transport(offline))).toBe('retry');
        expect(hasPendingLogout()).toBe(true);
    });

    it('at credential expiry (after 30 days) the marker drops safely and no revoke is attempted', async () => {
        await beginLogout();
        vi.setSystemTime(T0 + 30 * DAY + 1000);
        expect(hasPendingLogout()).toBe(false);
        const post = vi.fn();
        expect(await completePendingLogout(transport(post))).toBe('none');
        expect(post).not.toHaveBeenCalled();
    });

    it('an unreadable marker still fails closed (pending)', () => {
        window.localStorage.setItem('agrisync_pending_logout_v1', '{not json');
        expect(hasPendingLogout()).toBe(true);
    });

    it('the reopening window itself is unchanged at 14 days', () => {
        expect(PRESENCE_MAX_AGE_MS).toBe(14 * DAY);
    });
});
