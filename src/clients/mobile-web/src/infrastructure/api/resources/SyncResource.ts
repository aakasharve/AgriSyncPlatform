// Sub-plan 04 Task 9: AgriSyncClient decomposition — sync push/pull.
// Behavior identical to original AgriSyncClient methods.

import type { SyncPullResponse, SyncPushRequest, SyncPushResponse } from '../dtos';
import { normalizeSyncCursorForApi, type HttpTransport } from '../transport';

export async function pushSyncBatch(t: HttpTransport, request: SyncPushRequest): Promise<SyncPushResponse> {
    const response = await t.http.post<SyncPushResponse>('/sync/push', request);
    return response.data;
}

export async function pullSyncChanges(t: HttpTransport, sinceCursorIso?: string): Promise<SyncPullResponse> {
    const normalizedCursor = normalizeSyncCursorForApi(sinceCursorIso);
    const params = normalizedCursor ? { since: normalizedCursor } : undefined;
    const response = await t.http.get<SyncPullResponse>('/sync/pull', { params });
    return response.data;
}
