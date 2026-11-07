// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
//
// getPresenceSession() — the token-less "a session existed on this device"
// view used ONLY by AuthProvider's 'unreachable' boot branch. It must never
// carry, invent or persist a token.
import { describe, it, expect, beforeEach } from 'vitest';
import { onFarmerSessionEnded } from '../endFarmerSession';
import { PENDING_REVOKE_MAX_AGE_MS } from '../RefreshSessionStore';
import { PENDING_LOGOUT_MAX_AGE_MS } from '../PendingLogoutStore';
import { SERVER_REFRESH_LIFETIME_MS } from '../refreshCredentialLife';
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

    it('is null once the marker is older than the 14-day offline reopening window', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u-1', expiresAtUtc: iso(-15 * DAY) }));
        expect(getPresenceSession()).toBeNull();
    });

    it('is still present at 13 days', () => {
        window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u-1', expiresAtUtc: iso(-13 * DAY) }));
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

    it('the offline reopening window is 14 days (founder 2026-10-12) and never exceeds the server refresh life (30 days)', () => {
        // Server: RefreshTokenHandler.cs:70 / LoginHandler.cs:76 (AddDays(30)).
        // The app must never claim presence beyond what it can honestly revoke.
        expect(PRESENCE_MAX_AGE_MS).toBe(14 * 24 * 60 * 60 * 1000);
        expect(PRESENCE_MAX_AGE_MS).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
    });

    it('unfinished-logout protection outlives the 14-day reopening window: it lasts the server refresh life (30 days)', () => {
        // Founder 2026-10-12 round 2: a logout whose server revoke is still owed must be
        // remembered until the credential is revoked OR has expired.
        expect(SERVER_REFRESH_LIFETIME_MS).toBe(30 * DAY);
        expect(PENDING_REVOKE_MAX_AGE_MS).toBe(SERVER_REFRESH_LIFETIME_MS);
        expect(PENDING_LOGOUT_MAX_AGE_MS).toBe(SERVER_REFRESH_LIFETIME_MS);
        expect(PENDING_REVOKE_MAX_AGE_MS).toBeGreaterThan(PRESENCE_MAX_AGE_MS);
        expect(PENDING_LOGOUT_MAX_AGE_MS).toBeGreaterThan(PRESENCE_MAX_AGE_MS);
    });
});

describe('fix round 4 (OPS-1 L2): in-memory per-person state is forgotten when the person changes', () => {
    it('a sign-in as a DIFFERENT user notifies; the same user refreshing does not', () => {
        let forgotten = 0;
        const off = onFarmerSessionEnded(() => { forgotten += 1; });
        setAuthSession({ userId: 'u-1', accessToken: 't', expiresAtUtc: iso(60_000) });
        expect(forgotten).toBe(0); // nobody on record before: nothing to forget
        setAuthSession({ userId: 'u-1', accessToken: 't2', expiresAtUtc: iso(60_000) });
        expect(forgotten).toBe(0); // boot refresh of the same person keeps what is known
        setAuthSession({ userId: 'u-2', accessToken: 't3', expiresAtUtc: iso(60_000) });
        expect(forgotten).toBe(1); // another person on the same handset
        clearAuthSession();
        expect(forgotten).toBe(2); // sign-out
        off();
    });
});
