/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T1.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The app-header sync chip used to derive its label from `db.outbox` — a Dexie
 * table that NOTHING drains. `DexieLogsRepository` writes rows at `PENDING`
 * and the only three functions that could move a row off `PENDING`
 * (`getPendingOutboxEvents` / `markOutboxEventSent` / `markOutboxEventFailed`)
 * have zero callers. So `pendingCount > 0` was true forever and the chip
 * latched on an amber "Sending..." for every farmer, always — whether their
 * records had reached the server an hour ago or were still stranded on the
 * handset. It was not a status; it was a decoration shaped like one.
 *
 * Doctrine `P4` (no fabricated numbers reach a farmer) and `P5` (a truthful
 * missing feature beats a fake working one): a status must be backed by
 * evidence, or it must not be claimed.
 *
 * `db.mutationQueue` is the only store in this app that carries a real
 * per-mutation server acknowledgement — `BackgroundSyncWorker` marks a row
 * `APPLIED` only when that row's push result carries `status: 'applied'` or
 * `'duplicate'` (`BackgroundSyncWorker.ts:224-226`). A 200 from `/sync/push`
 * is NOT evidence: the batch response can carry `rejected` for this row, or
 * omit it entirely, and the worker correctly treats both as failure. That is
 * why the derivation below reads the queue's rows and never a transport
 * outcome (controller ruling `R5`).
 *
 * This module is deliberately PURE and Dexie-free — plain row data in, one
 * state out — so every branch is unit-testable without a database.
 *
 * NOT IN SCOPE HERE: `db.outbox` keeps its writers, its table and its Dexie
 * version. This task only cuts it out of the status READ path (`R1`); once
 * nothing reads it, it is inert. Retiring the table is a later phase.
 */

import type { MutationQueueStatus } from '../../../infrastructure/storage/DexieDatabase';

/**
 * The only three claims the app is allowed to make about a farmer's records.
 *
 * - `ON_PHONE`   captured locally, NOT yet acknowledged by the server.
 *                This is the honest default: it claims only what the phone
 *                itself can prove.
 * - `ON_SERVER`  the server acknowledged every outstanding mutation
 *                (`applied` or `duplicate`). The one state that makes a claim
 *                about the server, and the one that requires real evidence.
 * - `NEEDS_FIX`  something needs the farmer. Folds in ALL three of the
 *                currently-silent failure cases:
 *                  1. `REJECTED_USER_REVIEW` — the durable rejection that is
 *                     deliberately never auto-retried (`MutationQueue.ts:229-231`),
 *                     and which the badge did not count until this task.
 *                  2. a `FAILED` row at or past the auto-retry cap
 *                     (`MutationQueue.ts:239`), which is stranded forever with
 *                     no marker distinguishing it from a retryable failure.
 *                  3. never-enqueued records — `enqueueLogsForSync`'s
 *                     `skippedLogIds`. Those rows exist in NO queue, so this
 *                     module cannot see them; the caller that can is Task T2
 *                     (`useLogCommands.ts`). T2 must reuse this state and its
 *                     wording rather than invent a fourth claim.
 *
 * The model is LOCKED at three states (plan section G). Do not add a fourth
 * without a founder ruling — a fourth state is a fourth claim.
 */
export type SyncHonestyState =
    | 'ON_PHONE'
    | 'ON_SERVER'
    | 'NEEDS_FIX';

/**
 * The minimum a caller must read out of Dexie for the derivation to work.
 * Deliberately NOT `MutationQueueItem`: the chip has no business retaining
 * whole mutation payloads, and a narrow shape keeps the tests free of Dexie.
 */
export interface SyncQueueRowSnapshot {
    status: MutationQueueStatus;
    retryCount: number;
}

/**
 * The mutation-queue statuses that can still change the chip's claim.
 *
 * `APPLIED` and `REJECTED_DROPPED` are terminal and are deliberately excluded
 * from the read: `APPLIED` rows are never pruned, so reading them would grow
 * the query without ever changing its answer. `deriveSyncHonestyState` ignores
 * both anyway, so passing them in is harmless — this constant is a read
 * optimisation, not part of the semantics.
 */
export const SYNC_HONESTY_OPEN_STATUSES: readonly MutationQueueStatus[] = [
    'PENDING',
    'SENDING',
    'FAILED',
    'REJECTED_USER_REVIEW',
];

/**
 * The auto-retry cap, past which a `FAILED` row is stranded permanently.
 *
 * MUST stay equal to the `maxRetryCount` default of
 * `MutationQueue.markFailedAsPending` (`MutationQueue.ts:233`, applied at
 * `:239`), which is a default parameter rather than an exported constant.
 * It is duplicated here rather than exported from `MutationQueue.ts` because
 * the retry path belongs to Task T3 and this task must not edit it. When T3
 * lands, collapse these two into one exported constant.
 */
export const MAX_AUTO_RETRY_COUNT = 5;

/**
 * i18n keys for the three states. Kept beside the state model so that a new
 * state cannot be added without a label, and so Task T2 can render the very
 * same `NEEDS_FIX` wording for a never-enqueued log instead of coining a new
 * phrase for the same situation.
 *
 * The chip is shared app-wide chrome whose other labels are English, so the
 * strings live in `i18n/translations.ts` and follow the farmer's language
 * preference (controller ruling `R6`) rather than being hardcoded Marathi.
 */
export const SYNC_HONESTY_I18N_KEYS: Record<SyncHonestyState, string> = {
    ON_PHONE: 'sync.onPhone',
    ON_SERVER: 'sync.onServer',
    NEEDS_FIX: 'sync.needsFix',
};

/**
 * Derives the one claim the app is allowed to make from the queue's rows.
 *
 * Weakest claim wins. The order of precedence is:
 *   1. any durable rejection, or any row past the retry cap -> `NEEDS_FIX`
 *   2. any row still awaiting acknowledgement            -> `ON_PHONE`
 *   3. nothing outstanding                               -> `ON_SERVER`
 *
 * A retryable `FAILED` row (below the cap) is `ON_PHONE`, not `NEEDS_FIX`:
 * the record is safe on the handset and the worker will try again by itself,
 * so there is nothing for the farmer to do. Calling that "stuck" would be the
 * mirror-image lie — a visible failure the farmer cannot act on (`P5`).
 *
 * `REJECTED_DROPPED` is terminal-and-ignored: the farmer explicitly discarded
 * that row through the conflict screen, so it is an acknowledged loss rather
 * than a silent one. Treating it as `NEEDS_FIX` would re-create exactly the
 * permanently-latched chip this task removes.
 *
 * Note there is no "sending" / "in flight" state at all, by design. Whether a
 * request is currently on the wire is not something the farmer can act on, and
 * a spinner beside a zero count is the original defect in visual form.
 *
 * @param rows Non-terminal mutation-queue rows. An empty array means nothing
 *             is outstanding, which is `ON_SERVER`.
 */
export function deriveSyncHonestyState(rows: readonly SyncQueueRowSnapshot[]): SyncHonestyState {
    let hasUnacknowledged = false;

    for (const row of rows) {
        switch (row.status) {
            case 'REJECTED_USER_REVIEW':
                return 'NEEDS_FIX';

            case 'FAILED':
                if (row.retryCount >= MAX_AUTO_RETRY_COUNT) {
                    return 'NEEDS_FIX';
                }
                hasUnacknowledged = true;
                break;

            case 'PENDING':
            case 'SENDING':
                hasUnacknowledged = true;
                break;

            case 'APPLIED':
            case 'REJECTED_DROPPED':
                break;

            default: {
                // Exhaustiveness guard: a new MutationQueueStatus must be
                // classified here deliberately, not defaulted into silence.
                const unhandled: never = row.status;
                void unhandled;
                break;
            }
        }
    }

    return hasUnacknowledged ? 'ON_PHONE' : 'ON_SERVER';
}
