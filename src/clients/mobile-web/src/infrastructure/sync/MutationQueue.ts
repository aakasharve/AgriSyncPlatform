import { getDatabase, type MutationQueueItem } from '../storage/DexieDatabase';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import type { SyncMutationType } from '../api/AgriSyncClient';
import { isSyncMutationType } from './SyncMutationCatalog';
import { validatePayload } from './PayloadValidator';

const DEVICE_ID_KEY = 'agrisync_device_id_v1';
const SYNC_SCOPE = 'shramsafal';
const LAST_PULL_META_KEY = 'shramsafal_last_pull_payload';

function getOrCreateDeviceId(): string {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
        return existing;
    }

    const created = idGenerator.generate();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
}

export class MutationQueue {
    private static instance: MutationQueue;

    private constructor() { }

    static getInstance(): MutationQueue {
        if (!MutationQueue.instance) {
            MutationQueue.instance = new MutationQueue();
        }
        return MutationQueue.instance;
    }

    getDeviceId(): string {
        return getOrCreateDeviceId();
    }

    async enqueue(
        mutationType: SyncMutationType,
        payload: unknown,
        options?: { clientRequestId?: string; clientCommandId?: string; deviceId?: string }
    ): Promise<string> {
        if (!mutationType || mutationType.trim().length === 0) {
            throw new Error('mutationType is required');
        }

        const normalizedMutationType = mutationType.trim();
        if (!isSyncMutationType(normalizedMutationType)) {
            throw new Error(`Unsupported mutationType '${normalizedMutationType}'.`);
        }

        // Sub-plan 02 Task 9: catch malformed payloads at the offline boundary.
        // Mutations with z.unknown() scaffolds (T-IGH-02-PAYLOADS) accept anything;
        // strict-typed mutations (create_daily_log, verify_log_v2, add_cost_entry,
        // create_attachment) reject with a typed error here instead of silently
        // failing later at the server.
        const validation = validatePayload(normalizedMutationType, payload);
        if (!validation.ok) {
            throw new Error(
                `Payload validation failed for ${normalizedMutationType}: ` +
                validation.errors.map((e) => `${e.path || '<root>'} ${e.message}`).join('; ')
            );
        }

        const db = getDatabase();
        const deviceId = options?.deviceId ?? getOrCreateDeviceId();
        const clientRequestId = options?.clientRequestId ?? idGenerator.generate();
        const clientCommandId = options?.clientCommandId ?? clientRequestId;
        const now = systemClock.nowISO();

        const record: MutationQueueItem = {
            deviceId,
            clientRequestId,
            clientCommandId,
            mutationType: normalizedMutationType,
            payload,
            status: 'PENDING',
            createdAt: now,
            updatedAt: now,
            retryCount: 0,
        };

        try {
            await db.mutationQueue.add(record);
            return clientRequestId;
        } catch (error) {
            const existing = await db.mutationQueue
                .where('[deviceId+clientRequestId]')
                .equals([deviceId, clientRequestId])
                .first();

            if (existing) {
                return clientRequestId;
            }

            throw error;
        }
    }

    async getPending(limit = 50): Promise<MutationQueueItem[]> {
        const db = getDatabase();
        const items = await db.mutationQueue
            .where('status')
            .equals('PENDING')
            .limit(limit)
            .toArray();

        return items.sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
    }

    async markSending(id: number): Promise<void> {
        const db = getDatabase();
        await db.mutationQueue.update(id, {
            status: 'SENDING',
            updatedAt: systemClock.nowISO(),
        });
    }

    async markApplied(id: number): Promise<void> {
        const db = getDatabase();
        await db.mutationQueue.update(id, {
            status: 'APPLIED',
            updatedAt: systemClock.nowISO(),
            lastError: undefined,
        });
    }

    async markFailed(id: number, error: string): Promise<void> {
        const db = getDatabase();
        const existing = await db.mutationQueue.get(id);
        await db.mutationQueue.update(id, {
            status: 'FAILED',
            updatedAt: systemClock.nowISO(),
            retryCount: (existing?.retryCount ?? 0) + 1,
            lastError: error,
        });
    }

    /**
     * Sub-plan 04 / T-IGH-04-CONFLICT-STATUS-DURABILITY: mark a row as
     * durably rejected. The row will NOT be picked up by markFailedAsPending —
     * the user must explicitly retry or discard via OfflineConflictPage.
     */
    async markRejectedUserReview(id: number, error: string): Promise<void> {
        const db = getDatabase();
        const existing = await db.mutationQueue.get(id);
        await db.mutationQueue.update(id, {
            status: 'REJECTED_USER_REVIEW',
            updatedAt: systemClock.nowISO(),
            retryCount: (existing?.retryCount ?? 0) + 1,
            lastError: error,
        });
    }

    /**
     * Soft-delete: user explicitly chose to drop a REJECTED_USER_REVIEW row.
     * Kept for audit + Sub-plan 05 E2E assertion. Never returned by
     * getPending(); never included in the conflict UI list().
     */
    async markRejectedDropped(id: number): Promise<void> {
        const db = getDatabase();
        await db.mutationQueue.update(id, {
            status: 'REJECTED_DROPPED',
            updatedAt: systemClock.nowISO(),
        });
    }

    /**
     * Returns the rows that need user attention (durable rejections).
     * Used by ConflictResolutionService.list().
     */
    async getRejectedUserReview(): Promise<MutationQueueItem[]> {
        const db = getDatabase();
        const items = await db.mutationQueue
            .where('status')
            .equals('REJECTED_USER_REVIEW')
            .toArray();
        return items.sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
    }

    /**
     * Auto-retry path. Filters strictly by status === 'FAILED' so durable
     * REJECTED_USER_REVIEW and REJECTED_DROPPED rows are NEVER auto-retried.
     */
    async markFailedAsPending(maxRetryCount = 5): Promise<void> {
        const db = getDatabase();
        const failed = await db.mutationQueue.where('status').equals('FAILED').toArray();

        for (const item of failed) {
            if (!item.id) continue;
            if (item.retryCount >= maxRetryCount) continue;

            await db.mutationQueue.update(item.id, {
                status: 'PENDING',
                updatedAt: systemClock.nowISO(),
            });
        }
    }

    async resetInFlightMutations(): Promise<void> {
        const db = getDatabase();
        const inFlight = await db.mutationQueue.where('status').equals('SENDING').toArray();

        for (const item of inFlight) {
            if (!item.id) continue;
            await db.mutationQueue.update(item.id, {
                status: 'PENDING',
                updatedAt: systemClock.nowISO(),
            });
        }
    }

    async getCursor(scope = SYNC_SCOPE): Promise<string | undefined> {
        const db = getDatabase();
        const cursor = await db.syncCursors.get(scope);
        return cursor?.serverCursor ?? cursor?.lastSyncAt;
    }

    async setCursor(cursorIso: string, scope = SYNC_SCOPE): Promise<void> {
        const db = getDatabase();
        await db.syncCursors.put({
            tableName: scope,
            lastSyncAt: systemClock.nowISO(),
            serverCursor: cursorIso,
            version: 1,
        });
    }

    async saveLastPullPayload(payload: unknown): Promise<void> {
        const db = getDatabase();
        await db.appMeta.put({
            key: LAST_PULL_META_KEY,
            value: payload,
            updatedAt: systemClock.nowISO(),
        });
    }
}

export const mutationQueue = MutationQueue.getInstance();
