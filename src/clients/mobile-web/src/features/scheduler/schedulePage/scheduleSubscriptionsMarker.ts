/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane L8b-2 fix round 1 (B011) - a phone that upgrades has a cursor already past every schedule choice made
 * before (the pull is a delta), so it would never receive them. Same pattern as `billVersionsMarker`: ONCE, and only when the
 * server says it sends the key (the pull carries `scheduleSubscriptions`, even empty), the next pull is asked for from the
 * beginning (the established F1 path, `requestLogsRebuild`); that full pull carries every choice and settles the marker. An
 * older server never sends the key, so a phone never loops on one.
 */
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { requestLogsRebuild } from '../../sync/pull/logsRebuildMarker';

/** `appMeta` key: written once the phone has received every schedule choice from a server that sends them. */
export const SCHEDULE_SUBSCRIPTIONS_MARKER_KEY = 'l8b2.scheduleSubscriptionsFromServer.v1';

export type ScheduleSubscriptionsOutcome = 'older-server' | 'done' | 'requested';

/** After a pull is reconciled. `fullPull` = this pull started from the beginning (it carried every choice this person may read). */
export async function settleScheduleSubscriptions(
    db: AgriLogDatabase,
    payload: { scheduleSubscriptions?: unknown },
    fullPull: boolean,
): Promise<ScheduleSubscriptionsOutcome> {
    if (!Array.isArray(payload.scheduleSubscriptions)) return 'older-server';
    if ((await db.appMeta.get(SCHEDULE_SUBSCRIPTIONS_MARKER_KEY)) !== undefined) return 'done';

    if (fullPull) {
        const now = new Date().toISOString();
        await db.appMeta.put({ key: SCHEDULE_SUBSCRIPTIONS_MARKER_KEY, value: { settledAtUtc: now }, updatedAt: now });
        return 'done';
    }

    await requestLogsRebuild(db);
    return 'requested';
}
