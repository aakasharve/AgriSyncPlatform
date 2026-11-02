// Sub-plan 04 Task 9: AgriSyncClient decomposition — admin ops surface.
// Behavior identical to original.

import type { AdminOpsHealthDto } from '../dtos';
import type { HttpTransport } from '../transport';

export async function getAdminOpsHealth(t: HttpTransport): Promise<AdminOpsHealthDto> {
    const response = await t.http.get<AdminOpsHealthDto>('/shramsafal/admin/ops/health');
    return response.data;
}

/**
 * `GET /shramsafal/admin/me/scope` — the admin scope the caller holds. The server answers 200 to any signed-in caller (an
 * outcome, a scope or null, the caller's organisation seats), so the phone can decide what to show without parsing errors.
 * Only the fields the phone reads are typed; the rest of the answer is left alone.
 */
export interface AdminMeScopeDto {
    outcome?: string;
    scope?: { isPlatformAdmin?: boolean } | null;
    memberships?: { orgType?: string; orgRole?: string }[] | null;
}

export async function getAdminMeScope(t: HttpTransport): Promise<AdminMeScopeDto> {
    const response = await t.http.get<AdminMeScopeDto>('/shramsafal/admin/me/scope');
    return response.data;
}

/**
 * spec: plr-d10 lane F99 fix pass 1 (D-72) — the platform admin, by the server's own rule
 * (`SetPriceConfigVersionHandler.IsPlatformAdminAsync`): the resolved scope says so, or the caller holds the Owner seat of
 * the Platform organisation (an admin who also sits in other organisations resolves as Ambiguous, with no scope). Fails
 * closed: anything else, a missing field or a body that is not this shape, is NOT the platform admin.
 */
export function isPlatformAdminScope(body: unknown): boolean {
    if (typeof body !== 'object' || body === null) return false;
    const dto = body as AdminMeScopeDto;
    if (dto.scope?.isPlatformAdmin === true) return true;
    return Array.isArray(dto.memberships)
        && dto.memberships.some(m => m?.orgType === 'Platform' && m?.orgRole === 'Owner');
}
