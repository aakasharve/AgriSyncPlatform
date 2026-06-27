// Sub-plan 04 Task 9: AgriSyncClient decomposition — auth + identity.
// spec: secure-remembered-device-sessions-2026-06-24
// Auth calls are now side-effect-free — they return AuthResponseDto and let
// the caller (AuthProvider or AgriSyncClient.refreshSession) own session state.
// No setAuthSession calls here; session management is centralised in AuthProvider.

import type { AuthResponseDto, LoginRequest } from '../dtos';
import { type HttpTransport } from '../transport';

export async function login(t: HttpTransport, request: LoginRequest): Promise<AuthResponseDto> {
    const response = await t.authHttp.post<AuthResponseDto>('/user/auth/login', request);
    return response.data;
}

export async function register(
    t: HttpTransport,
    request: { phone: string; password: string; displayName: string; appId?: string; role?: string },
): Promise<AuthResponseDto> {
    const response = await t.authHttp.post<AuthResponseDto>('/user/auth/register', request);
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
 * withCredentials. The X-Device-Id header is already attached by the
 * authHttp interceptor. No body is required.
 */
export async function logout(t: HttpTransport): Promise<void> {
    await t.authHttp.post('/user/auth/logout');
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
