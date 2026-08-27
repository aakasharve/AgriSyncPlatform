import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { assertCoreConsentForVoiceStorage } from '../../consent/separation/coreConsentGate';
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

    /**
     * spec: dfes-companion-2026-07-11 (wave-4.3) — <b>never store a voice clip before
     * core consent.</b>
     *
     * This method is the one place a farmer's raw audio becomes DURABLE on the device, so
     * the rule lives here rather than on the screen that calls it. A screen check is one a
     * future caller routes around, and the callers of this store are precisely the ones
     * that run without a screen: the drain worker, the offline retry, the background
     * re-interpretation.
     *
     * Only a record CARRYING AUDIO is gated. A transcript-only capture is words the
     * farmer chose to give and is part of creating his work record, which core consent
     * covers; blocking that on the same rule would silently lose an offline day's log.
     * Throwing rather than dropping: the caller must handle it, and the honest handling
     * is to keep the log and not the clip.
     */
    async persist(record: PendingInterpretationRecord): Promise<void> {
        if (record.audioBase64) {
            await assertCoreConsentForVoiceStorage('a voice capture');
        }
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
