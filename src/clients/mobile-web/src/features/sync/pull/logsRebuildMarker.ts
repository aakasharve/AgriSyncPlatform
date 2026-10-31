/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1, review N9) — ONE truthful rebuild of every pulled log.
 *
 * Logs this phone pulled BEFORE this version still hold what the old rebuild invented from their task lines
 * ('Drip', 'Field', 'Preventive', five zero totals...). The pull is a delta, and the reconciler skips a log whose
 * server version it already holds, so those logs would never be rebuilt on their own. So, once — on the first pull
 * after this version is installed — the phone asks for EVERYTHING again (cursor '0') and lets the reconciler rebuild
 * each log it did not make itself, from the server's stored details or, failing those, from what its task lines
 * truly say. A log with unsent edits is never touched (the reconciler's pending guard holds as always), and a log
 * this phone made keeps its own details.
 *
 * The marker is written in the SAME transaction as the rebuilt logs, and only when the logs were actually
 * reconciled; a pull that fails, or that skips the logs, leaves it unwritten and the next pull tries again.
 */
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

/** `appMeta` key. Bump the suffix only if a later version needs one more full rebuild. */
export const LOGS_REBUILD_MARKER_KEY = 'f1.logsRebuiltFromServer.v1';

/**
 * Is the one full rebuild still due? An unreadable `appMeta` answers "no": a full re-pull is a cost, never a
 * correctness requirement of the pull itself, so it is not forced on a phone that cannot even say whether it ran.
 */
export async function isLogsRebuildDue(db: AgriLogDatabase): Promise<boolean> {
    try {
        return (await db.appMeta.get(LOGS_REBUILD_MARKER_KEY)) === undefined;
    } catch (error) {
        console.warn(JSON.stringify({
            component: 'logsRebuildMarker',
            action: 'marker_unreadable',
            reason: error instanceof Error ? error.message : String(error),
        }));
        return false;
    }
}

/** Records that the rebuild ran. Called inside the reconcile transaction (it includes `appMeta`). */
export async function markLogsRebuilt(db: AgriLogDatabase, atIso: string): Promise<void> {
    await db.appMeta.put({ key: LOGS_REBUILD_MARKER_KEY, value: { rebuiltAtUtc: atIso }, updatedAt: atIso });
}

/**
 * spec: plr-d10 (lane OF-S) — the queued changes whose REFUSAL means "the server's version stands" (a move of a saved
 * entry's plot / day, a worker-count correction), and the request that brings that version back.
 *
 * The server REFUSED a queued move / worker-count change of an entry, so the entry must show
 * the server's version again. The pull is a delta and this phone's cursor has already gone past that version (its pull
 * was held off the entry while the change waited), so the ONE full rebuild above is asked for once more: the next pull
 * (in the same sync cycle) starts from the beginning and re-merges every entry that holds no unsent change. Rare by
 * nature (a refusal), and the marker is written again by that pull.
 */
export const REFUSAL_RESTORES_SERVER_VERSION: ReadonlySet<string> = new Set([
    SyncMutationName.MoveDailyLog,
    SyncMutationName.CorrectLabourAssignment,
]);

export async function requestLogsRebuild(db: AgriLogDatabase): Promise<void> {
    await db.appMeta.delete(LOGS_REBUILD_MARKER_KEY);
}
