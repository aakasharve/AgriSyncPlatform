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
import { getEditSurface, escalateToOwner } from './EditSurfaceRegistry';

export interface RejectedMutationView {
    mutationId: string;
    mutationType: string;
    capturedAt: string;
    reason: string;
    hint?: string;
    payloadPreview: string;
}

const MAX_PAYLOAD_PREVIEW = 160;

export class ConflictResolutionService {
    static async list(): Promise<RejectedMutationView[]> {
        const rows = await mutationQueue.getRejectedUserReview();
        return rows.map(r => {
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
                hint: this.hintFor(r.lastError),
                payloadPreview: payloadJson.slice(0, MAX_PAYLOAD_PREVIEW),
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
     * T-IGH-04-CONFLICT-EDIT — load the rejected mutation, look up the
     * matching edit surface in `EditSurfaceRegistry`, and invoke the
     * registered handler with the original payload. The handler is
     * responsible for routing the user to the input surface and seeding
     * it; once the user submits, the surface is expected to call
     * `MutationQueue.replacePayload(mutationId, newPayload)` to mutate
     * the queued row in place (rather than enqueueing a duplicate).
     *
     * If no surface is registered we fall back to the `escalateToOwner`
     * sentinel so the user always gets some affordance.
     */
    static async edit(mutationId: string): Promise<void> {
        const db = getDatabase();
        const row = await db.mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), mutationId])
            .first();

        if (!row) {
            // Row evaporated (e.g., another tab discarded it). Nothing to edit.
            return;
        }

        const handler = getEditSurface(row.mutationType) ?? escalateToOwner;
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
        }

        try {
            getRootStore().sync.send({ type: 'CONFLICT_RESOLVED', mutationId });
        } catch {
            // Actor not mounted — ignore.
        }
    }

    private static hintFor(reason: string | undefined): string | undefined {
        if (!reason) return undefined;
        const upper = reason.toUpperCase();
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
            return 'या नोंदीसाठी आपली परवानगी नाही. आकाशला सांगा.';
        }
        if (upper.includes('VALIDATION') || upper.includes('INVALID_COMMAND') || upper.includes('INVALID_PAYLOAD')) {
            return 'नोंदीची माहिती तपासा. नंतर बदल करून पुन्हा प्रयत्न करा.';
        }
        return undefined;
    }
}
