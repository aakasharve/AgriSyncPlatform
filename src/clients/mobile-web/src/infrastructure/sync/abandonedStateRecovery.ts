/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P0.7 — OWNS THE TWO IN-FLIGHT STATUSES NOTHING ELSE OWNS.
 *
 * WHAT WAS BROKEN
 * ---------------
 * When the app is killed mid-upload or mid-parse — the phone runs out of memory,
 * the farmer swipes it away, Android reclaims it — the row it was working on is
 * left in `uploading` / `processing` with no live worker behind it. Nothing in
 * the app reclaims those:
 *
 *   - `AttachmentUploadWorker` only ever picks up `pending` and `retry_wait`.
 *   - `AiJobWorker` only ever picks up `pending` and `failed`.
 *   - `UploadQueueRetry` touches only `failed`, ON PURPOSE (see below).
 *   - "Retry All" in the drawer goes to the mutation queue and `failed` uploads.
 *
 * So the row was terminal in a status the UI still counts as pending work. The
 * honesty chip said `अडकलं — तपासा` for ever, and every door it pointed at was
 * painted on — `P5`, the exact defect the honesty phase exists to remove. The
 * farmer's photo, or his spoken note, simply stopped.
 *
 * WHY THIS IS A NEW MODULE AND NOT A WIDENING OF `UploadQueueRetry`
 * ----------------------------------------------------------------
 * `UploadQueueRetry`'s narrow `failed`-only scope is DELIBERATE AND CORRECT: it
 * fires on a farmer's explicit tap, at a moment when a worker may well be
 * mid-upload, so it must not be able to yank a healthy row out from under one.
 * This wedge is unowned, not defended. Widening that function would trade one
 * defect for a worse one.
 *
 * WHY TOP-OF-CYCLE IS SAFE, AND WHY IT IS NOT "INSIDE THE CYCLE"
 * -------------------------------------------------------------
 * Each function below reclaims ONLY the tables its own worker writes, and is
 * called at the TOP of that worker's cycle, before the cycle takes anything in
 * hand. Both workers process items strictly sequentially inside one awaited
 * cycle and both refuse to re-enter while a cycle is in progress — so at that
 * instant the worker demonstrably holds nothing, and any row still sitting in an
 * in-flight status was left there by a session that is already dead.
 *
 * That is the whole safety argument, and it is why this must never be moved
 * further down. A reset placed among the items of a live cycle — or a reset that
 * reached across into the other worker's tables, whose timer is independent —
 * would reclaim rows that ARE genuinely in flight and upload them twice.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not delete anything, does not touch `failed`, and does not reset the
 * retry budget: a reclaimed row re-enters the queue with its history intact and
 * walks the same five-attempt budget. `lastError` is left in place for the same
 * reason `UploadQueueRetry` leaves it — it is the only record of what went
 * wrong, and tidying it away would be cosmetic amnesia (`P3`).
 */
import { getDatabase } from '../storage/DexieDatabase';
import { systemClock } from '../../core/domain/services/Clock';

/**
 * Reclaim attachment uploads abandoned by a dead session.
 *
 * BOTH TABLES, in one transaction. `processQueueItem` sets the queue row and the
 * attachment record to `uploading` together, so resetting only the queue would
 * leave the attachment wedged and the two stores disagreeing about the same
 * file — which is worse than the wedge, because the honesty surfaces read the
 * attachment.
 *
 * @returns how many queue rows were reclaimed, so a caller can log a real number.
 */
export async function reclaimAbandonedUploads(): Promise<number> {
    const db = getDatabase();
    const nowIso = systemClock.nowISO();

    return db.transaction('rw', [db.uploadQueue, db.attachments], async () => {
        const reclaimed = await db.uploadQueue
            .where('status')
            .equals('uploading')
            .modify({ status: 'pending', nextAttemptAt: undefined, updatedAt: nowIso });

        await db.attachments
            .where('status')
            .equals('uploading')
            .modify({ status: 'pending', updatedAt: nowIso });

        return reclaimed;
    });
}

/**
 * Reclaim AI jobs abandoned by a dead session.
 *
 * `nextRetryAfterMs` is cleared so the reclaimed job is due immediately: the
 * backoff it carried belonged to an attempt that never finished, and making the
 * farmer wait out a delay for a parse that never ran is a delay with no cause.
 *
 * @returns how many jobs were reclaimed.
 */
export async function reclaimAbandonedAiJobs(): Promise<number> {
    const db = getDatabase();

    return db.pendingAiJobs
        .where('status')
        .equals('processing')
        .modify({
            status: 'pending',
            updatedAt: systemClock.nowISO(),
            nextRetryAfterMs: undefined,
        });
}
