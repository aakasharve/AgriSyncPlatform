import { mutationQueue } from './MutationQueue';
import { systemClock } from '../../core/domain/services/Clock';
import { agriSyncClient, type SyncMutationType } from '../api/AgriSyncClient';
import { getAuthSession } from '../storage/AuthTokenStore';
import { reconcileSyncPull } from '../../features/sync/pull/SyncPullReconciler';
import { getDatabase } from '../storage/DexieDatabase';
import { AiJobWorker } from './AiJobWorker';
import { isSyncMutationType } from './SyncMutationCatalog';
import { getRootStore } from '../../app/state/RootStore';
import { categorizeRejection } from './RejectionPolicy';

// Sub-plan 04 Task 4 — bridge worker → syncMachine. Wrapped so the worker
// never crashes if the root store hasn't been instantiated (e.g., during
// early app boot before AppContent mounts).
function notifySync(event: Parameters<ReturnType<typeof getRootStore>['sync']['send']>[0]): void {
    try {
        getRootStore().sync.send(event);
    } catch {
        // Actor not ready or already torn down; ignore.
    }
}

function toSyncMutationType(mutationType: string): SyncMutationType | null {
    // Catalog names are case-sensitive — `compliance.acknowledge` and
    // `jobcard.create` already use lowercase. The previous `.toLowerCase()`
    // would corrupt any future PascalCase or kebab-case mutation, so it's
    // dropped. Validation goes through the canonical catalog set, which
    // is generated from sync-contract/schemas/mutation-types.json.
    const normalized = mutationType.trim();
    return isSyncMutationType(normalized) ? normalized : null;
}

export class BackgroundSyncWorker {
    private static instance: BackgroundSyncWorker;
    private readonly intervalMs = 15000;
    private timerId: number | null = null;
    private isRunning = false;
    private currentCycle: Promise<void> = Promise.resolve();

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
        await this.safeRunCycle(true);
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

    private async safeRunCycle(forceRun: boolean = false): Promise<void> {
        if (!this.isRunning && !forceRun) {
            return this.currentCycle;
        }

        const syncCycleId = crypto.randomUUID();
        this.currentCycle = this.currentCycle
            .then(async () => {
                if (!this.isRunning && !forceRun) {
                    return;
                }

                if (!getAuthSession() || !navigator.onLine) {
                    return;
                }

                await this.executeCycle();
            })
            .catch((error) => {
                console.error(JSON.stringify({
                    level: 'error',
                    component: 'BackgroundSyncWorker',
                    syncCycleId,
                    message: 'Sync cycle failed',
                    error: error instanceof Error
                        ? { message: error.message, stack: error.stack }
                        : String(error),
                    timestamp: new Date().toISOString(),
                }));
            });

        return this.currentCycle;
    }

    private async executeCycle(): Promise<void> {
        notifySync({ type: 'TRIGGER' });
        try {
            await mutationQueue.resetInFlightMutations();
            // markFailedAsPending only flips status === 'FAILED' rows back to
            // PENDING. REJECTED_USER_REVIEW and REJECTED_DROPPED are durable
            // and stay put across cycles per T-IGH-04-CONFLICT-STATUS-DURABILITY.
            await mutationQueue.markFailedAsPending();
            await this.pushPendingMutations();
            await this.pullLatestDeltas();
            await AiJobWorker.run();
            notifySync({ type: 'SYNC_DONE' });
        } catch (error) {
            // Per-mutation rejections were already emitted inside
            // pushPendingMutations; emit SYNC_DONE so the actor can settle
            // its state regardless of cycle-level failure.
            notifySync({ type: 'SYNC_DONE' });
            throw error;
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
                    // No-result is transient — server didn't respond for
                    // this row. Mark FAILED so auto-retry tries again next
                    // cycle. Do NOT churn the syncMachine for transients.
                    await mutationQueue.markFailed(mutationId, 'No push result returned for mutation.');
                    continue;
                }

                if (result.status === 'applied' || result.status === 'duplicate') {
                    await mutationQueue.markApplied(mutationId);
                    continue;
                }

                // Server-rejected. T-IGH-04-CONFLICT-STATUS-DURABILITY:
                // categorize via RejectionPolicy. Permanent → durable
                // REJECTED_USER_REVIEW (skips auto-retry, surfaces in
                // OfflineConflictPage). Transient → FAILED (auto-retry).
                const errorMessage = result.errorMessage ?? result.errorCode ?? 'Unknown sync error';
                const category = categorizeRejection({
                    errorCode: result.errorCode,
                    errorMessage: result.errorMessage,
                });

                if (category === 'PERMANENT') {
                    await mutationQueue.markRejectedUserReview(mutationId, errorMessage);
                    notifySync({
                        type: 'MUTATION_REJECTED',
                        mutationId: mutation.clientRequestId,
                        reason: result.errorCode ?? errorMessage,
                    });
                } else {
                    await mutationQueue.markFailed(mutationId, errorMessage);
                    // Transient — silently retries next cycle. No
                    // syncMachine event so the badge doesn't churn.
                }
            }
        } catch (error) {
            // Cycle-level failure (e.g., network error before any results
            // returned). All in-flight mutations failed transiently —
            // mark FAILED across the batch, no syncMachine churn.
            const message = error instanceof Error ? error.message : 'Unknown push error';
            for (const mutation of supportedMutations) {
                await mutationQueue.markFailed(mutation.id as number, message);
            }
        }
    }

    private async pullLatestDeltas(): Promise<void> {
        const sinceCursor = await mutationQueue.getCursor() ?? '0';
        const payload = await agriSyncClient.pullSyncChanges(sinceCursor);
        await mutationQueue.saveLastPullPayload(payload);
        await reconcileSyncPull(payload);

        const nextCursor = payload.nextCursorUtc || payload.serverTimeUtc || systemClock.nowISO();
        await mutationQueue.setCursor(nextCursor);
    }
}

export const backgroundSyncWorker = BackgroundSyncWorker.getInstance();
