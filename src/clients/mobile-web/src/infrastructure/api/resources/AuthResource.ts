// Sub-plan 04 Task 9: AgriSyncClient decomposition — auth + identity.
// Methods are byte-for-byte equivalent to the originals on
// AgriSyncClient. The slim AgriSyncClient class delegates here.

import { clearAuthSession, setAuthSession } from '../../storage/AuthTokenStore';
import type { AuthResponseDto, LoginRequest } from '../dtos';
import { toAuthSession, type HttpTransport } from '../transport';

export async function login(t: HttpTransport, request: LoginRequest): Promise<AuthResponseDto> {
    clearAuthSession();
    const response = await t.authHttp.post<AuthResponseDto>('/user/auth/login', request);
    const session = toAuthSession(response.data);
    setAuthSession(session);
    return response.data;
}

export async function register(
    t: HttpTransport,
    request: { phone: string; password: string; displayName: string; appId?: string; role?: string },
): Promise<AuthResponseDto> {
    clearAuthSession();
    const response = await t.authHttp.post<AuthResponseDto>('/user/auth/register', request);
    const session = toAuthSession(response.data);
    setAuthSession(session);
    return response.data;
}

export async function refreshToken(t: HttpTransport, refreshTokenStr: string): Promise<AuthResponseDto> {
    const response = await t.authHttp.post<AuthResponseDto>('/user/auth/refresh', { refreshToken: refreshTokenStr });
    const session = toAuthSession(response.data);
    setAuthSession(session);
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
