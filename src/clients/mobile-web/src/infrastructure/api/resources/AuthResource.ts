// Sub-plan 04 Task 9: AgriSyncClient decomposition — auth + identity.
// spec: secure-remembered-device-sessions-2026-06-24
// Auth calls are now side-effect-free — they return AuthResponseDto and let
// the caller (AuthProvider or AgriSyncClient.refreshSession) own session state.
// No setAuthSession calls here; session management is centralised in AuthProvider.
//
// Native (Android) post-login side-effect:
// When isNativeSecureRefreshEnabled() is true, the backend returns a
// refreshToken in the JSON body (instead of an HttpOnly cookie). We persist
// it to the Android Keystore immediately after login/register so the app can
// survive being killed and re-opened without re-authenticating.
// The web path is UNCHANGED — no token is ever touched on web.

import type { AuthResponseDto, LoginRequest } from '../dtos';
import { type HttpTransport } from '../transport';
import { getOrCreateDeviceId } from '../../storage/DeviceIdStore';
import {
    isNativeSecureRefreshEnabled,
    setNativeRefreshSession,
    getNativeRefreshSession,
    clearNativeRefreshSession,
} from '../../storage/RefreshSessionStore';

/**
 * Writes the native refresh token to the Android Keystore after a successful
 * login/register, if running on Android native.
 * On web this is a no-op (isNativeSecureRefreshEnabled() === false).
 * MUST NOT write to localStorage — storage-discipline gate enforces this.
 */
async function persistNativeRefreshTokenIfApplicable(dto: AuthResponseDto): Promise<void> {
    if (!isNativeSecureRefreshEnabled()) {
        return;
    }
    if (!dto.refreshToken) {
        return;
    }
    const deviceId = getOrCreateDeviceId();
    await setNativeRefreshSession({
        refreshToken: dto.refreshToken,
        deviceId,
        expiresAtUtc: dto.expiresAtUtc,
    });
}

export async function login(t: HttpTransport, request: LoginRequest): Promise<AuthResponseDto> {
    const response = await t.authHttp.post<AuthResponseDto>('/user/auth/login', request);
    await persistNativeRefreshTokenIfApplicable(response.data);
    return response.data;
}

export async function register(
    t: HttpTransport,
    request: { phone: string; password: string; displayName: string; appId?: string; role?: string },
): Promise<AuthResponseDto> {
    const response = await t.authHttp.post<AuthResponseDto>('/user/auth/register', request);
    await persistNativeRefreshTokenIfApplicable(response.data);
    return response.data;
}

export async function getCurrentUser(t: HttpTransport): Promise<unknown> {
    const response = await t.http.get('/user/auth/me');
    return response.data;
}

/** POST /accounts/affiliation/code — idempotent, returns the caller's referral code. */
export async function generateReferralCode(t: HttpTransport): Promise<{ code: string }> {
    const response = await t.http.post<{ code: string }>('/accounts/affiliation/code');
    return response.data;
}

/** GET /user/auth/me/context — aggregate: me + farms (with plan + capabilities) + share + alerts. */
export async function getMeContext(t: HttpTransport): Promise<import('../../../core/session/MeContextService').MeContext> {
    const response = await t.http.get('/user/auth/me/context');
    return response.data;
}

/**
 * POST /user/auth/logout — revoke the CURRENT device session.
 * spec: secure-remembered-device-sessions-2026-06-24 / Task 6.1
 *
 * Web: the HttpOnly agrisync_refresh cookie is sent automatically via
 * withCredentials. No body is required.
 *
 * Android/native: the backend is AllowAnonymous on /logout so the bearer is
 * not required. We read the Keystore refresh token and send it in the body so
 * the server can look up the session row by token hash and revoke it — even
 * when the 15-min access token has already expired.
 * After the POST we clear the local Keystore entry regardless of outcome.
 */
export async function logout(t: HttpTransport): Promise<void> {
    if (isNativeSecureRefreshEnabled()) {
        // Native path: send the Keystore token so the server can revoke by hash.
        const stored = await getNativeRefreshSession();
        try {
            await t.authHttp.post('/user/auth/logout', stored ? { refreshToken: stored.refreshToken } : undefined);
        } finally {
            // Always clear local Keystore entry — even on network failure the user
            // intends to log out on this device.
            await clearNativeRefreshSession();
        }
    } else {
        // Web path: cookie carries the token (withCredentials); no body needed.
        await t.authHttp.post('/user/auth/logout');
    }
}

/** GET /accounts/affiliation/stats — referral counters. */
export async function getAffiliationStats(
    t: HttpTransport,
): Promise<{ referralsTotal: number; referralsQualified: number; benefitsEarned: number }> {
    const response = await t.http.get('/accounts/affiliation/stats');
    return response.data;
}

/** GET /accounts/affiliation/events — recent growth events. */
export async function getAffiliationEvents(
    t: HttpTransport,
    limit = 20,
): Promise<Array<{ id: string; eventType: string; occurredAtUtc: string; metadata: string | null }>> {
    const response = await t.http.get(`/accounts/affiliation/events?limit=${limit}`);
    return response.data;
}
