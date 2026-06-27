/**
 * otpClient — thin fetch wrapper around the Phase 3 User API OTP routes.
 *
 * spec: secure-remembered-device-sessions-2026-06-24
 * - verifyOtp adds credentials: 'include' so the HttpOnly agrisync_refresh
 *   cookie is set by the server on a successful verify.
 * - On WEB: VerifyOtpResponse carries no refreshToken — the cookie IS the token.
 * - On ANDROID native: backend returns refreshToken in the body (no cookie);
 *   verifyOtp detects native via isNativeSecureRefreshEnabled(), sends
 *   X-Client-Platform: android header, and persists the token to the Keystore
 *   via setNativeRefreshSession(). This mirrors AuthResource.persistNativeRefreshTokenIfApplicable.
 * - verifyOtp accepts optional { rememberDevice, deviceId, deviceName, platform }
 *   so the backend can issue the right cookie expiry (session vs persistent).
 *
 * Contracts (backend):
 *   POST /user/auth/start-otp   → { phone }           ⇒ 200 { expiresAtUtc, resendAfterSeconds, provider }
 *                                                       | 400 { error, message } | 429 rate limit
 *   POST /user/auth/verify-otp  → { phone, otp, displayName?, rememberDevice?, deviceId?, platform? }
 *                                ⇒ 200 { userId, accessToken, expiresAtUtc, createdNewUser }
 *                                    + refreshToken (only present on native; absent on web)
 *                                                       | 401 mismatch | 410 expired | 429 locked | 404 no pending
 *
 * Both endpoints are PUBLIC (no bearer) and rate-limited on the server
 * (plan §5.2: 3 OTPs per 15 min, 6 per 24 h, 5 verify attempts per code).
 */

// spec: secure-remembered-device-sessions-2026-06-24 — FIX #3/#4
// These imports enable the native Keystore persist path on Android.
// On web both helpers are no-ops so web behaviour is unchanged.
import { isNativeSecureRefreshEnabled, setNativeRefreshSession } from '../../../infrastructure/storage/RefreshSessionStore';
import { getOrCreateDeviceId } from '../../../infrastructure/storage/DeviceIdStore';

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

export interface StartOtpResponse {
    phoneNumberNormalized: string;
    expiresAtUtc: string;
    resendAfterSeconds: number;
    provider: string;
}

// spec: secure-remembered-device-sessions-2026-06-24
// On WEB: refreshToken is absent — it is delivered via HttpOnly cookie.
// On ANDROID native: refreshToken is present in the body (no cookie on native);
// verifyOtp persists it to the Android Keystore via setNativeRefreshSession.
export interface VerifyOtpResponse {
    userId: string;
    accessToken: string;
    expiresAtUtc: string;
    createdNewUser: boolean;
    /** Only present on Android native responses; absent on web (cookie path). */
    refreshToken?: string;
}

export interface VerifyOtpOptions {
    rememberDevice?: boolean;
    deviceId?: string;
    deviceName?: string;
    platform?: 'web' | 'android' | 'unknown';
}

export interface OtpError {
    error: string;
    message: string;
    status: number;
}

const parseError = async (response: Response): Promise<OtpError> => {
    let payload: { error?: string; message?: string } = {};
    try {
        payload = await response.json();
    } catch {
        /* fall through to generic message */
    }
    return {
        error: payload.error ?? 'otp.unknown',
        message: payload.message ?? `Server returned ${response.status}.`,
        status: response.status,
    };
};

export const startOtp = async (phone: string): Promise<StartOtpResponse> => {
    const response = await fetch(`${resolveBaseUrl()}/user/auth/start-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
    });

    if (!response.ok) {
        throw await parseError(response);
    }

    return (await response.json()) as StartOtpResponse;
};

// spec: secure-remembered-device-sessions-2026-06-24
// credentials: 'include' ensures the HttpOnly refresh cookie is stored
// by the browser when the server sets it in the response.
// rememberDevice defaults to false if not specified.
//
// FIX #3/#4: On Android native, the backend reads X-Client-Platform: android
// and returns refreshToken in the body (instead of setting a cookie which the
// native WebView does not reliably persist). verifyOtp detects the native
// platform, sets the header, and persists the token to the Android Keystore
// via setNativeRefreshSession. Web behaviour is unchanged.
export const verifyOtp = async (
    phone: string,
    otp: string,
    displayName?: string,
    options?: VerifyOtpOptions,
): Promise<VerifyOtpResponse> => {
    const isNative = isNativeSecureRefreshEnabled();

    // On native: override platform to 'android' regardless of what the caller
    // passed (the header is the authoritative signal the backend gates on).
    const effectivePlatform: 'web' | 'android' | 'unknown' = isNative ? 'android' : (options?.platform ?? 'web');

    const body: Record<string, unknown> = {
        phone,
        otp,
        ...(displayName ? { displayName } : {}),
        rememberDevice: options?.rememberDevice ?? false,
        ...(options?.deviceId ? { deviceId: options.deviceId } : {}),
        ...(options?.deviceName ? { deviceName: options.deviceName } : {}),
        platform: effectivePlatform,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // spec: secure-remembered-device-sessions-2026-06-24 — FIX #3
    // The backend's IsNativeClient() checks this header to decide whether to
    // return a refreshToken in the body (native) or set an HttpOnly cookie (web).
    if (isNative) {
        headers['X-Client-Platform'] = 'android';
    }

    const response = await fetch(`${resolveBaseUrl()}/user/auth/verify-otp`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw await parseError(response);
    }

    const res = (await response.json()) as VerifyOtpResponse;

    // spec: secure-remembered-device-sessions-2026-06-24 — FIX #4
    // On Android native: persist the returned refreshToken to the Keystore so
    // AgriSyncClient.refreshSession() can use it on app restart.
    // On web: no-op — the HttpOnly cookie carries the token (JS never reads it).
    if (isNative && res.refreshToken) {
        const deviceId = options?.deviceId ?? getOrCreateDeviceId();
        await setNativeRefreshSession({
            refreshToken: res.refreshToken,
            deviceId,
            expiresAtUtc: res.expiresAtUtc,
        });
    }

    return res;
};

export const isOtpError = (value: unknown): value is OtpError =>
    typeof value === 'object' && value !== null && 'error' in value && 'status' in value;
