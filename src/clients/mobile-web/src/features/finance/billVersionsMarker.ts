/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 fix round 1 (review M4). A phone that pulled its bills
 * before BILL-1 holds them with NO version. The pull is a delta, so those bills would come back only when they change: no
 * "मंजूर करा" could be offered on them (an approval names the exact version, never a guess), and a bill set aside before
 * BILL-1 would never reach तपासायचे.
 *
 * The smallest safe way (chosen over asking the server for one bill when it is opened, which would still leave old flagged
 * bills out of तपासायचे): ONCE, and only when the server says it sends every bill with its version (the pull's
 * `billVersions: true`), a phone that still holds a bill with no version asks for one full re-pull through the established
 * F1 path (`requestLogsRebuild`: the next pull starts from the beginning and re-merges everything that holds no unsent change).
 * The full pull that follows carries every bill with its version and settles it for good. An older server never says it, so a
 * phone never loops on one.
 */
import type { AgriLogDatabase } from '../../infrastructure/storage/DexieDatabase';
import { requestLogsRebuild } from '../sync/pull/logsRebuildMarker';

/** `appMeta` key: written once every held bill came from a server that sends versions. */
export const BILL_VERSIONS_MARKER_KEY = 'bill1.billVersionsFromServer.v1';

export type BillVersionsOutcome = 'older-server' | 'done' | 'requested';

const hasVersion = (payload: unknown): boolean => {
    const version = (payload as { billVersion?: unknown } | null | undefined)?.billVersion;
    return typeof version === 'number' && Number.isInteger(version) && version >= 1;
};

/**
 * After a pull is reconciled: is a full re-pull still owed for bills held with no version? `fullPull` = this pull started from
 * the beginning (it carried every bill this person may read).
 */
export async function settleBillVersions(
    db: AgriLogDatabase,
    payload: { billVersions?: unknown },
    fullPull: boolean,
): Promise<BillVersionsOutcome> {
    if (payload.billVersions !== true) return 'older-server';
    if ((await db.appMeta.get(BILL_VERSIONS_MARKER_KEY)) !== undefined) return 'done';

    const now = new Date().toISOString();
    const markDone = async (): Promise<BillVersionsOutcome> => {
        await db.appMeta.put({ key: BILL_VERSIONS_MARKER_KEY, value: { settledAtUtc: now }, updatedAt: now });
        return 'done';
    };

    if (fullPull) return markDone();

    const rows = await db.costEntries.toArray();
    if (rows.every(row => hasVersion(row.payload))) return markDone();

    await requestLogsRebuild(db);
    return 'requested';
}
