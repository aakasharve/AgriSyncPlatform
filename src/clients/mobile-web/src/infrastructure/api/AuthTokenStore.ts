export interface AuthSession {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAtUtc: string;
}

const AUTH_SESSION_KEY = 'agrisync_auth_session_v1';

function canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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
}

export function clearAuthSession(): void {
    if (!canUseStorage()) {
        return;
    }

    window.localStorage.removeItem(AUTH_SESSION_KEY);
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
