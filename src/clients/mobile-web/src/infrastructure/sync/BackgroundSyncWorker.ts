import { mutationQueue } from './MutationQueue';
import { systemClock } from '../../core/domain/services/Clock';
import { agriSyncClient, type SyncMutationType } from '../api/AgriSyncClient';
import { getAuthSession } from '../api/AuthTokenStore';
import { reconcileSyncPull } from './SyncPullReconciler';
import { getDatabase } from '../storage/DexieDatabase';

function toSyncMutationType(mutationType: string): SyncMutationType | null {
    const normalized = mutationType.trim().toLowerCase();
    switch (normalized) {
        case 'create_farm':
        case 'create_plot':
        case 'create_crop_cycle':
        case 'create_daily_log':
        case 'add_log_task':
        case 'verify_log':
        case 'verify_log_v2':
        case 'add_cost_entry':
        case 'correct_cost_entry':
        case 'allocate_global_expense':
        case 'set_price_config':
            return normalized;
        default:
            return null;
    }
}

export class BackgroundSyncWorker {
    private static instance: BackgroundSyncWorker;
    private readonly intervalMs = 15000;
    private timerId: number | null = null;
    private isRunning = false;
    private cycleInProgress = false;

    private constructor() { }

    static getInstance(): BackgroundSyncWorker {
        if (!BackgroundSyncWorker.instance) {
            BackgroundSyncWorker.instance = new BackgroundSyncWorker();
        }
        return BackgroundSyncWorker.instance;
    }

    start() {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        this.safeRunCycle();

        this.timerId = window.setInterval(() => {
            this.safeRunCycle();
        }, this.intervalMs);

        window.addEventListener('online', this.handleOnline);
    }

    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        if (this.timerId !== null) {
            window.clearInterval(this.timerId);
            this.timerId = null;
        }

        window.removeEventListener('online', this.handleOnline);
    }

    async triggerNow(): Promise<void> {
        await this.safeRunCycle();
    }

    async retryFailed(clientRequestId: string): Promise<void> {
        const db = getDatabase();
        const failedItem = await db.mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), clientRequestId])
            .first();

        if (failedItem?.id && failedItem.status === 'FAILED') {
            await db.mutationQueue.update(failedItem.id, {
                status: 'PENDING',
                updatedAt: systemClock.nowISO(),
            });
            await this.triggerNow();
        }
    }

    async retryAllFailed(): Promise<void> {
        await mutationQueue.markFailedAsPending();
        await this.triggerNow();
    }

    private handleOnline = () => {
        this.safeRunCycle();
    };

    private async safeRunCycle(): Promise<void> {
        if (!this.isRunning || this.cycleInProgress) {
            return;
        }

        if (!getAuthSession()) {
            return;
        }

        if (!navigator.onLine) {
            return;
        }

        this.cycleInProgress = true;
        try {
            await mutationQueue.resetInFlightMutations();
            await mutationQueue.markFailedAsPending();
            await this.pushPendingMutations();
            await this.pullLatestDeltas();
        } catch (error) {
            console.error('[BackgroundSyncWorker] Sync cycle failed', error);
        } finally {
            this.cycleInProgress = false;
        }
    }

    private async pushPendingMutations(): Promise<void> {
        const pending = await mutationQueue.getPending(50);
        if (pending.length === 0) {
            return;
        }

        const pendingWithId = pending.filter(item => item.id !== undefined);
        if (pendingWithId.length === 0) {
            return;
        }

        const supportedMutations: Array<{ id: number; clientRequestId: string; clientCommandId?: string; mutationType: SyncMutationType; payload: unknown }> = [];
        for (const mutation of pendingWithId) {
            const mutationType = toSyncMutationType(mutation.mutationType);
            if (!mutationType) {
                await mutationQueue.markFailed(mutation.id as number, `Unsupported mutationType '${mutation.mutationType}'.`);
                continue;
            }

            supportedMutations.push({
                id: mutation.id as number,
                clientRequestId: mutation.clientRequestId,
                clientCommandId: mutation.clientCommandId,
                mutationType,
                payload: mutation.payload,
            });
        }

        if (supportedMutations.length === 0) {
            return;
        }

        for (const mutation of supportedMutations) {
            await mutationQueue.markSending(mutation.id as number);
        }

        try {
            const body = await agriSyncClient.pushSyncBatch({
                deviceId: mutationQueue.getDeviceId(),
                mutations: supportedMutations.map(item => ({
                    clientRequestId: item.clientRequestId,
                    clientCommandId: item.clientCommandId ?? item.clientRequestId,
                    mutationType: item.mutationType,
                    payload: item.payload,
                })),
            });
            const byClientRequestId = new Map(
                body.results.map(result => [result.clientRequestId, result]));

            for (const mutation of supportedMutations) {
                const mutationId = mutation.id as number;
                const result = byClientRequestId.get(mutation.clientRequestId);

                if (!result) {
                    await mutationQueue.markFailed(mutationId, 'No push result returned for mutation.');
                    continue;
                }

                if (result.status === 'applied' || result.status === 'duplicate') {
                    await mutationQueue.markApplied(mutationId);
                    continue;
                }

                const errorMessage = result.errorMessage ?? result.errorCode ?? 'Unknown sync error';
                await mutationQueue.markFailed(mutationId, errorMessage);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown push error';
            for (const mutation of supportedMutations) {
                await mutationQueue.markFailed(mutation.id as number, message);
            }
        }
    }

    private async pullLatestDeltas(): Promise<void> {
        const sinceCursor = await mutationQueue.getCursor() ?? new Date(0).toISOString();
        const payload = await agriSyncClient.pullSyncChanges(sinceCursor);
        await mutationQueue.saveLastPullPayload(payload);
        await reconcileSyncPull(payload);

        const nextCursor = payload.nextCursorUtc || payload.serverTimeUtc || systemClock.nowISO();
        await mutationQueue.setCursor(nextCursor);
    }
}

export const backgroundSyncWorker = BackgroundSyncWorker.getInstance();
