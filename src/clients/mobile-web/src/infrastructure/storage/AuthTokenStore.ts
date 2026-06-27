export interface AuthSession {
    userId: string;
    accessToken: string;
    expiresAtUtc: string;
}

const AUTH_SESSION_KEY = 'agrisync_auth_session_v1';
export const AUTH_SESSION_CHANGED_EVENT = 'agrisync:auth-session-changed';

function canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function notifyAuthSessionChanged(): void {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

export function getAuthSession(): AuthSession | null {
    if (!canUseStorage()) {
        return null;
    }

    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // Legacy sessions that only contain refreshToken (no accessToken) are treated as null.
        // refreshToken is intentionally ignored — it is never stored in this version.
        if (!parsed['accessToken'] || !parsed['expiresAtUtc'] || !parsed['userId']) {
            return null;
        }

        return {
            userId: String(parsed['userId']),
            accessToken: String(parsed['accessToken']),
            expiresAtUtc: String(parsed['expiresAtUtc']),
        };
    } catch {
        return null;
    }
}

export function setAuthSession(session: AuthSession): void {
    if (!canUseStorage()) {
        return;
    }

    // Only the three required fields are persisted — refreshToken is never written.
    const toStore: AuthSession = {
        userId: session.userId,
        accessToken: session.accessToken,
        expiresAtUtc: session.expiresAtUtc,
    };

    window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(toStore));
    notifyAuthSessionChanged();
}

export function clearAuthSession(): void {
    if (!canUseStorage()) {
        return;
    }

    window.localStorage.removeItem(AUTH_SESSION_KEY);
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
