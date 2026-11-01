/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Reads the mutation queue for clientside-pending log writes so the
 * pull reconciler does not overwrite them with stale server state.
 * ARCH-S004 invariant.
 */

import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { REFUSAL_RESTORES_SERVER_VERSION } from '../logsRebuildMarker';

/**
 * P0.5 — the statuses that mean "this device still holds unresolved intent for
 * that log, so a pull may not overwrite it".
 *
 * `REJECTED_USER_REVIEW` was missing. A mutation the server refused sits in that
 * status holding the farmer's intent while he decides what to do about it, and
 * the conflict screen is the only place it is visible — yet a pull would happily
 * overwrite the local record underneath him. It self-releases correctly:
 * discarding sets `REJECTED_DROPPED` and editing sets `PENDING`, and both leave
 * this set, so nothing gets permanently guarded.
 */
const UNRESOLVED_LOCAL_INTENT = [
    'PENDING',
    'SENDING',
    'FAILED',
    'REJECTED_USER_REVIEW',
] as const;

/**
 * spec: plr-d10 (lane OF-S) — the queued changes whose REFUSAL means "the server's version stands": a move of a saved
 * entry's plot / day and a worker-count correction. Once the server has refused one of these, there is no intent left to
 * protect — the phone puts the entry back to the server's version (the worker asks for it, `logsRebuildMarker.ts`) and
 * says why (`refusedRevision.ts`). So a refused one does NOT hold the entry from the pull, unlike a refused content
 * change, which stays on this phone for him to decide. The set lives with the request that brings the version back.
 * Answers: does this row still hold its entry from the pull?
 */
const holdsEntry = (mutation: { mutationType: string; status: string }): boolean =>
    !(mutation.status === 'REJECTED_USER_REVIEW' && REFUSAL_RESTORES_SERVER_VERSION.has(mutation.mutationType));

/**
 * Thrown when the queue cannot be read. `reconcileSyncPull` must treat this as
 * "guard everything" — see the fail-closed note below.
 */
export class PendingLogIdsUnavailableError extends Error {
    constructor(cause: unknown) {
        super('mutationQueue could not be read; the overwrite guard cannot be evaluated');
        this.name = 'PendingLogIdsUnavailableError';
        this.cause = cause;
    }
}

export async function readPendingLogIds(db: AgriLogDatabase): Promise<Set<string>> {
    const pendingLogIds = new Set<string>();
    try {
        const pending = await db.mutationQueue
            .where('status')
            .anyOf([...UNRESOLVED_LOCAL_INTENT])
            .toArray();
        for (const mutation of pending) {
            if (!holdsEntry(mutation)) continue;
            const payloadObj = mutation.payload as
                | { dailyLogId?: string; logId?: string; id?: string }
                | null
                | undefined;
            if (!payloadObj || typeof payloadObj !== 'object') continue;
            if (payloadObj.dailyLogId) pendingLogIds.add(payloadObj.dailyLogId);
            if (payloadObj.logId) pendingLogIds.add(payloadObj.logId);
        }
    } catch (error) {
        // P0.5 — FAIL CLOSED. This used to warn and return an EMPTY set, which
        // reads downstream as "no log has pending local work" — silently
        // disabling the entire overwrite guard and letting one pull flatten
        // every unsent record on the device.
        //
        // A guard with a bypass this quiet is not a guard, and no mutation proof
        // would have caught it: reverting the guard's contents still leaves an
        // error path that answers "nothing to protect". The caller now skips the
        // log reconciliation for this cycle instead. Skipping a pull costs the
        // farmer a delay; the old behaviour cost him his work.
        console.warn('SyncPullReconciler: failed to read mutationQueue for conflict detection', error);
        throw new PendingLogIdsUnavailableError(error);
    }
    return pendingLogIds;
}

/** spec: plr-d10 lane PRV fix pass 1 (M6) — the records a change of his still waits on, for the withdrawal reconciler. */
export interface WithdrawalHolds {
    logIds: Set<string>;
    moneyIds: Set<string>;
}

/**
 * Lane PRV fix pass 1 (M6) — every record a change of his still waits on, work AND money (P10: his intent is not cache).
 * Unlike `readPendingLogIds`, a parked refusal ALWAYS holds its record here, even one whose refusal would put the
 * server's version back: a record kept from him has no server version to put back, so while he has not discarded his
 * change the record stays on his phone. `undefined` when the outbox cannot be read: then nothing is removed.
 */
export async function readWithdrawalHolds(db: AgriLogDatabase): Promise<WithdrawalHolds | undefined> {
    try {
        const rows = await db.mutationQueue.where('status').anyOf([...UNRESOLVED_LOCAL_INTENT]).toArray();
        const holds: WithdrawalHolds = { logIds: new Set(), moneyIds: new Set() };
        for (const row of rows) {
            const payload = row.payload as { dailyLogId?: unknown; logId?: unknown; costEntryId?: unknown } | null | undefined;
            if (!payload || typeof payload !== 'object') continue;
            for (const id of [payload.dailyLogId, payload.logId]) if (typeof id === 'string' && id) holds.logIds.add(id);
            if (typeof payload.costEntryId === 'string' && payload.costEntryId) holds.moneyIds.add(payload.costEntryId);
        }
        return holds;
    } catch (error) {
        console.warn('readWithdrawalHolds: the outbox could not be read; nothing is removed this time', error);
        return undefined;
    }
}
