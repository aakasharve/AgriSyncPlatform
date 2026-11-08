import { mutationQueue, MAX_AUTO_RETRY_COUNT } from './MutationQueue';
import { systemClock } from '../../core/domain/services/Clock';
import { agriSyncClient, type SyncMutationType } from '../api/AgriSyncClient';
import { getAuthSession } from '../storage/AuthTokenStore';
import { reconcileSyncPull } from '../../features/sync/pull/SyncPullReconciler';
import { runInputLibraryStep } from '../../features/sync/pull/reconcilers/inputLibraryDownload';
import { isLogsRebuildDue, REFUSAL_RESTORES_SERVER_VERSION, requestLogsRebuild } from '../../features/sync/pull/logsRebuildMarker';
import { getDatabase } from '../storage/DexieDatabase';
import { readHeldFarmIds } from '../storage/accessScopeStore';
import { AiJobWorker } from './AiJobWorker';
import { isSyncMutationType, SyncMutationName } from './SyncMutationCatalog';
import { getRootStore } from '../../app/state/RootStore';
import {
    categorizePushFailure,
    categorizeRejection,
    isDependencyPendingRejection,
    isEntitlementHeldRejection,
    isMoneyDependencyRejection,
    isPlotDependencyRejection,
} from './RejectionPolicy';
import {
    describeDependencyRejection,
    describeDependencyWait,
    missingMoneyIdsIn,
    resolveDailyLogDependency,
    resolveMoneyDependency,
    resolvePlotDependency,
} from './MutationDependency';
import { resetFailedUploadsToPending } from './UploadQueueRetry';
import { takeMovedMoney } from '../../features/finance/movedMoney';
import { clearMoneyNotFollowedFor, takeEditMoney } from '../../features/finance/editMoney';
import { prepareRecordMoney } from './recordMoneyOrder';
import type { QueueRowWithFacts } from './queueRowFacts';
import { lineAmountNow } from '../../features/finance/recordMoneyNow';
import { restoreRefusedAudienceChoice } from '../../features/recordAudience/refusedAudience';
import { settleBillVersions } from '../../features/finance/billVersionsMarker';
import { settleScheduleSubscriptions } from '../../features/scheduler/schedulePage/scheduleSubscriptionsMarker';

/** A record's first money that reached the server is in step only when it went at its line's current amount. */
async function clearWhenInStep(moneySource: string, payload: unknown): Promise<void> {
    const sent = (payload ?? {}) as { costEntryId?: string; amount?: number };
    const now = await lineAmountNow(moneySource);
    if (sent.costEntryId && now.state === 'priced' && now.amount === sent.amount) {
        await clearMoneyNotFollowedFor(sent.costEntryId);
    }
}

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
        // §P0.7 box 2e — WORKER START ONLY, never inside the cycle. Same rule
        // as `abandonedStateRecovery`: a scan placed among the items of a live
        // cycle would run against rows that cycle is holding.
        //
        // spec: plr-d10-redesign-real-integration (I9) — phone-made plots the server has
        // not sent back yet are queued again FIRST (same ids, so a repeat collapses), so a
        // stranded log on such a plot is recovered behind its plot, never ahead of it.
        void this.reconcileUnregisteredPlots().then(() => this.reconcileStrandedLogs());
        // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 4) - the product library at APP START: the stored
        // copy becomes the one the matcher uses at once (so offline launches match against it), then the server is asked.
        // Fire and forget, never inside a cycle: the step never throws, and the .catch (which also covers the database handle
        // itself failing to open) means it can never fail or delay this start.
        void Promise.resolve().then(() => runInputLibraryStep(getDatabase())).catch(() => undefined);
        this.safeRunCycle();

        this.timerId = window.setInterval(() => {
            this.safeRunCycle();
        }, this.intervalMs);

        window.addEventListener('online', this.handleOnline);
    }

    /**
     * Stops scheduling AND returns a promise that settles only when any cycle
     * already running has finished. Callers that are about to change the active
     * user/database MUST await it: a previous user's in-flight cycle must never
     * emit a rejection into, or write to, the next user's state.
     * (`currentCycle` never rejects: safeRunCycle catches.)
     */
    stop(): Promise<void> {
        if (this.isRunning) {
            this.isRunning = false;

            if (this.timerId !== null) {
                window.clearInterval(this.timerId);
                this.timerId = null;
            }

            window.removeEventListener('online', this.handleOnline);
        }

        return this.currentCycle;
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
        // §P0.7 review M2 — EACH SET UNDER ITS OWN TRY.
        //
        // The first version read both under one `Promise.all` in one `try`, so a
        // throw from either lost BOTH — and this method is the only thing that
        // makes `ConflictBadge` survive a restart, which is the only route to the
        // conflict screen. Adding a second query must not double the blast radius
        // of the first. One set failing now costs that set only.
        await this.announceStuckRows(
            () => mutationQueue.getRejectedUserReview(),
            'durable rejections',
        );
        await this.announceStuckRows(
            () => mutationQueue.getCapExhaustedFailed(),
            'cap-exhausted failures',
        );
    }

    private async announceStuckRows(
        read: () => Promise<Array<{ clientRequestId: string; lastError?: string }>>,
        label: string,
    ): Promise<void> {
        try {
            for (const row of await read()) {
                notifySync({
                    type: 'MUTATION_REJECTED',
                    mutationId: row.clientRequestId,
                    reason: row.lastError ?? 'UNKNOWN',
                });
            }
        } catch (error) {
            console.warn(`[BackgroundSyncWorker] Could not rehydrate ${label}`, error);
        }
    }

    /**
     * §P0.7 box 2e — recover logs that reached NO sync queue at all.
     *
     * A death between the log write and the enqueue strands the record on the
     * handset permanently and invisibly, and nothing else in the app re-scans
     * for it. Runs once per worker start; see `strandedLogReconciler` for the
     * predicate, the server-origin guard and why this cannot double-write.
     *
     * DYNAMICALLY IMPORTED, and not as a style choice:
     * `logSyncMutationService` imports `backgroundSyncWorker` (`:6`), so a
     * static import here would close a module cycle through this file's own
     * singleton. Deferring the load to worker start breaks it outright rather
     * than relying on ESM live bindings to paper over it.
     *
     * Public so a test can await it — `start()` cannot.
     */
    async reconcileStrandedLogs(): Promise<void> {
        try {
            const { reconcileStrandedLogs } = await import('../../features/sync/recovery/strandedLogReconciler');
            await reconcileStrandedLogs();
        } catch (error) {
            // The reconciler already logs its own per-record failures and never
            // throws for them; reaching here means the module itself could not
            // load. Say so — a recovery that quietly does not exist is the
            // failure mode this whole task is about.
            console.error(JSON.stringify({
                level: 'error',
                component: 'BackgroundSyncWorker',
                message: 'Stranded-log reconciler could not run; records that reached no queue stay invisible',
                error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
                timestamp: new Date().toISOString(),
            }));
        }
    }

    /**
     * spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3). Worker start only, for
     * the same reason as the stranded-log reconciler, and loaded the same deferred way.
     * Public so a test can await it.
     */
    async reconcileUnregisteredPlots(): Promise<void> {
        try {
            const { reconcileUnregisteredPlots } = await import('../../features/sync/plots/registerNewPlotOnServer');
            await reconcileUnregisteredPlots();
        } catch (error) {
            console.error('[BackgroundSyncWorker] phone-made plot retry could not run', error);
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

        // spec: plr-d10 (lane OF-M fix pass 1, call C) — a record's first money goes at its line's current amount (or is
        // set aside, with a trail, when the line was removed), and a queued edit waits while that money is on its way.
        const pendingWithId = await prepareRecordMoney(pending.filter(item => item.id !== undefined));
        if (pendingWithId.length === 0) {
            return;
        }

        const supportedMutations: Array<{ id: number; clientRequestId: string; clientCommandId?: string; mutationType: SyncMutationType; payload: unknown; moneySource?: string }> = [];
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
                moneySource: (mutation as QueueRowWithFacts).moneySource,
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
                    // spec: plr-d10 (lane OF-S fix pass 2, N1/N3) — a move answers with exactly the money it took along:
                    // written here at once (no waiting for a pull), and nothing else is moved on this phone. A failure is
                    // said, never swallowed; the pull at the end of the cycle carries the same rows.
                    if (mutation.mutationType === SyncMutationName.MoveDailyLog) {
                        await takeMovedMoney(result.data).catch((error: unknown) => {
                            console.error('BackgroundSyncWorker: the money a move took could not be written on this phone yet', error);
                        });
                    }
                    // spec: plr-d10 (lane OF-M, F89) — an edit answers with exactly the money the server made or corrected
                    // for it (and why any did not follow): written here at once, the same way; the phone changes no money
                    // on its own. A failure is said; the pull at the end of the cycle carries the same rows.
                    // Lane OF-M fix passes 1–2 — a record's first money reached the server AT ITS LINE'S CURRENT AMOUNT: its
                    // "money did not change" words go. Money of a removed line went at its saved amount: not in step yet,
                    // so they stay until an answer says it is.
                    if (mutation.mutationType === SyncMutationName.AddCostEntry && mutation.moneySource) {
                        await clearWhenInStep(mutation.moneySource, mutation.payload).catch((error: unknown) => {
                            console.error('BackgroundSyncWorker: the money words could not be cleared', error);
                        });
                    }
                    if (mutation.mutationType === SyncMutationName.ReviseLogContent) {
                        const dailyLogId = String((mutation.payload as { dailyLogId?: unknown } | null)?.dailyLogId ?? '');
                        await takeEditMoney(dailyLogId, result.data).catch((error: unknown) => {
                            console.error('BackgroundSyncWorker: the money an edit made could not be written on this phone yet', error);
                        });
                    }
                    // §P0.7 review B002 — A ROW THE SERVER HAS ACCEPTED IS NOT A
                    // CONFLICT, AND THE BADGE MUST STOP SAYING IT IS.
                    //
                    // `syncMachine` drops an entry only on `CONFLICT_RESOLVED`,
                    // and only `ConflictResolutionService.retry/discard` emitted
                    // it. The drawer's "Retry All" and per-row "Retry" — the
                    // remedy `stuckMutations` assigns a cap-exhausted row, and
                    // the one the farmer is actually steered to — emit nothing.
                    // So once box 2d put cap-exhausted rows in the badge, a
                    // successful "Retry All" left the count STUCK UP for the rest
                    // of the session, and tapping it opened a page saying
                    // everything was synced. The old painted door, mirrored.
                    //
                    // Emitting here rather than in each retry path is deliberate:
                    // acceptance is the one fact that settles this for every
                    // route, including ones not written yet. `removeResolution`
                    // filters by id, so it is a no-op for a row that was never
                    // announced.
                    notifySync({ type: 'CONFLICT_RESOLVED', mutationId: mutation.clientRequestId });
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
                // spec: plr-d10-redesign-real-integration (I9 — X3) — the same rule for a log
                // whose parent is a plot (or its crop cycle) made on this phone.
                const rejection = { errorCode: result.errorCode, errorMessage: result.errorMessage };

                // spec R-11 (c) — HELD, tested first: the FARM'S trial / plan refused it, so
                // nothing about this row (or its parent) was judged. Kept on the phone,
                // uncharged, never a conflict, re-asked on the slow timer; it goes by itself
                // (same client ids, so never twice) once the server allows the farm again.
                if (isEntitlementHeldRejection(rejection)) {
                    await mutationQueue.markFailed(mutationId, errorMessage, 'HELD', result.errorCode ?? undefined);
                    continue;
                }

                // spec: plr-d10 (lane OF-S fix pass 2, N4) — a move refused because its record's money has not arrived
                // waits (uncharged) while that money is still on its way from THIS phone; otherwise the refusal stands.
                // Lane OF-M (R4-1): the money wait looks only at the money the refusal names.
                const resolveDependency = isDependencyPendingRejection(rejection)
                    ? resolveDailyLogDependency
                    : isPlotDependencyRejection(rejection) ? resolvePlotDependency
                        : isMoneyDependencyRejection(rejection)
                            ? (device: string, type: string, payload: unknown) =>
                                resolveMoneyDependency(device, type, payload, missingMoneyIdsIn(result.errorMessage))
                            : null;
                if (resolveDependency) {
                    const verdict = await resolveDependency(
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
                    // Task 9 (B001): the code travels WITH the park — it is
                    // what lets a surface recognise the verdict (the labour
                    // route reads AttendanceContradiction parks) without
                    // matching the English message.
                    await mutationQueue.markRejectedUserReview(mutationId, errorMessage, result.errorCode ?? undefined);
                    notifySync({
                        type: 'MUTATION_REJECTED',
                        mutationId: mutation.clientRequestId,
                        reason: result.errorCode ?? errorMessage,
                    });
                    // spec: plr-d10 (lane OF-S) — a refused move / worker count leaves the server's version standing:
                    // ask for it again, so the pull at the end of this cycle puts the entry back (the refused row no
                    // longer holds it, `pendingMutations.ts`); the बदला screen says why (`refusedRevision.ts`).
                    if (REFUSAL_RESTORES_SERVER_VERSION.has(mutation.mutationType)) {
                        await requestLogsRebuild(getDatabase()).catch((error: unknown) => {
                            console.error('BackgroundSyncWorker: could not ask for the server version again', error);
                        });
                    }
                    // lane PRV fix pass 3 (item 6) — a refused choice of who sees a record leaves the lock chip at once,
                    // even when another change of his to that record is still queued (the pull would not re-merge it).
                    if (mutation.mutationType === SyncMutationName.SetRecordAudience) {
                        await restoreRefusedAudienceChoice(mutation.payload).catch((error: unknown) => {
                            console.error('BackgroundSyncWorker: could not put the refused audience choice back', error);
                        });
                    }
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
        // Lane F1 (review N9): ONE full re-pull after this version is installed, so every log pulled before it is
        // rebuilt truthfully (logsRebuildMarker.ts). Until the marker is written, the pull starts from the beginning.
        const rebuildLogs = await isLogsRebuildDue(getDatabase());
        const sinceCursor = rebuildLogs ? '0' : (await mutationQueue.getCursor() ?? '0');
        // lane MU-3 fix 1 (F9) — name the farms this phone holds, so the server answers each one explicitly.
        const payload = await agriSyncClient.pullSyncChanges(sinceCursor, await readHeldFarmIds(getDatabase()));
        await mutationQueue.saveLastPullPayload(payload);
        await reconcileSyncPull(payload, { rebuildLogs, fullPull: sinceCursor === '0' });
        // lane BILL-1 fix round 1 (review M4) — bills held from before BILL-1 have no version: once, against a server that
        // sends versions, the next pull asks for everything again. A failure here costs only that request (never this pull).
        try {
            await settleBillVersions(getDatabase(), payload, sinceCursor === '0');
        } catch (error) {
            console.warn(JSON.stringify({
                component: 'billVersionsMarker',
                action: 'settle_failed',
                reason: error instanceof Error ? error.message : String(error),
            }));
        }

        // lane L8b-2 fix round 1 (B011) - the same, once, for the schedule choices made before this phone's cursor.
        try {
            await settleScheduleSubscriptions(getDatabase(), payload, sinceCursor === '0');
        } catch (error) {
            console.warn(JSON.stringify({
                component: 'scheduleSubscriptionsMarker',
                action: 'settle_failed',
                reason: error instanceof Error ? error.message : String(error),
            }));
        }

        const nextCursor = payload.nextCursorUtc || payload.serverTimeUtc || systemClock.nowISO();
        await mutationQueue.setCursor(nextCursor);
    }
}

export const backgroundSyncWorker = BackgroundSyncWorker.getInstance();
