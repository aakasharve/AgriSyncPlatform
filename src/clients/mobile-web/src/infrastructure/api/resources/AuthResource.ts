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
    stashPendingRevoke,
    getPendingRevoke,
    clearPendingRevoke,
} from '../../storage/RefreshSessionStore';
import { markPendingLogout, clearPendingLogout, hasPendingLogout } from '../../storage/PendingLogoutStore';
import { categorizePushFailure } from '../../sync/RejectionPolicy';

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
 * LOGOUT is two steps, so the farmer is signed out locally AT ONCE and the
 * server revoke can finish later if the phone is offline.
 *
 * 1. beginLogout() - local and fast, no network. Records the NON-SECRET
 *    pending-logout marker, and on Android MOVES the Keystore refresh token into
 *    the separate pending-revoke slot (never used for refresh; deleted when the
 *    revoke is judged or after the 14-day offline window). The caller then clears the live
 *    session. From this moment boot will not re-authenticate.
 * 2. completePendingLogout() - POST /user/auth/logout (AllowAnonymous; web
 *    carries the HttpOnly cookie, Android sends the slot's token). Reached
 *    server (2xx) or the server judged it (any non-transport answer) => clear
 *    marker + slot. No response => leave both and report 'retry'; it is run
 *    again on every boot and 'online' event.
 *
 * spec: secure-remembered-device-sessions-2026-06-24 / Task 6.1
 */
export async function beginLogout(): Promise<void> {
    if (isNativeSecureRefreshEnabled()) {
        const stored = await getNativeRefreshSession();
        if (stored) {
            try {
                await stashPendingRevoke(stored.refreshToken);
            } catch {
                // If the slot cannot be written we still sign out locally below;
                // the server credential then simply ages out on the server (its 30-day life).
            }
        }
    }
    markPendingLogout();
}

export type PendingLogoutResult = 'none' | 'done' | 'retry';

export async function completePendingLogout(t: HttpTransport): Promise<PendingLogoutResult> {
    const native = isNativeSecureRefreshEnabled();
    const nativeToken = native ? await getPendingRevoke() : null;
    if (!hasPendingLogout() && nativeToken === null) {
        return 'none';
    }

    try {
        if (native) {
            if (nativeToken !== null) {
                await t.authHttp.post('/user/auth/logout', { refreshToken: nativeToken });
            }
        } else {
            await t.authHttp.post('/user/auth/logout');
        }
    } catch (error) {
        if (categorizePushFailure(error) === 'TRANSPORT') {
            return 'retry';
        }
        // The server answered and refused: there is nothing it will revoke by
        // asking again. Fall through and clear.
    }

    await clearPendingRevoke();
    clearPendingLogout();
    return 'done';
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
