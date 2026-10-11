// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
//
// getPresenceSession() — the token-less "a session existed on this device"
// view used ONLY by AuthProvider's 'unreachable' boot branch. It must never
// carry, invent or persist a token.
import { describe, it, expect, beforeEach } from 'vitest';
import {
    getAuthSession,
    getPresenceSession,
    PRESENCE_MAX_AGE_MS,
    setAuthSession,
    clearAuthSession,
} from '../AuthTokenStore';

const KEY = 'agrisync_auth_session_v1';
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

beforeEach(() => {
    window.localStorage.clear();
    clearAuthSession();
});

describe('getPresenceSession', () => {
    it('is null when there is no marker', () => {
        expect(getPresenceSession()).toBeNull();
    });

    it('builds a TOKEN-LESS session from the surviving marker (cold start)', () => {
        const expires = iso(-3 * 60 * 60 * 1000); // access token expired hours ago: normal on a cold start
        window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u-1', expiresAtUtc: expires }));
        const p = getPresenceSession();
        expect(p).toEqual({ userId: 'u-1', accessToken: '', expiresAtUtc: expires });
        // and it is NOT a usable session for the transport
        expect(getAuthSession()).toBeNull();
    });

    it('persists nothing and rewrites nothing', () => {
        const raw = JSON.stringify({ userId: 'u-1', expiresAtUtc: iso(-1000) });
        window.localStorage.setItem(KEY, raw);
        getPresenceSession();
        expect(window.localStorage.getItem(KEY)).toBe(raw);
    });

    it('never exposes a legacy persisted token', () => {
        window.localStorage.setItem(KEY, JSON.stringify({
            userId: 'u-1', accessToken: 'LEGACY-TOKEN', expiresAtUtc: iso(-1000),
        }));
        const p = getPresenceSession();
        expect(p?.accessToken).toBe('');
        expect(JSON.stringify(p)).not.toContain('LEGACY-TOKEN');
    });

    it('is null for an unparseable expiry (fail closed)', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u-1', expiresAtUtc: 'not-a-date' }));
        expect(getPresenceSession()).toBeNull();
    });

    it('is null once the marker is older than the 30-day refresh-credential life', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u-1', expiresAtUtc: iso(-31 * DAY) }));
        expect(getPresenceSession()).toBeNull();
    });

    it('is still present at 29 days', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u-1', expiresAtUtc: iso(-29 * DAY) }));
        expect(getPresenceSession()?.userId).toBe('u-1');
    });

    it('is null for an implausibly far-future expiry (tampered marker)', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u-1', expiresAtUtc: '2099-01-01T00:00:00Z' }));
        expect(getPresenceSession()).toBeNull();
    });

    it('is null after clearAuthSession (logout)', () => {
        setAuthSession({ userId: 'u-1', accessToken: 'tok', expiresAtUtc: iso(15 * 60 * 1000) });
        expect(getPresenceSession()).not.toBeNull();
        clearAuthSession();
        expect(getPresenceSession()).toBeNull();
    });

    it('reflects the LAST signed-in user only (second user overwrites the marker)', () => {
        setAuthSession({ userId: 'user-A', accessToken: 'a', expiresAtUtc: iso(15 * 60 * 1000) });
        setAuthSession({ userId: 'user-B', accessToken: 'b', expiresAtUtc: iso(15 * 60 * 1000) });
        expect(getPresenceSession()?.userId).toBe('user-B');
    });

    it('the age cap equals the server refresh-credential life (30 days)', () => {
        // Server: RefreshTokenHandler.cs:70 / LoginHandler.cs:76 (AddDays(30)).
        // If the server lifetime changes, this bound must change with it.
        expect(PRESENCE_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });
});
