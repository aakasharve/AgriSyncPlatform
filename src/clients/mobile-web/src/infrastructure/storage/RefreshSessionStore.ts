/**
 * RefreshSessionStore — platform adapter for native secure refresh storage.
 *
 * spec: secure-remembered-device-sessions-2026-06-24
 *
 * Platform strategy:
 *   - WEB: All four functions are no-ops. The refresh token is delivered
 *     exclusively via an HttpOnly cookie (agrisync_refresh) that JavaScript
 *     never reads. No token is ever written to localStorage on web.
 *   - ANDROID: Uses @aparajita/capacitor-secure-storage (Android Keystore
 *     backed) to persist the NativeRefreshSession JSON under the key
 *     STORAGE_KEY. The cookie path is NOT used on native.
 *
 * Storage key: agrisync_native_refresh_v1
 *
 * The web branch is guarded by isNativeSecureRefreshEnabled() which returns
 * false on web and true only when running natively on Android. This keeps the
 * web build completely unaffected by this module.
 */

import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

export interface NativeRefreshSession {
    refreshToken: string;
    deviceId: string;
    expiresAtUtc: string;
}

const STORAGE_KEY = 'agrisync_native_refresh_v1';

/**
 * Returns true if native secure refresh storage is available on this platform.
 * Web: always false (cookie path is used instead).
 * Android: true (Android Keystore backed via @aparajita/capacitor-secure-storage).
 */
export function isNativeSecureRefreshEnabled(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * Returns the stored native refresh session, or null if none exists.
 * Web: always returns null — the HttpOnly cookie is the token and JS never reads it.
 * Android: reads from the Android Keystore via the secure storage plugin.
 */
export async function getNativeRefreshSession(): Promise<NativeRefreshSession | null> {
    if (!isNativeSecureRefreshEnabled()) {
        return null;
    }

    try {
        const raw = await SecureStorage.get(STORAGE_KEY);
        if (raw === null || raw === undefined) {
            return null;
        }
        // The plugin may return the stored value as a string or already-parsed object.
        // DataType includes Record<string, unknown>, so handle both cases.
        if (typeof raw === 'string') {
            const parsed = JSON.parse(raw) as NativeRefreshSession;
            if (parsed && typeof parsed.refreshToken === 'string' && typeof parsed.deviceId === 'string') {
                return parsed;
            }
            return null;
        }
        // Object path — validate shape
        const obj = raw as Record<string, unknown>;
        if (typeof obj.refreshToken === 'string' && typeof obj.deviceId === 'string' && typeof obj.expiresAtUtc === 'string') {
            return obj as unknown as NativeRefreshSession;
        }
        return null;
    } catch {
        // Treat any Keystore error as "no session" — fail-closed.
        return null;
    }
}

/**
 * Persists a native refresh session in secure storage.
 * Web: no-op — the HttpOnly cookie handles this.
 * Android: serialises to JSON and stores in the Android Keystore.
 */
export async function setNativeRefreshSession(session: NativeRefreshSession): Promise<void> {
    if (!isNativeSecureRefreshEnabled()) {
        return;
    }

    const json = JSON.stringify(session);
    await SecureStorage.set(STORAGE_KEY, json);
}

/**
 * Clears the stored native refresh session.
 * Web: no-op — the server clears the cookie on logout.
 * Android: removes the Keystore entry.
 */
export async function clearNativeRefreshSession(): Promise<void> {
    if (!isNativeSecureRefreshEnabled()) {
        return;
    }

    try {
        await SecureStorage.remove(STORAGE_KEY);
    } catch {
        // Ignore — key may not exist; either way the session is gone.
    }
}
