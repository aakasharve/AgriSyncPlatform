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
 * EXPLICITLY which of them this person may no longer read (paused, waiting, removed). Fix 2 (N5): sent EVEN WHEN
 * EMPTY (`farms=`) — a phone that holds no farm (all purged, or new) is then sent every farm it may read from the
 * start. `undefined` = the caller does not say (nothing is sent). Additive: an older server ignores it.
 */
/** The schedule format this build reads (slice 3: the task format). */
export const SCHEDULE_FORMAT = 2;
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9) - this build reads the farm's setup from the server (`farmSetup`: water sources, motors,
 * power times, machines, plot water). A query, not a header: CORS needs nothing new. An older server ignores it; a phone that does not send it is sent
 * no `farmSetup` key at all (its pull is byte for byte what it was).
 */
export const FARM_SETUP_FORMAT = 1;

const normalizedCursorOrEmpty = (sinceCursorIso?: string): string | undefined => normalizeSyncCursorForApi(sinceCursorIso) || undefined;

export async function pullSyncChanges(
    t: HttpTransport,
    sinceCursorIso?: string,
    heldFarmIds?: readonly string[],
): Promise<SyncPullResponse> {
    const normalizedCursor = normalizedCursorOrEmpty(sinceCursorIso);
    const farms = heldFarmIds === undefined ? undefined : heldFarmIds.join(',');
    // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3) - `scheduleFormat=2`: this build reads the schedule task format, so the server may send the
    // works of a plot-season's own schedule (`ownScheduleItems`, only for farms the switch is on for). A query, not a header: CORS needs nothing new. An older
    // server ignores it; a 1.0.17 phone never sends it and is sent exactly what it was sent before.
    const params = {
        ...(normalizedCursor ? { since: normalizedCursor } : {}),
        ...(farms !== undefined ? { farms } : {}),
        scheduleFormat: SCHEDULE_FORMAT,
        farmSetup: FARM_SETUP_FORMAT,
    };
    const response = await t.http.get<SyncPullResponse>('/sync/pull', { params });
    return response.data;
}
