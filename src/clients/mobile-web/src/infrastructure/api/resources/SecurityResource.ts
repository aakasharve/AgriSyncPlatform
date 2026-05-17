// spec: data-principle-spine-2026-05-05/05.3
//
// Security resource — tenant DEK fetch + resolve.
//
// NOTE (parallel implementation): Phase 05 sub-phase 05.2 is being
// implemented in parallel with 05.3. The endpoint paths assumed below
// — `GET /shramsafal/security/tenant-dek` and
// `POST /shramsafal/security/tenant-dek/resolve` — match the existing
// Phase 04 `/shramsafal/` URL convention used by AiResource. If 05.2
// ships different paths, that's a follow-up: bump the strings here
// and re-run the smoke test against the live backend. The TenantDek
// response/request shapes below match plan §05.2.2.

import type { HttpTransport } from '../transport';
import type { TenantDekResponse, ResolveDekRequest, ResolveDekResponse } from '../dtos';

/**
 * Fetch the current tenant DEK. Caller is expected to cache the result
 * in memory for the session (see `tenantDekClient.ts`) and clear on
 * logout — never persist to disk.
 */
export async function getTenantDek(t: HttpTransport): Promise<TenantDekResponse> {
    const response = await t.http.get<TenantDekResponse>('/shramsafal/security/tenant-dek');
    return response.data;
}

/**
 * Resolve a previously-issued DEK id back to plaintext key bytes. Used
 * when reading a sealed clip whose `wrappedDekId` is not the currently
 * cached DEK (the typical case after the daily rotation defined in
 * plan §05.2.1). Returns `null` when the backend refuses (wrong tenant
 * or KMS-bound EncryptionContext mismatch — both surface as 404).
 */
export async function resolveDek(
    t: HttpTransport,
    dekId: string,
): Promise<ResolveDekResponse | null> {
    const payload: ResolveDekRequest = { dekId };
    try {
        const response = await t.http.post<ResolveDekResponse>(
            '/shramsafal/security/tenant-dek/resolve',
            payload,
        );
        return response.data;
    } catch (err: unknown) {
        // The backend signals "wrong tenant" or "stale dekId" with 404
        // (per plan §05.2.2). Treat it as a clean miss — VoiceClipRetention
        // can then surface the clip as unrecoverable rather than crashing.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) return null;
        throw err;
    }
}
