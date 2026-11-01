/**
 * Sub-plan 04 Task 5 + T-IGH-04-CONFLICT-STATUS-DURABILITY — bridges
 * OfflineConflictPage to the mutation queue and the syncMachine.
 *
 * list()    — read REJECTED_USER_REVIEW rows. Transient FAILED rows are
 *             auto-retried by the worker and are NOT user-actionable, so
 *             they're excluded.
 * retry()   — flip REJECTED_USER_REVIEW → PENDING and trigger a fresh
 *             worker cycle. The categorization may re-fire on the next
 *             cycle (server may still reject permanently); that's OK —
 *             the row will land back in REJECTED_USER_REVIEW with an
 *             updated reason.
 * discard() — soft-delete: flip → REJECTED_DROPPED. The row is kept for
 *             audit / Sub-plan 05 E2E assertion but never returned by
 *             list() or getPending(). User has accepted the data loss.
 *
 * Both retry() and discard() emit CONFLICT_RESOLVED so the syncMachine
 * settles its state and the ConflictBadge updates immediately.
 */
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { getRootStore } from '../../../app/state/RootStore';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';
import { getEditSurface } from './EditSurfaceRegistry';
import { refusalHintForRow, refusalReasonOf } from '../../logs/components/correction/refusedRevision';
import { applyPendingWithdrawals } from '../pull/reconcilers/withdrawnRecordsReconciler';
import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import {
    DEPENDENCY_PARENT_UNRESOLVED_CODE,
    DEPENDENCY_PLOT_UNRESOLVED_CODE,
} from '../../../infrastructure/sync/MutationDependency';

/** spec: pre-launch-repair L2b (R-1) — `ShramSafalErrors.CostEntryIdConflict`; normalises to CONFLICT (PERMANENT). */
export const COST_ENTRY_ID_CONFLICT_CODE = 'ShramSafal.CostEntry.Conflict';

export interface RejectedMutationView {
    mutationId: string;
    mutationType: string;
    capturedAt: string;
    reason: string;
    hint?: string;
    payloadPreview: string;
    /**
     * lane PRV fix pass 1 (M6) — refused because the record's audience no longer includes him
     * (`ShramSafal.RecordAudience.Forbidden`): sending it again cannot succeed, so the page shows only the rule's
     * words (`hint`) and offers only "discard". Until he discards it, the record stays on his phone (P10).
     */
    closedByRule?: boolean;
}

const MAX_PAYLOAD_PREVIEW = 160;

export class ConflictResolutionService {
    /**
     * Everything the farmer can actually act on.
     *
     * §P0.7 box 2d — THIS USED TO READ ONE OF THE TWO STUCK SETS.
     *
     * `getRejectedUserReview()` alone meant a `FAILED` row that had exhausted
     * its auto-retry cap never appeared here. That row is just as stuck —
     * `markFailedAsPending` will not touch it again — and the header chip has
     * always said so, rendering `NEEDS_FIX` and sending the farmer to a screen
     * that then told them everything was synced. A chip that promises a fix and
     * routes to an empty list is worse than no chip: it teaches the farmer that
     * the app's own alarms mean nothing (`P5`).
     *
     * Both remedies already work on these rows. `retry()` falls through to
     * `backgroundSyncWorker.retryFailed`, which ignores the cap by design, and
     * `discard()` soft-deletes any row. So this is a read widening, not a new
     * capability — which is exactly why the gap survived: nothing was missing
     * except the rows.
     */
    static async list(language?: string | null): Promise<RejectedMutationView[]> {
        const [rejected, capExhausted] = await Promise.all([
            mutationQueue.getRejectedUserReview(),
            mutationQueue.getCapExhaustedFailed(),
        ]);

        const rows = [...rejected, ...capExhausted].sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
        // Lane OF-S fix pass 3 (R2-3) — a refused move's reason is read as it really stands on this phone (its money).
        const hints = await Promise.all(rows.map(r => refusalHintForRow(r, language)));
        return rows
            .map((r, index) => {
                const payloadJson = (() => {
                    try {
                        return JSON.stringify(r.payload);
                    } catch {
                        return '<unserializable>';
                    }
                })();
                return {
                    mutationId: r.clientRequestId,
                    mutationType: r.mutationType,
                    capturedAt: r.createdAt,
                    reason: r.lastError ?? 'UNKNOWN',
                    // Lane OF-S fix 1 (B011): a refused move / worker count / future-day create says why in plain
                    // words, in his language; every other row keeps the hints below.
                    hint: hints[index] ?? this.hintFor(r.lastError, r.status === 'FAILED', r.errorCode),
                    payloadPreview: payloadJson.slice(0, MAX_PAYLOAD_PREVIEW),
                    closedByRule: refusalReasonOf(r.errorCode) === 'recordClosed',
                };
            });
    }

    static async retry(mutationId: string): Promise<void> {
        const db = getDatabase();
        // Find the REJECTED_USER_REVIEW row by clientRequestId.
        const row = await db.mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), mutationId])
            .first();

        if (row?.id !== undefined && row.status === 'REJECTED_USER_REVIEW') {
            // Flip back to PENDING so the next worker cycle picks it up.
            // markFailedAsPending only handles FAILED, so we do this
            // transition directly.
            await db.mutationQueue.update(row.id, {
                status: 'PENDING',
                updatedAt: systemClock.nowISO(),
            });
            // §P0.7 box 2c — a tap means now; clear any earned backoff so
            // `triggerNow()` can actually pick this row up.
            await mutationQueue.clearBackoff(row.id);
            await backgroundSyncWorker.triggerNow();
        } else {
            // Fall back to the legacy path (for older FAILED rows that
            // pre-date the durability migration, until they drain).
            await backgroundSyncWorker.retryFailed(mutationId);
        }

        try {
            getRootStore().sync.send({ type: 'CONFLICT_RESOLVED', mutationId });
        } catch {
            // Actor not mounted — ignore.
        }
    }

    /**
     * T-IGH-04-CONFLICT-EDIT: route a rejected mutation to its registered
     * edit surface so the user can correct the payload and retry.
     *
     * Looks up the row by mutationId (= clientRequestId), then looks up the
     * EditSurfaceRegistry for that mutationType and invokes the handler with
     * the current payload. Types without a registered surface fall through to
     * the `escalateToOwner` sentinel (Marathi dialog + escalate event).
     *
     * No-op if the row does not exist.
     */
    static async edit(mutationId: string): Promise<void> {
        const db = getDatabase();
        const row = await db.mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), mutationId])
            .first();

        if (!row) return;

        const handler = getEditSurface(row.mutationType);
        if (!handler) return;

        handler({
            mutationId,
            mutationType: row.mutationType,
            payload: row.payload,
        });
    }

    static async discard(mutationId: string): Promise<void> {
        const db = getDatabase();
        const row = await db.mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), mutationId])
            .first();

        if (row?.id !== undefined) {
            // Soft-delete: keep the row for audit + E2E assertion.
            // Never returned by list() or getPending().
            await mutationQueue.markRejectedDropped(row.id);
            // lane PRV fix pass 1 (M6) — the change no longer holds its record: a withdrawal it held back applies now.
            try {
                const outcome = await applyPendingWithdrawals(db, getAuthSession()?.userId ?? null, systemClock.nowISO());
                if (outcome.removedLogs + outcome.removedMoney > 0 && typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('agrisync:sync-reconciled'));
                }
            } catch (error) {
                console.warn('ConflictResolutionService.discard: the held withdrawals could not be applied now; the next sync applies them', error);
            }
        }

        try {
            getRootStore().sync.send({ type: 'CONFLICT_RESOLVED', mutationId });
        } catch {
            // Actor not mounted — ignore.
        }
    }

    private static hintFor(reason: string | undefined, autoRetriesExhausted = false, errorCode?: string): string | undefined {
        // spec: pre-launch-repair L2b (R-1) — the server holds this money entry's id on ANOTHER farm or for
        // another person, so it refused the entry instead of saving it twice. Re-sending cannot change that.
        // PROPOSED (Marathi)
        if (errorCode === COST_ENTRY_ID_CONFLICT_CODE) {
            return 'हीच खर्चाची नोंद दुसऱ्या शेतावर किंवा दुसऱ्या व्यक्तीच्या नावाने आधीच आहे. ती पुन्हा पाठवली जाणार नाही — श्रम सफलच्या नंबरला कॉल करा.';
        }
        if (!reason) {
            // §P0.7 box 2d — a cap-exhausted row can reach this screen with no
            // `lastError` at all (a batch that omitted it never produced one).
            // Say the one true thing there is to say rather than nothing: the
            // app has stopped trying and the farmer's tap is what restarts it.
            return autoRetriesExhausted
                ? 'अॅपने पुन्हा पाठवणे थांबवले आहे. तपासा आणि पुन्हा प्रयत्न करा.'
                : undefined;
        }
        const upper = reason.toUpperCase();
        if (upper.includes(DEPENDENCY_PARENT_UNRESOLVED_CODE)) {
            // §P0.7 box 2a — the parent log is named in `reason` itself; this
            // says what to do about it.
            return 'ही नोंद ज्या दैनंदिन नोंदीशी जोडली आहे ती सर्व्हरवर पोहोचली नाही. आधी ती नोंद तपासा.';
        }
        if (upper.includes(DEPENDENCY_PLOT_UNRESOLVED_CODE)) {
            // spec: plr-d10-redesign-real-integration (I9 — X3) — the plot made on this
            // phone that the log is on was refused; the plot is named in `reason`.
            return 'ही नोंद ज्या नवीन प्लॉटवर आहे तो प्लॉट सर्व्हरवर पोहोचला नाही. आधी तो प्लॉट तपासा.';
        }
        if (upper.includes('CLIENT_TOO_OLD') || upper.includes('CLIENT_OUTDATED')) {
            return 'अॅप अपडेट करा आणि पुन्हा सिंक करा.';
        }
        if (upper.includes('MUTATION_TYPE_UNKNOWN')) {
            return 'या नोंदीचा प्रकार सर्व्हरला माहित नाही. आकाशला सांगा.';
        }
        if (upper.includes('MUTATION_TYPE_UNIMPLEMENTED')) {
            return 'सर्व्हरवर हा प्रकार अद्याप तयार नाही. नंतर पुन्हा प्रयत्न करा.';
        }
        if (upper.includes('FORBIDDEN') || upper.includes('UNAUTHORIZED')) {
            return 'या कामासाठी आपली परवानगी नाही. श्रम सफलच्या नंबरला कॉल करा.';
        }
        if (upper.includes('VALIDATION') || upper.includes('INVALID_COMMAND') || upper.includes('INVALID_PAYLOAD')) {
            return 'माहिती तपासा. नंतर बदल करून पुन्हा प्रयत्न करा.';
        }
        if (autoRetriesExhausted) {
            return 'अॅपने पुन्हा पाठवणे थांबवले आहे. तपासा आणि पुन्हा प्रयत्न करा.';
        }
        return undefined;
    }
}
