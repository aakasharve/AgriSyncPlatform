/**
 * Sub-plan 04 Task 5 — bridges OfflineConflictPage to the mutation queue
 * and the syncMachine.
 *
 * list()    — read FAILED rows from Dexie's mutationQueue.
 * retry()   — flip FAILED → PENDING and trigger a fresh worker cycle.
 * discard() — delete the row outright; user accepts the data loss.
 *
 * Both retry() and discard() emit CONFLICT_RESOLVED so the syncMachine
 * settles its state and the ConflictBadge updates immediately.
 */
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { getRootStore } from '../../../app/state/RootStore';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

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
        const db = getDatabase();
        const rows = await db.mutationQueue.where('status').equals('FAILED').toArray();
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
        await backgroundSyncWorker.retryFailed(mutationId);
        try {
            getRootStore().sync.send({ type: 'CONFLICT_RESOLVED', mutationId });
        } catch {
            // Actor not mounted — ignore.
        }
    }

    static async discard(mutationId: string): Promise<void> {
        const db = getDatabase();
        const row = await db.mutationQueue
            .where('clientRequestId')
            .equals(mutationId)
            .first();
        if (row?.id !== undefined) {
            await db.mutationQueue.delete(row.id);
        }
        try {
            getRootStore().sync.send({ type: 'CONFLICT_RESOLVED', mutationId });
        } catch {
            // Actor not mounted — ignore.
        }
    }

    private static hintFor(reason: string | undefined): string | undefined {
        switch (reason) {
            case 'CLIENT_TOO_OLD':
                return 'अॅप अपडेट करा आणि पुन्हा सिंक करा.';
            case 'MUTATION_TYPE_UNKNOWN':
                return 'या नोंदीचा प्रकार सर्व्हरला माहित नाही. आकाशला सांगा.';
            case 'MUTATION_TYPE_UNIMPLEMENTED':
                return 'सर्व्हरवर हा प्रकार अद्याप तयार नाही. नंतर पुन्हा प्रयत्न करा.';
            case 'NO_RESULT':
                return 'सर्व्हरकडून उत्तर मिळाले नाही. नेटवर्क तपासा.';
            default:
                return undefined;
        }
    }
}
