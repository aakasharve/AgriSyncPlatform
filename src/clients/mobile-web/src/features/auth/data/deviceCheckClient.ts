/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85).
 *
 * The answer to "हे खातं ‹नाव› यांचं आहे — तुम्ही तेच आहात का?":
 *   POST /user/auth/device-check  { answer: 'yes' | 'no', refreshToken? }
 *     yes → 200 { outcome: 'confirmed', userId, accessToken, expiresAtUtc }  (the phone is known from now on)
 *     no  → 200 { outcome: 'declined' }                                      (this phone's sign-in ended)
 *     401 → no open question on this credential (expired / signed out)
 *
 * The SESSION is named by the refresh credential, exactly as /user/auth/refresh: on the web the HttpOnly cookie
 * (credentials: 'include'), on Android the Keystore token in the body with `X-Client-Platform: android`. The held
 * access token is never sent — it opens nothing anyway. A thin fetch wrapper like `otpClient`, because AgriSyncClient's
 * interceptors assume a session that opens the account.
 */
import {
    clearNativeRefreshSession,
    getNativeRefreshSession,
    isNativeSecureRefreshEnabled,
} from '../../../infrastructure/storage/RefreshSessionStore';
import type { AuthSession } from '../../../infrastructure/storage/AuthTokenStore';

interface ViteImportMeta {
    env?: {
        VITE_AGRISYNC_API_URL?: unknown;
    };
}

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().replace(/\/+$/, '');
    }
    return 'http://localhost:5048';
};

export type DeviceCheckAnswer = 'yes' | 'no';

export type DeviceCheckOutcome =
    /** होय accepted: this session opens the account. */
    | { kind: 'confirmed'; session: AuthSession }
    /** नाही accepted: the phone's sign-in ended and its credential is gone. */
    | { kind: 'declined' }
    /** The server has no open question on this phone's credential (it expired or was signed out): sign in again. */
    | { kind: 'expired' }
    /** The answer did not reach a server that judged it (no signal, 5xx, a captive portal): ask again. */
    | { kind: 'unreachable' };

export async function answerDeviceCheck(answer: DeviceCheckAnswer): Promise<DeviceCheckOutcome> {
    const isNative = isNativeSecureRefreshEnabled();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const body: Record<string, unknown> = { answer };
    if (isNative) {
        headers['X-Client-Platform'] = 'android';
        const stored = await getNativeRefreshSession();
        if (!stored) return { kind: 'expired' };
        body.refreshToken = stored.refreshToken;
    }

    let response: Response;
    try {
        response = await fetch(`${resolveBaseUrl()}/user/auth/device-check`, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify(body),
        });
    } catch {
        return { kind: 'unreachable' };
    }

    if (response.status === 401) {
        await clearNativeRefreshSession();
        return { kind: 'expired' };
    }
    if (!response.ok) return { kind: 'unreachable' };

    let payload: { outcome?: unknown; userId?: unknown; accessToken?: unknown; expiresAtUtc?: unknown };
    try {
        payload = await response.json();
    } catch {
        return { kind: 'unreachable' };
    }

    if (payload.outcome === 'declined') {
        // The server ended this session; nothing on this phone may still carry it.
        await clearNativeRefreshSession();
        return { kind: 'declined' };
    }
    if (payload.outcome === 'confirmed'
        && typeof payload.userId === 'string'
        && typeof payload.accessToken === 'string' && payload.accessToken.length > 0
        && typeof payload.expiresAtUtc === 'string') {
        return {
            kind: 'confirmed',
            session: { userId: payload.userId, accessToken: payload.accessToken, expiresAtUtc: payload.expiresAtUtc },
        };
    }
    // A 200 that is not our answer (a captive portal): nothing was judged.
    return { kind: 'unreachable' };
}
