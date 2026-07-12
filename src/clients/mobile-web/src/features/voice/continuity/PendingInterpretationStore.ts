import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { PendingInterpretationRecord, PendingInterpretationStatus } from './pendingInterpretation';

/** Thin Dexie repo over the `pendingInterpretations` store (schema v23). */
export class PendingInterpretationStore {
    private static instance: PendingInterpretationStore | null = null;

    static getInstance(): PendingInterpretationStore {
        if (!PendingInterpretationStore.instance) {
            PendingInterpretationStore.instance = new PendingInterpretationStore();
        }
        return PendingInterpretationStore.instance;
    }

    async persist(record: PendingInterpretationRecord): Promise<void> {
        await getDatabase().pendingInterpretations.put(record);
    }

    async get(captureId: string): Promise<PendingInterpretationRecord | undefined> {
        return getDatabase().pendingInterpretations.get(captureId);
    }

    /** Pending captures, oldest first (FIFO drain order). */
    async listPending(): Promise<PendingInterpretationRecord[]> {
        return getDatabase().pendingInterpretations
            .where('status').equals('pending')
            .sortBy('createdAtUtc');
    }

    async markStatus(
        captureId: string,
        status: PendingInterpretationStatus,
        opts?: { incrementAttempt?: boolean; attemptAtUtc?: number },
    ): Promise<void> {
        const db = getDatabase();
        const existing = await db.pendingInterpretations.get(captureId);
        if (!existing) return;
        await db.pendingInterpretations.put({
            ...existing,
            status,
            attempts: opts?.incrementAttempt ? existing.attempts + 1 : existing.attempts,
            lastAttemptAtUtc: opts?.attemptAtUtc ?? existing.lastAttemptAtUtc,
        });
    }

    async remove(captureId: string): Promise<void> {
        await getDatabase().pendingInterpretations.delete(captureId);
    }
}
