import { mutationQueue, MAX_AUTO_RETRY_COUNT } from './MutationQueue';
import { systemClock } from '../../core/domain/services/Clock';
import { agriSyncClient, type SyncMutationType } from '../api/AgriSyncClient';
import { getAuthSession } from '../storage/AuthTokenStore';
import { reconcileSyncPull } from '../../features/sync/pull/SyncPullReconciler';
import { getDatabase } from '../storage/DexieDatabase';
import { AiJobWorker } from './AiJobWorker';
import { isSyncMutationType } from './SyncMutationCatalog';
import { getRootStore } from '../../app/state/RootStore';
import { categorizePushFailure, categorizeRejection, isDependencyPendingRejection } from './RejectionPolicy';
import {
    describeDependencyRejection,
    describeDependencyWait,
    resolveDailyLogDependency,
} from './MutationDependency';
import { resetFailedUploadsToPending } from './UploadQueueRetry';

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
        // Boot-time rehydration must happen before the first cycle so a
        // rejection that predates this launch is visible immediately rather
        // than only after the next server round trip. Fire-and-forget: it is a
        // Dexie read and must never delay or fail the sync loop.
        void this.rehydrateRejectedMutations();
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
            // §P0.7 box 2c — this is a tap, so it means NOW. Without this the
            // row is flipped to PENDING, `triggerNow()` runs, `getPending`
            // silently skips it for up to a minute, and the button reads as
            // broken.
            await mutationQueue.clearBackoff(failedItem.id);
            await this.triggerNow();
        }
    }

    /**
     * "Retry All" in `SyncStatusDrawer` — the remedy the header chip points at
     * when it says `अडकलं — तपासा`.
     *
     * Before Task T3 this called `markFailedAsPending()` with no argument, so
     * it re-applied the `retryCount >= 5` cap and skipped **exactly** the rows
     * the farmer had come to the drawer about, silently. It now uses the
     * uncapped manual path, and it also re-queues terminally-failed attachment
     * uploads — which the drawer has always counted into the same "N Failed"
     * header (`SyncStatusDrawer.tsx:117`) while offering nothing that could
     * clear them.
     *
     * `REJECTED_USER_REVIEW` rows are not touched here; see
     * `MutationQueue.retryAllFailedByUser`. Their remedy is
     * `OfflineConflictPage`, reached from `ConflictBadge` — which is why
     * `rehydrateRejectedMutations()` below matters so much.
     *
     * @returns what was actually re-queued, so the caller can report the truth.
     *          Re-queued uploads are picked up by `AttachmentUploadWorker`'s own
     *          10 s cycle; `triggerNow()` only drives the mutation queue.
     */
    async retryAllFailed(): Promise<{ mutations: number; uploads: number }> {
        const mutations = await mutationQueue.retryAllFailedByUser();
        const uploads = await resetFailedUploadsToPending();
        await this.triggerNow();
        return { mutations, uploads };
    }

    /**
     * Re-announces durable rejections already sitting in Dexie to the sync
     * actor, so `ConflictBadge` — and therefore the only route to
     * `OfflineConflictPage` — survives an app restart.
     *
     * THE BUG THIS FIXES (Task T3, finding R3)
     * ----------------------------------------
     * `ConflictBadge` reads `snapshot.context.rejectedMutations`
     * (`ConflictBadge.tsx:17-20`). That array starts `[]` (`syncMachine.ts:90`)
     * and was appended to ONLY by a live `MUTATION_REJECTED` event emitted
     * during the same session (`:241-245` below). Nothing read it back from
     * Dexie. So on the SECOND launch after a rejection the header chip said
     * "stuck, go check", the drawer showed a count above an empty list, and the
     * badge that leads to the one screen that can fix it returned `null`.
     * Every door was painted on.
     *
     * Safe to run more than once: `appendRejection` de-duplicates by
     * `mutationId` (`syncMachine.ts:44-46`), and `MUTATION_REJECTED` is
     * accepted from `idle`, `syncing` and `conflict` alike.
     *
     * §P0.7 box 2d — IT NOW ANNOUNCES BOTH STUCK SETS, not one.
     * `ConflictResolutionService.list()` was widened to include cap-exhausted
     * `FAILED` rows, but widening the list alone would have been invisible: the
     * badge is the route to the screen, and the badge counts what this method
     * announces. One without the other is another painted door, pointing the
     * other way.
     *
     * Public so a test can await it — `start()` cannot, and a floating promise
     * is not something to assert against.
     */
    async rehydrateRejectedMutations(): Promise<void> {
        try {
            const [rejected, capExhausted] = await Promise.all([
                mutationQueue.getRejectedUserReview(),
                mutationQueue.getCapExhaustedFailed(),
            ]);
            for (const row of [...rejected, ...capExhausted]) {
                notifySync({
                    type: 'MUTATION_REJECTED',
                    mutationId: row.clientRequestId,
                    reason: row.lastError ?? 'UNKNOWN',
                });
            }
        } catch (error) {
            console.warn('[BackgroundSyncWorker] Could not rehydrate rejected mutations', error);
        }
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
                // A verdict, reached locally: this client's own catalog refuses
                // the row. No amount of signal changes it -> charge the cap.
                await mutationQueue.markFailed(
                    mutation.id as number,
                    `Unsupported mutationType '${mutation.mutationType}'.`,
                    'REJECTION',
                );
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
                    // The request COMPLETED and the server produced a batch
                    // verdict — this row's absence from it is a decision the
                    // server made, not a packet the tower dropped. Auto-retry
                    // still tries again next cycle, but it is charged, so an
                    // endlessly-omitting server escalates to the farmer after
                    // five attempts instead of looping forever. No syncMachine
                    // churn — that is reserved for permanent rejections.
                    await mutationQueue.markFailed(mutationId, 'No push result returned for mutation.', 'REJECTION');
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

                // §P0.7 box 2a — the THIRD class, tested BEFORE the two-way
                // split because it is not a point on that axis. A
                // `DailyLogNotFound` is a verdict about the row's PARENT, and
                // whether the child should wait or escalate depends entirely on
                // what that parent is doing. See `MutationDependency` for why
                // "parent still open" is the wrong question and loops forever.
                if (isDependencyPendingRejection({
                    errorCode: result.errorCode,
                    errorMessage: result.errorMessage,
                })) {
                    const verdict = await resolveDailyLogDependency(
                        mutationQueue.getDeviceId(),
                        mutation.mutationType,
                        mutation.payload,
                    );

                    if (verdict.disposition === 'PARENT_IN_PROGRESS') {
                        // Uncharged: this row was never judged on its own
                        // merits. Backed off by `markFailed` so a child whose
                        // parent takes a while does not re-ask every 15s.
                        await mutationQueue.markFailed(
                            mutationId,
                            describeDependencyWait(verdict),
                            'DEPENDENCY',
                        );
                        continue;
                    }

                    if (verdict.disposition === 'PARENT_UNRECOVERABLE') {
                        // The parent will not move again without a tap, so
                        // waiting is a lie. Reject durably, NAMING the parent —
                        // a rejection the farmer cannot trace to a cause is not
                        // resolvable, and `ConflictResolutionService` is where
                        // it now becomes resolvable.
                        const dependencyReason = describeDependencyRejection(verdict);
                        await mutationQueue.markRejectedUserReview(mutationId, dependencyReason);
                        notifySync({
                            type: 'MUTATION_REJECTED',
                            mutationId: mutation.clientRequestId,
                            reason: dependencyReason,
                        });
                        continue;
                    }

                    // NOT_A_DEPENDENCY — no daily-log parent on this payload, or
                    // the parent is already APPLIED. Fall through unchanged: the
                    // server is saying something this rule cannot interpret.
                }

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
                    // The server read this row and refused it, just not
                    // permanently enough to need the farmer yet. A verdict all
                    // the same -> charged, so five refusals escalate rather
                    // than churn forever. Retries next cycle; no syncMachine
                    // event while it is still below the cap, so the badge
                    // doesn't churn.
                    const chargedRetries = await mutationQueue.markFailed(mutationId, errorMessage, 'REJECTION');

                    // §P0.7 box 2d — but the attempt that EXHAUSTS the cap does
                    // need announcing. Past this point nothing in the app moves
                    // the row again on its own, the chip flips to NEEDS_FIX, and
                    // the row is now in `ConflictResolutionService.list()`. If
                    // the badge stayed silent the farmer would have to guess
                    // that the screen had gained a row, or wait for the next
                    // app launch to be told.
                    if (chargedRetries >= MAX_AUTO_RETRY_COUNT) {
                        notifySync({
                            type: 'MUTATION_REJECTED',
                            mutationId: mutation.clientRequestId,
                            reason: errorMessage,
                        });
                    }
                }
            }
        } catch (error) {
            // Batch-level failure: NO per-row verdict came back for anything in
            // this batch. Whether that costs the rows a retry depends entirely
            // on why — and until Task T3 it always did, which is how ~75 s of
            // captive wifi, a 503, or a hibernated backend latched every record
            // on the handset as permanently stuck (finding R1).
            //
            // `categorizePushFailure` splits "we never got an answer" (or "the
            // server said not now about itself") from "the server read this and
            // refused it". Only the latter is charged. The rows still go FAILED
            // either way — nothing was sent, and the UI must not pretend
            // otherwise.
            const message = error instanceof Error ? error.message : 'Unknown push error';
            const kind = categorizePushFailure(error);
            for (const mutation of supportedMutations) {
                await mutationQueue.markFailed(mutation.id as number, message, kind);
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
