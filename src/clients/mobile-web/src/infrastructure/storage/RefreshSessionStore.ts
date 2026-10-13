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
import { SERVER_REFRESH_LIFETIME_MS } from './refreshCredentialLife';

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

// ---------------------------------------------------------------------------
// PENDING-REVOKE slot (Android only)
//
// When a farmer logs out we must tell the server to revoke the refresh token,
// but the phone may be offline. Deleting the token first (as before) leaves it
// valid on the server for up to its 30-day life. So the token is MOVED into this
// separate Keystore slot: same protection as the live slot, but
//   - it is never read by refresh/boot (only by the revoke call),
//   - it is deleted the moment the revoke succeeds (or the server judges it),
//   - it is deleted after PENDING_REVOKE_MAX_AGE_MS regardless: the server credential's
//     whole life (30 days from the logout is an upper bound on its remaining life), so it
//     cannot linger past the point it could matter. NOT the 14-day offline reopening
//     window: founder 2026-10-12, protection lasts until revoked or expired.
// Web has no equivalent: the HttpOnly cookie IS the credential and the revoke
// call carries it automatically.
// ---------------------------------------------------------------------------

const PENDING_REVOKE_KEY = 'agrisync_native_pending_revoke_v1';
export const PENDING_REVOKE_MAX_AGE_MS = SERVER_REFRESH_LIFETIME_MS;

export async function stashPendingRevoke(refreshToken: string): Promise<void> {
    if (!isNativeSecureRefreshEnabled()) {
        return;
    }
    await SecureStorage.set(PENDING_REVOKE_KEY, JSON.stringify({
        refreshToken,
        stashedAtUtc: new Date().toISOString(),
    }));
}

export async function getPendingRevoke(): Promise<string | null> {
    if (!isNativeSecureRefreshEnabled()) {
        return null;
    }
    try {
        const raw = await SecureStorage.get(PENDING_REVOKE_KEY);
        if (typeof raw !== 'string') {
            return null;
        }
        const parsed = JSON.parse(raw) as { refreshToken?: string; stashedAtUtc?: string };
        const at = Date.parse(parsed.stashedAtUtc ?? '');
        if (typeof parsed.refreshToken !== 'string' || Number.isNaN(at)
            || Date.now() - at > PENDING_REVOKE_MAX_AGE_MS) {
            await clearPendingRevoke();
            return null;
        }
        return parsed.refreshToken;
    } catch {
        return null;
    }
}

export async function clearPendingRevoke(): Promise<void> {
    if (!isNativeSecureRefreshEnabled()) {
        return;
    }
    try {
        await SecureStorage.remove(PENDING_REVOKE_KEY);
    } catch {
        // key may not exist
    }
}
