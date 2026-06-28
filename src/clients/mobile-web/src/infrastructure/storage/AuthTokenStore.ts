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

/**
 * Returns true when a session-presence marker exists in localStorage,
 * regardless of whether the in-memory access token is currently populated.
 * Use this for boot/UX decisions ("did this device have a session?") where
 * the token may not yet have been re-minted. Carries no token.
 */
export function hasSessionPresence(): boolean {
    return readPresenceMarker() !== null;
}

export function setAuthSession(session: AuthSession): void {
    // The access token lives in memory only — never in localStorage.
    inMemoryAccessToken = session.accessToken;

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

    if (canUseStorage()) {
        window.localStorage.removeItem(AUTH_SESSION_KEY);
    }

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
