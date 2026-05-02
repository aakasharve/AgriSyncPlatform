export interface AuthSession {
    userId: string;
    accessToken: string;
    refreshToken: string;
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
        const parsed = JSON.parse(raw) as Partial<AuthSession>;
        if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAtUtc || !parsed.userId) {
            return null;
        }

        return {
            userId: parsed.userId,
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            expiresAtUtc: parsed.expiresAtUtc,
        };
    } catch {
        return null;
    }
}

export function setAuthSession(session: AuthSession): void {
    if (!canUseStorage()) {
        return;
    }

    window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
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
