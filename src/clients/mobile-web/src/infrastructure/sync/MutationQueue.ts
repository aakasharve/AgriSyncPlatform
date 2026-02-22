import { getDatabase, type MutationQueueItem } from '../storage/DexieDatabase';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import type { SyncMutationType } from '../api/AgriSyncClient';

const DEVICE_ID_KEY = 'agrisync_device_id_v1';
const SYNC_SCOPE = 'shramsafal';
const LAST_PULL_META_KEY = 'shramsafal_last_pull_payload';

export interface SyncLocationPayload {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    altitude?: number;
    capturedAtUtc: string;
    provider: 'gps' | 'network' | 'fused' | 'unknown';
    permissionState: 'granted' | 'denied' | 'prompt';
}

const SUPPORTED_MUTATION_TYPES: ReadonlySet<SyncMutationType> = new Set([
    'create_farm',
    'create_plot',
    'create_crop_cycle',
    'create_daily_log',
    'add_log_task',
    'verify_log',
    'verify_log_v2',
    'add_cost_entry',
    'correct_cost_entry',
    'allocate_global_expense',
    'set_price_config',
    'create_attachment',
]);

function normalizeMutationType(mutationType: string): SyncMutationType {
    const normalized = mutationType.trim().toLowerCase();
    if (!SUPPORTED_MUTATION_TYPES.has(normalized as SyncMutationType)) {
        throw new Error(`Unsupported mutationType '${mutationType}'.`);
    }

    return normalized as SyncMutationType;
}

function ensureLocationField(payload: unknown): unknown {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload;
    }

    const candidate = payload as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(candidate, 'location')) {
        return payload;
    }

    return {
        ...candidate,
        location: null,
    };
}

function normalizePayloadForMutation(mutationType: SyncMutationType, payload: unknown): unknown {
    switch (mutationType) {
        case 'create_daily_log':
        case 'add_cost_entry':
            return ensureLocationField(payload);
        default:
            return payload;
    }
}

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
        options?: { clientRequestId?: string; deviceId?: string }
    ): Promise<string> {
        if (!mutationType || mutationType.trim().length === 0) {
            throw new Error('mutationType is required');
        }

        const db = getDatabase();
        const deviceId = options?.deviceId ?? getOrCreateDeviceId();
        const clientRequestId = options?.clientRequestId ?? idGenerator.generate();
        const now = systemClock.nowISO();
        const normalizedMutationType = normalizeMutationType(mutationType);
        const normalizedPayload = normalizePayloadForMutation(normalizedMutationType, payload);

        const record: MutationQueueItem = {
            deviceId,
            clientRequestId,
            mutationType: normalizedMutationType,
            payload: normalizedPayload,
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
        return db.mutationQueue
            .where('status')
            .equals('PENDING')
            .limit(limit)
            .toArray();
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
