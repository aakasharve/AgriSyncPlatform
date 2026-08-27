/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T3 — findings R3 + R12.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The sync drawer counted one set of rows and listed a different one.
 * `useSyncQueueStatus` counted `FAILED` + `REJECTED_USER_REVIEW`
 * (`:56-57,73`), while `SyncStatusDrawer` queried `FAILED` alone
 * (`SyncStatusDrawer.tsx:55`). One durably-rejected row and zero failed rows
 * therefore rendered **"1 Failed" above an empty list** — a number with nothing
 * behind it, on the screen the header chip sends the farmer to when it says
 * `अडकलं — तपासा`.
 *
 * The fix is not a third query kept in step by a test. It is ONE array: the
 * count is its length and the list is its contents, so they cannot disagree by
 * construction (`E7`).
 *
 * THE SECOND THING THIS FIXES (R12)
 * ---------------------------------
 * `failedCount` used to mean `status === 'FAILED'`, which includes rows the
 * worker is still cheerfully retrying by itself. So one sub-cap failure put a
 * **red** badge next to the amber `फोनवर सेव्ह ✓` ("saved on phone") label —
 * both halves true, neither agreeing, on one 44x44 control. `failedCount` now
 * means **rows that need the farmer**, which is exactly the set that makes the
 * chip say `NEEDS_FIX`. A row below the cap is not stuck; it is in progress,
 * and it is counted as pending.
 *
 * Pure and Dexie-free so every branch is unit-testable without a database.
 */
// The cap is APPLIED in `MutationQueue.markFailedAsPending`, which exports the
// authoritative copy. This module reads T1's mirror of it instead, so that
// nothing here can pull Dexie into a pure module — and so the predicate below
// and the chip's claim are driven off the same number by construction. The two
// copies are held equal by `MutationRetryCap.transport.test.ts`.
import { MAX_AUTO_RETRY_COUNT } from './syncHonestyState';
import type { MutationQueueItem, MutationQueueStatus } from '../../../infrastructure/storage/DexieDatabase';

/**
 * The two mutation statuses that can possibly need the farmer. Read together in
 * one Dexie query; the predicate below decides which of them actually do.
 */
export const OPEN_FAILURE_STATUSES: readonly MutationQueueStatus[] = ['FAILED', 'REJECTED_USER_REVIEW'];

/** The minimum a caller must supply to ask whether a row is stuck. */
export interface StuckMutationInput {
    status: MutationQueueStatus;
    retryCount: number;
}

/**
 * What the drawer needs to render one stuck row — and nothing more.
 *
 * `payload` is deliberately absent. The chip and the drawer have no business
 * retaining whole mutation payloads for the lifetime of a 3-second poll, and a
 * narrow shape keeps the pure tests free of Dexie (same reasoning as
 * `SyncQueueRowSnapshot` in `syncHonestyState.ts`).
 */
export interface StuckMutationView {
    id?: number;
    clientRequestId: string;
    mutationType: string;
    status: MutationQueueStatus;
    retryCount: number;
    lastError?: string;
    /**
     * Which remedy actually works for this row — the one thing the old drawer
     * could not say, and the reason it offered a dead button.
     *
     * - `RETRY`           re-sending the identical bytes may well succeed. The
     *                     worker has simply stopped trying by itself. "Retry
     *                     All" and the per-row "Retry" both reach it.
     * - `NEEDS_REVIEW`    the server refused this row on its merits and said so
     *                     permanently. Re-sending it unchanged is known to
     *                     fail; the farmer must edit, retry or discard it in
     *                     `OfflineConflictPage`. A retry button here would be a
     *                     second painted door.
     */
    remedy: 'RETRY' | 'NEEDS_REVIEW';
}

/**
 * Does this row need the farmer?
 *
 * MUST agree with the `NEEDS_FIX` branch of `deriveSyncHonestyState`
 * (`syncHonestyState.ts:262-270`) for every status/retryCount pair, or the chip
 * and the drawer describe different worlds again. That agreement is asserted
 * directly, over the whole cross-product, in
 * `__tests__/stuckMutations.agreement.test.ts` — an independent oracle rather
 * than a shared helper, because a shared helper would make the two agree by
 * definition and prove nothing.
 */
export function needsFarmerAction(row: StuckMutationInput): boolean {
    if (row.status === 'REJECTED_USER_REVIEW') {
        return true;
    }

    // At or past the cap, `markFailedAsPending` stops flipping the row back to
    // PENDING (`MutationQueue.ts`), so nothing in the app will move it again
    // without a tap. Below the cap the worker is still working on it.
    return row.status === 'FAILED' && row.retryCount >= MAX_AUTO_RETRY_COUNT;
}

export function toStuckMutationView(row: MutationQueueItem): StuckMutationView {
    return {
        id: row.id,
        clientRequestId: row.clientRequestId,
        mutationType: row.mutationType,
        status: row.status,
        retryCount: row.retryCount,
        lastError: row.lastError,
        remedy: row.status === 'REJECTED_USER_REVIEW' ? 'NEEDS_REVIEW' : 'RETRY',
    };
}

/**
 * Splits the open-failure rows into the ones that need the farmer and a count
 * of the ones the worker is still handling on its own.
 *
 * Deterministically ordered oldest-first by `id` so the drawer's list does not
 * reshuffle under the farmer every three seconds.
 */
export function partitionOpenFailures(rows: readonly MutationQueueItem[]): {
    stuck: StuckMutationView[];
    stillRetrying: number;
} {
    const stuck: StuckMutationView[] = [];
    let stillRetrying = 0;

    for (const row of rows) {
        if (needsFarmerAction(row)) {
            stuck.push(toStuckMutationView(row));
        } else {
            stillRetrying += 1;
        }
    }

    stuck.sort((left, right) => (left.id ?? 0) - (right.id ?? 0));

    return { stuck, stillRetrying };
}
