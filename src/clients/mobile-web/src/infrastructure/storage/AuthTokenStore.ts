// spec: secure-remembered-device-sessions-2026-06-24
//
// Security hardening (CodeQL: clear-text storage of sensitive information):
// The SHORT-LIVED access token is NO LONGER persisted to localStorage. It is
// held ONLY in a module-level in-memory variable. localStorage now carries
// just the non-sensitive session-presence marker (userId + expiresAtUtc) so
// the UI can show "a session exists" quickly — but it contains NO token.
//
// How the user stays logged in across a page refresh:
// - On reload, the in-memory access token is empty (module state is gone).
// - AuthProvider's boot-validation effect ALWAYS calls
//   agriSyncClient.refreshSession() on mount. On web that posts
//   /user/auth/refresh with NO body — the HttpOnly `agrisync_refresh` cookie
//   (withCredentials) carries the long-lived token, the server mints a fresh
//   access token, and refreshSession() calls setAuthSession() which repopulates
//   the in-memory token. The 401 interceptor (tryRefreshAndRetry) provides a
//   lazy fallback for the same path.
// - Net effect: the access token is re-minted into memory before authed work
//   resumes, so a refresh does NOT log the user out.
//
// The long-lived refresh token is never stored here (web: HttpOnly cookie;
// Android: Keystore via RefreshSessionStore).

// P0.1 — a session ending is an isolation event, not only an auth event.
// See `endFarmerSession.ts` for what it does and why it hangs off this
// function rather than off the logout button.
import { endFarmerSessionLocally } from './endFarmerSession';
import { clearPendingLogout } from './PendingLogoutStore';
import { clearAllLabourReadouts } from './LabourReadoutCache';
import { clearAllCachedRosters } from './LabourLocalStore';
import { SessionStore } from './SessionStore';

export interface AuthSession {
    userId: string;
    accessToken: string;
    expiresAtUtc: string;
}

const AUTH_SESSION_KEY = 'agrisync_auth_session_v1';
export const AUTH_SESSION_CHANGED_EVENT = 'agrisync:auth-session-changed';

// In-memory ONLY. Never written to localStorage. Reset to null on every page
// load (module re-eval) — refreshSession() on boot repopulates it from the
// HttpOnly cookie.
let inMemoryAccessToken: string | null = null;

function canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function notifyAuthSessionChanged(): void {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

// Non-sensitive session-presence marker. Persisted to localStorage so the UI
// can recognise "a session exists" before the boot refresh completes. Carries
// NO token (neither access nor refresh).
interface SessionPresenceMarker {
    userId: string;
    expiresAtUtc: string;
}

function readPresenceMarker(): SessionPresenceMarker | null {
    if (!canUseStorage()) {
        return null;
    }

    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        // Legacy-token migration (CodeQL hardening): older builds persisted
        // accessToken (and at one point refreshToken) here. If we see either,
        // rewrite the record WITHOUT the token so no clear-text token lingers
        // in a returning user's localStorage.
        if ('accessToken' in parsed || 'refreshToken' in parsed) {
            if (parsed['userId'] && parsed['expiresAtUtc']) {
                const cleaned: SessionPresenceMarker = {
                    userId: String(parsed['userId']),
                    expiresAtUtc: String(parsed['expiresAtUtc']),
                };
                window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(cleaned));
                return cleaned;
            }
            // Token-only / malformed legacy record → purge entirely.
            window.localStorage.removeItem(AUTH_SESSION_KEY);
            return null;
        }

        if (!parsed['userId'] || !parsed['expiresAtUtc']) {
            return null;
        }

        return {
            userId: String(parsed['userId']),
            expiresAtUtc: String(parsed['expiresAtUtc']),
        };
    } catch {
        return null;
    }
}

/**
 * Returns the current session ONLY when a usable access token is present
 * in memory (alongside the persisted presence marker). After a page reload
 * this is null until the boot refresh repopulates the in-memory token — which
 * is why all authed call sites that read `accessToken` from here also gate on
 * the result being non-null.
 */
export function getAuthSession(): AuthSession | null {
    const marker = readPresenceMarker();
    if (!marker) {
        return null;
    }

    // No in-memory access token (e.g. immediately after a page reload, before
    // the boot refresh has run) → not yet usable for authed requests.
    if (!inMemoryAccessToken) {
        return null;
    }

    return {
        userId: marker.userId,
        accessToken: inMemoryAccessToken,
        expiresAtUtc: marker.expiresAtUtc,
    };
}

// The marker's `expiresAtUtc` is the ACCESS token's expiry (15 min), refreshed on
// every refresh — so on a cold start it is almost always already in the past and
// that is NOT evidence the session ended. The real bound is the refresh
// credential (server: 30 days, sliding). We honour the marker for at most the
// FOUNDER-DECIDED 14-day offline reopening window (2026-10-12) past its stamp.
// INVARIANT: the app must never claim presence beyond what it can honestly
// revoke - so this is <= the server refresh life (AddDays(30) in User.Application
// RefreshTokenHandler.cs:70 / LoginHandler.cs:76) and equals the pending-revoke
// slot (RefreshSessionStore) and pending-logout marker (PendingLogoutStore)
// caps. Change all three together; a test pins them equal.
export const PRESENCE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// A genuine marker is never more than one access-token life in the future. A
// far-future value can only be a tampered/corrupt marker — fail closed.
const PRESENCE_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/**
 * TOKEN-LESS "this device had a signed-in user" view, built ONLY from the
 * non-secret presence marker. `accessToken` is ALWAYS '' — nothing is invented,
 * nothing is persisted, and the transport (which sends a Bearer only for a
 * non-empty token) therefore never authenticates with it.
 *
 * Use is restricted to AuthProvider's 'unreachable' boot branch so a relaunch
 * with no signal opens the offline app instead of the login screen. Server
 * authority is untouched: every request is still validated by the JWT, and the
 * first reachable refresh either mints a real session or (judged 4xx) clears
 * this one.
 */
export function getPresenceSession(): AuthSession | null {
    const marker = readPresenceMarker();
    if (!marker) {
        return null;
    }

    const expiresAtMs = Date.parse(marker.expiresAtUtc);
    if (Number.isNaN(expiresAtMs)) {
        return null;
    }

    const now = Date.now();
    if (now - expiresAtMs > PRESENCE_MAX_AGE_MS || expiresAtMs - now > PRESENCE_MAX_FUTURE_MS) {
        return null;
    }

    return {
        userId: marker.userId,
        accessToken: '',
        expiresAtUtc: marker.expiresAtUtc,
    };
}

/**
 * Returns true when a session-presence marker exists in localStorage,
 * regardless of whether the in-memory access token is currently populated.
 * Use this for boot/UX decisions ("did this device have a session?") where
 * the token may not yet have been re-minted. Carries no token.
 */
export function hasSessionPresence(): boolean {
    return readPresenceMarker() !== null;
}

/**
 * The signed-in user's server id, WITHOUT requiring the in-memory access
 * token. Reads the non-sensitive presence marker only — no token is exposed
 * and none is needed.
 *
 * WAVE-1.4 (spec: dfes-companion-2026-07-11): `getAuthSession()` returns null
 * between a page reload and the boot refresh, which would make the approve
 * button's identity resolution flap. This id is used only to populate the
 * wire's `verifierUserId`; server-side authority still comes from the JWT,
 * so a stale marker can never grant anything.
 */
export function getSessionUserId(): string | null {
    return readPresenceMarker()?.userId ?? null;
}

export function setAuthSession(session: AuthSession): void {
    // The access token lives in memory only — never in localStorage.
    inMemoryAccessToken = session.accessToken;

    // A session was just established by a fresh login/refresh: any earlier
    // pending-logout no longer blocks boot (callers settle the revoke first).
    clearPendingLogout();

    if (canUseStorage()) {
        // Persist ONLY the non-sensitive presence marker (no token).
        const marker: SessionPresenceMarker = {
            userId: session.userId,
            expiresAtUtc: session.expiresAtUtc,
        };
        window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(marker));
    }

    notifyAuthSessionChanged();
}

export function clearAuthSession(): void {
    inMemoryAccessToken = null;

    // Whose session is ending, read BEFORE the marker goes. The ambient farmer
    // (activeUserId) is switched a tick after the session, so the farm pointer
    // must be erased for THIS user explicitly, not only for the ambient one.
    const endingUserId = readPresenceMarker()?.userId ?? null;

    if (canUseStorage()) {
        window.localStorage.removeItem(AUTH_SESSION_KEY);
    }

    // P0.1: the handset stops pointing at the outgoing farmer's farm and
    // database in the same breath as it drops their token. Runs BEFORE the
    // change event, so no listener can re-render against the farmer whose
    // session has just ended. Deletes no farmer record.
    endFarmerSessionLocally();
    if (endingUserId) {
        SessionStore.clearCurrentFarmIdForUser(endingUserId);
    }

    // The last-known Labour read-out is per-user offline convenience data; it
    // does not outlive the session that fetched it.
    clearAllLabourReadouts();
    clearAllCachedRosters();

    notifyAuthSessionChanged();
}

export function hasValidAccessToken(bufferMs = 60_000): boolean {
    const session = getAuthSession();
    if (!session) {
        return false;
    }

    const expiresAtMs = Date.parse(session.expiresAtUtc);
    if (Number.isNaN(expiresAtMs)) {
        return false;
    }

    return expiresAtMs - Date.now() > bufferMs;
}
