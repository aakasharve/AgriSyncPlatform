/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T3.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `AttachmentUploadWorker` gives up on an upload at `retryCount >= 5` and
 * writes `status: 'failed'` (`AttachmentUploadWorker.ts:264,273`). That status
 * is TERMINAL: the worker only ever picks up `pending` and `retry_wait`
 * (`:132`), so nothing in the app ever looks at a `failed` upload again.
 *
 * Task T1 then made a failed upload force the header chip to `NEEDS_FIX` —
 * `अडकलं — तपासा`, "stuck, go check" (`syncHonestyState.ts:253-255`) — which
 * was the right call, because an unsent photo is a real hole in the farmer's
 * record. But it created the exact defect Phase 1 exists to remove: **the chip
 * shouted and there was no action anywhere in the app that could quiet it.**
 * The drawer counts failed uploads into its "N Failed" header
 * (`SyncStatusDrawer.tsx:117`) but its "Retry All" only ever touched the
 * mutation queue, and the Uploads section has no button at all. Every door was
 * painted on. `P5`.
 *
 * This module is the missing door. It is deliberately a standalone function
 * rather than a method on `AttachmentUploadWorker`, because
 * `AttachmentUploadWorker.ts:7` already imports `backgroundSyncWorker` — the
 * caller — and adding the reverse edge would put two module-scope singletons
 * in an import cycle.
 */
import { getDatabase } from '../storage/DexieDatabase';
import { systemClock } from '../../core/domain/services/Clock';

/**
 * Puts every terminally-failed attachment upload back in the queue.
 *
 * Mirrors the two-table write the worker itself performs when it gives up
 * (`AttachmentUploadWorker.ts:262-278`), in reverse: the queue row returns to
 * `pending` and the attachment record returns to `pending`, both with their
 * retry budget restored and the stale backoff cleared so the next worker cycle
 * (<= 10 s) picks them up immediately.
 *
 * `lastError` is left in place on purpose. It is the only record of what went
 * wrong, and erasing it to make the row look clean would be exactly the kind of
 * cosmetic amnesia this phase is removing (`P3` — correction is never silent).
 *
 * Bounded, not a loop: this runs only on an explicit farmer tap, and an upload
 * that fails again walks the same five-attempt budget back to `failed`.
 *
 * @returns how many uploads were re-queued, so the caller can report a real
 *          number instead of implying something it did not do.
 */
export async function resetFailedUploadsToPending(): Promise<number> {
    const db = getDatabase();
    const failed = await db.uploadQueue.where('status').equals('failed').toArray();
    if (failed.length === 0) {
        return 0;
    }

    const nowIso = systemClock.nowISO();
    let reset = 0;

    for (const item of failed) {
        if (item.autoId === undefined) continue;

        await db.transaction('rw', [db.uploadQueue, db.attachments], async () => {
            await db.uploadQueue.update(item.autoId as number, {
                status: 'pending',
                retryCount: 0,
                nextAttemptAt: undefined,
                updatedAt: nowIso,
            });

            const attachment = await db.attachments.get(item.attachmentId);
            if (attachment) {
                await db.attachments.update(item.attachmentId, {
                    status: 'pending',
                    retryCount: 0,
                    updatedAt: nowIso,
                });
            }
        });

        reset += 1;
    }

    return reset;
}
