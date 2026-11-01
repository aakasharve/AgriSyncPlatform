// Sub-plan 04 Task 9: AgriSyncClient decomposition — sync push/pull.
// Behavior identical to original AgriSyncClient methods.

import type { SyncPullResponse, SyncPushRequest, SyncPushResponse } from '../dtos';
import { normalizeSyncCursorForApi, type HttpTransport } from '../transport';

export async function pushSyncBatch(t: HttpTransport, request: SyncPushRequest): Promise<SyncPushResponse> {
    const response = await t.http.post<SyncPushResponse>('/sync/push', request);
    return response.data;
}

/**
 * lane MU-3 fix 1 (F9) — `heldFarmIds`: the farms this phone holds, sent as `farms=` so the server can say
 * EXPLICITLY which of them this person may no longer read (paused, waiting, removed). Additive: an older
 * server ignores it.
 */
export async function pullSyncChanges(
    t: HttpTransport,
    sinceCursorIso?: string,
    heldFarmIds: readonly string[] = [],
): Promise<SyncPullResponse> {
    const normalizedCursor = normalizeSyncCursorForApi(sinceCursorIso);
    const farms = heldFarmIds.length > 0 ? heldFarmIds.join(',') : undefined;
    const params = normalizedCursor || farms
        ? { ...(normalizedCursor ? { since: normalizedCursor } : {}), ...(farms ? { farms } : {}) }
        : undefined;
    const response = await t.http.get<SyncPullResponse>('/sync/pull', { params });
    return response.data;
}
