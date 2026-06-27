/**
 * RefreshSessionStore — platform adapter for native secure refresh storage.
 *
 * spec: secure-remembered-device-sessions-2026-06-24
 *
 * WEB NO-OP IMPLEMENTATION. On web, the refresh token is delivered exclusively
 * via an HttpOnly cookie (agrisync_refresh) that JavaScript never reads.
 * These functions are stubs so Phase 6 and Android dispatch (Task 5.2) can
 * import this module without breaking the web build.
 *
 * Android implementation (Task 5.2) will fill in the real Keystore-backed
 * secure storage once the gatekeeper-approved plugin is installed.
 */

export interface NativeRefreshSession {
    refreshToken: string;
    deviceId: string;
    expiresAtUtc: string;
}

/**
 * Returns the stored native refresh session, or null if none exists.
 * Web: always returns null — the cookie is the token and JS never reads it.
 */
export async function getNativeRefreshSession(): Promise<NativeRefreshSession | null> {
    return null;
}

/**
 * Persists a native refresh session in secure storage.
 * Web: no-op — the HttpOnly cookie handles this.
 */
export async function setNativeRefreshSession(_session: NativeRefreshSession): Promise<void> {
    // no-op on web
}

/**
 * Clears the stored native refresh session.
 * Web: no-op — the server clears the cookie on logout.
 */
export async function clearNativeRefreshSession(): Promise<void> {
    // no-op on web
}

/**
 * Returns true if native secure refresh storage is available on this platform.
 * Web: always false (cookie path is used instead).
 */
export function isNativeSecureRefreshEnabled(): boolean {
    return false;
}
