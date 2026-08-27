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
