import { mutationQueue } from './MutationQueue';
import { systemClock } from '../../core/domain/services/Clock';
import { agriSyncClient } from '../api/AgriSyncClient';
import { getAuthSession } from '../api/AuthTokenStore';
import { reconcileSyncPull } from './SyncPullReconciler';

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

        for (const mutation of pendingWithId) {
            await mutationQueue.markSending(mutation.id as number);
        }

        try {
            const body = await agriSyncClient.pushSyncBatch({
                deviceId: mutationQueue.getDeviceId(),
                mutations: pendingWithId.map(item => ({
                    clientRequestId: item.clientRequestId,
                    mutationType: item.mutationType,
                    payload: item.payload,
                })),
            });
            const byClientRequestId = new Map(
                body.results.map(result => [result.clientRequestId, result]));

            for (const mutation of pendingWithId) {
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
            for (const mutation of pendingWithId) {
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
