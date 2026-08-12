/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T1.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The app-header sync chip used to derive its label from `db.outbox` — a Dexie
 * table that NOTHING drains. Rows go in `PENDING` and the only three functions
 * that could move them have zero callers. So the chip latched on an amber
 * "Sending..." forever, for every farmer, whether their records had reached the
 * server an hour ago or were still stranded on the handset.
 *
 * `db.mutationQueue` is the only store carrying a real per-mutation server
 * acknowledgement — `BackgroundSyncWorker` marks a row `APPLIED` only when that
 * row's push result is `applied` or `duplicate` (`BackgroundSyncWorker.ts:224-226`).
 * A 200 from `/sync/push` is NOT evidence: the batch response can reject this
 * row or omit it entirely, and the worker treats both as failure (`R5`).
 *
 * THE RULE THAT SHAPES EVERYTHING BELOW
 * -------------------------------------
 * **Every claim needs positive evidence. Absence of bad news is not good news.**
 *
 * Review round 1 found the first version violated this in the most damaging way
 * possible: `ON_SERVER` was produced by the *absence* of open rows, so "I know
 * nothing" and "everything is acknowledged" were literally the same input. A
 * log that `resolveSyncTarget` refused to queue (an ordinary case — a plot whose
 * crop cycle has not synced down yet, `logSyncMutationService.ts:291-309`)
 * writes NO mutation row at all, so the queue reads empty and the farmer was
 * shown `पाठवलं ✓` — a receipt for a record no code path will ever send. That
 * was strictly worse than the bug this task set out to fix.
 *
 * So `ON_SERVER` now requires `acknowledgedCount > 0`, and when there is nothing
 * outstanding AND no acknowledgement has ever been seen, this module returns
 * `null` — **no claim at all**. That is not a fourth record state; it is the
 * absence of a claim, which is what `P5` demands when we have nothing to say.
 *
 * WHAT THIS MODULE STILL CANNOT SEE (state it, do not paper over it — `W6`)
 * ------------------------------------------------------------------------
 * A never-enqueued log exists in NO queue. On a device that has previously had
 * a mutation acknowledged, `acknowledgedCount > 0` holds, so a later skipped log
 * still leaves the chip on `ON_SERVER`. The chip is global and structurally
 * blind to a record that reached no queue. The only honest surface for that is
 * the save path itself, at the moment the log is dropped — which is Task T2's
 * `skippedLogIds` toast, and is exactly why T2 exists. Do not try to fix it
 * here; a global chip cannot count something that was never written.
 *
 * Every function here is PURE — plain data in, one claim out — so every branch
 * is unit-testable without a database. (The module now imports the retry cap
 * from `MutationQueue`, so its import GRAPH is no longer Dexie-free; nothing it
 * does at runtime touches a database.)
 *
 * NOT IN SCOPE: `db.outbox` keeps its writers, its table and its Dexie version.
 * This task only cuts it out of the status READ path (`R1`).
 */

import type { MutationQueueStatus } from '../../../infrastructure/storage/DexieDatabase';
// The cap is APPLIED in `MutationQueue.markFailedAsPending`, which is therefore
// the authoritative definition. T1 shipped a duplicated literal here with a
// note to collapse the two "when T3 lands"; T3 exported the authoritative copy
// and left the collapse to whoever next opened this file. This is that collapse:
// ONE literal `5` now exists in the client, and the drift class is structurally
// impossible rather than merely tested. (`MutationRetryCap.transport.test.ts`
// carried the drift guard; it is a tautology once the binding is shared, so it
// was deleted rather than left standing under a title it no longer earns.)
import { MAX_AUTO_RETRY_COUNT } from '../../../infrastructure/sync/MutationQueue';

/**
 * The only three claims the app is allowed to make about a farmer's records.
 *
 * - `ON_PHONE`   captured locally, NOT yet acknowledged by the server.
 * - `ON_SERVER`  nothing is outstanding AND the server has acknowledged at
 *                least one mutation from this device.
 * - `NEEDS_FIX`  something needs the farmer, and they can act on it.
 *
 * The model is LOCKED at three (plan section G). `null` below is not a fourth
 * state — it is the refusal to make any of these three.
 */
export type SyncHonestyState =
    | 'ON_PHONE'
    | 'ON_SERVER'
    | 'NEEDS_FIX';

/**
 * A claim, or `null` for **no claim at all**.
 *
 * `null` is the honest resting state of a device that has nothing outstanding
 * and has never had anything acknowledged — a fresh install, or a device whose
 * every log was silently dropped before reaching a queue. Rendering `ON_SERVER`
 * there is a fabricated receipt (`P4`); rendering nothing is a truthful absence
 * (`P5`). Callers MUST handle `null` by showing no status, never by
 * substituting a default.
 */
export type SyncHonestyClaim = SyncHonestyState | null;

/**
 * How each mutation status bears on the claim. ONE classification, used both to
 * build the Dexie read filter and to derive the state, so the two cannot drift.
 *
 * Being a `Record<MutationQueueStatus, ...>` makes this exhaustive at compile
 * time: a seventh status cannot be added without classifying it here. That
 * matters more than it looks — review round 1 found that a status which the
 * derivation would call `NEEDS_FIX` but which was missing from the read filter
 * would never be fetched, so the rows array would come back empty and the chip
 * would show a green receipt. The failure mode of an unclassified status must
 * never be "strongest claim by omission".
 */
type MutationStatusClass =
    /** the farmer must act; auto-retry will not save this */
    | 'NEEDS_FIX'
    /** on the phone, not yet acknowledged; the system is still working on it */
    | 'UNACKNOWLEDGED'
    /** settled — bears on no claim */
    | 'TERMINAL';

const MUTATION_STATUS_CLASS: Record<MutationQueueStatus, MutationStatusClass> = {
    PENDING: 'UNACKNOWLEDGED',
    SENDING: 'UNACKNOWLEDGED',
    // Below the retry cap the worker will try again unaided, so there is
    // nothing for the farmer to do. Promoted to NEEDS_FIX at/over the cap.
    FAILED: 'UNACKNOWLEDGED',
    // Durable rejection — deliberately never auto-retried (`MutationQueue.ts:229-231`).
    REJECTED_USER_REVIEW: 'NEEDS_FIX',
    APPLIED: 'TERMINAL',
    // The farmer explicitly discarded this through the conflict screen. An
    // acknowledged loss, not a silent one. Ruling R10 — do not reopen.
    REJECTED_DROPPED: 'TERMINAL',
};

/**
 * The mutation statuses a caller MUST read out of Dexie.
 *
 * Derived from the classification above rather than hand-written, so it can
 * never omit a status that would have changed the claim. `TERMINAL` rows are
 * excluded because they bear on nothing and `APPLIED` rows are never pruned —
 * fetching them would grow the query without ever changing its answer.
 */
export const SYNC_HONESTY_OPEN_STATUSES: readonly MutationQueueStatus[] =
    (Object.keys(MUTATION_STATUS_CLASS) as MutationQueueStatus[])
        .filter((status) => MUTATION_STATUS_CLASS[status] !== 'TERMINAL');

/**
 * The minimum a caller must read per mutation row. Deliberately NOT
 * `MutationQueueItem`: the chip has no business retaining whole payloads, and a
 * narrow shape keeps the tests free of Dexie.
 */
export interface SyncQueueRowSnapshot {
    status: MutationQueueStatus;
    retryCount: number;
}

/**
 * Everything the claim depends on, in one plain object.
 *
 * Attachment uploads and AI jobs are in here because the chip's numeric badge
 * already counts them (`AppHeader.tsx:181-182`). Review round 1 found that if
 * the label ignores them, `ON_SERVER` can render `पाठवलं ✓` beside a red "2"
 * from two permanently-failed photo uploads — the label and the badge
 * contradicting each other on the same 44x44 control. A failed upload is a real
 * incompleteness in the farmer's record, so it belongs in the claim.
 */
export interface SyncEvidenceSnapshot {
    /** Non-terminal mutation rows — see `SYNC_HONESTY_OPEN_STATUSES`. */
    rows: readonly SyncQueueRowSnapshot[];
    /**
     * Mutations from this device the server has ACKNOWLEDGED (`APPLIED`).
     * The one piece of positive evidence that `ON_SERVER` is allowed to rest on.
     */
    acknowledgedCount: number;
    /** Attachment uploads still in flight or waiting (`pending`/`uploading`/`retry_wait`). */
    pendingUploads: number;
    /**
     * Attachment uploads past their own retry cap. Terminal: the worker only
     * ever picks up `pending`/`retry_wait` (`AttachmentUploadWorker.ts:132`),
     * and `failed` is written only at `retryCount >= MAX_RETRY_COUNT` (`:257`).
     * So this is the upload-side twin of a capped mutation — NEEDS_FIX.
     */
    failedUploads: number;
    /** Voice/receipt AI jobs still queued or processing. */
    pendingAiJobs: number;
}

/**
 * The auto-retry cap, past which a `FAILED` row is stranded until the farmer
 * acts. Re-exported, NOT redefined — see the import at the top of this file.
 *
 * Kept on this module's surface so its four existing readers
 * (`stuckMutations.ts` and three test files) need no churn, and so a reader of
 * the chip's derivation can see the number it turns on without a second hop.
 */
export { MAX_AUTO_RETRY_COUNT };

/**
 * i18n keys for the three states. The SINGLE source of the state -> label
 * pairing: a renderer must index this by state, never restate the mapping.
 *
 * The chip is shared app-wide chrome whose other labels are English, so the
 * strings live in `i18n/translations.ts` and follow the farmer's language
 * preference (`R6`) rather than being hardcoded Marathi.
 */
export const SYNC_HONESTY_I18N_KEYS: Record<SyncHonestyState, string> = {
    ON_PHONE: 'sync.onPhone',
    ON_SERVER: 'sync.onServer',
    NEEDS_FIX: 'sync.needsFix',
};

/** An empty snapshot: nothing outstanding, nothing ever acknowledged. */
export const EMPTY_SYNC_EVIDENCE: SyncEvidenceSnapshot = {
    rows: [],
    acknowledgedCount: 0,
    pendingUploads: 0,
    failedUploads: 0,
    pendingAiJobs: 0,
};

/*
 * DELETED — `deriveSyncBadgeCounts`.
 *
 * It existed to give the label/badge agreement tests an oracle, and it was
 * written to "mirror `AppHeader.tsx:181-182` exactly". It stopped doing that
 * the moment T3 (ruling R12) redefined `useSyncQueueStatus.failedCount` as
 * "rows that need the farmer": a sub-cap `FAILED` row is now counted as
 * PENDING in production and this function still counted it as FAILED. It had
 * ZERO production importers, so nothing rendered wrong — but its test was
 * titled *"badge counts mirror AppHeader arithmetic exactly"* while asserting
 * the function against itself, which is precisely the "asserts the fixture,
 * not the code" defect finding F5 was raised for.
 *
 * Deleted rather than repaired, for three reasons:
 *   1. Zero production importers — it was test scaffolding wearing the costume
 *      of production code.
 *   2. Repairing it would create a SECOND implementation of a classification
 *      that already exists in production (`stuckMutations.needsFarmerAction`,
 *      consumed by `useSyncQueueStatus`). Two implementations of one rule is
 *      the drift that caused this in the first place.
 *   3. It could not delegate to `needsFarmerAction` anyway: `stuckMutations.ts`
 *      imports `MAX_AUTO_RETRY_COUNT` from here, so the delegation would be a
 *      circular import.
 *
 * The agreement invariant is NOT lost. It moved into
 * `__tests__/syncHonestyState.test.ts` as an explicit oracle that composes the
 * REAL production classifier with the literal `AppHeader` summation — a test
 * oracle that lives in a test file and says so.
 */

/**
 * Derives the one claim the app is allowed to make — or no claim at all.
 *
 * Weakest claim wins, in this order:
 *   1. anything the farmer must act on            -> `NEEDS_FIX`
 *   2. anything captured but not acknowledged     -> `ON_PHONE`
 *   3. nothing outstanding AND real evidence      -> `ON_SERVER`
 *   4. nothing outstanding and no evidence        -> `null` (say nothing)
 *
 * A retryable `FAILED` row (below the cap) is `ON_PHONE`, not `NEEDS_FIX`: the
 * record is safe on the handset and the worker will try again by itself, so
 * there is nothing for the farmer to do. Calling that "stuck" would swap a
 * silent failure for a *visible* one the farmer cannot act on, which is worse —
 * it teaches them the button does not work (`P5`).
 *
 * There is no "sending"/in-flight state by design. Whether a request is on the
 * wire is not something a farmer can act on, and a spinner beside a zero count
 * was the original defect in visual form.
 */
export function deriveSyncHonestyState(snapshot: SyncEvidenceSnapshot): SyncHonestyClaim {
    // 1. Does anything need the farmer?
    if (snapshot.failedUploads > 0) {
        return 'NEEDS_FIX';
    }

    let hasUnacknowledged = snapshot.pendingUploads > 0 || snapshot.pendingAiJobs > 0;

    for (const row of snapshot.rows) {
        const statusClass = MUTATION_STATUS_CLASS[row.status];

        if (statusClass === 'NEEDS_FIX') {
            return 'NEEDS_FIX';
        }

        if (statusClass === 'UNACKNOWLEDGED') {
            // The retry cap turns "we are still trying" into "we gave up".
            if (row.status === 'FAILED' && row.retryCount >= MAX_AUTO_RETRY_COUNT) {
                return 'NEEDS_FIX';
            }
            hasUnacknowledged = true;
        }
    }

    // 2. Anything captured but not yet acknowledged?
    if (hasUnacknowledged) {
        return 'ON_PHONE';
    }

    // 3. Nothing outstanding. `ON_SERVER` is a claim about the SERVER, so it
    //    needs the server to have said something. An empty queue on a device
    //    that never successfully pushed is not proof of delivery — it is proof
    //    of nothing, and it is exactly what a dropped-before-queueing log looks
    //    like from here.
    if (snapshot.acknowledgedCount > 0) {
        return 'ON_SERVER';
    }

    // 4. No claim. We have nothing to report, so we report nothing.
    return null;
}
