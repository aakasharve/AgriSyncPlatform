/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — orchestrator only. Each domain concern lives in
 * its own reconciler under ./reconcilers; their helpers under ./helpers.
 *
 * Behavior:
 *   1. Pre-tx: profile + crops are persisted via their own repositories
 *      (Dexie repository writes own their own transactions).
 *   2. ARCH-S004: read pendingLogIds before the main tx so logs with
 *      unsynced local mutations are not overwritten by stale server state.
 *   3. Big atomic tx covers everything else (logs / attachments / ref data /
 *      day ledgers / planned tasks / finance / farms+plots+cycles /
 *      attention cards / appMeta finalize) so a partial pull cannot leave
 *      Dexie inconsistent.
 *   4. Post-tx: refresh runtime template catalog + DOM events.
 */

import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { readPendingLogIds, readWithdrawalHolds } from './internal/pendingMutations';
import { reconcileProfileAndCrops } from './reconcilers/profileAndCropsReconciler';
import { reconcileScheduleSubscriptions } from './reconcilers/scheduleSubscriptionsReconciler';
import { reconcilePlanningState } from './reconcilers/planningStateReconciler';
import { reconcileScheduleMechanism } from './reconcilers/scheduleMechanismReconciler';
import { reconcilePlannedWork } from './reconcilers/plannedWorkReconciler';
import { reconcileOwnScheduleItems } from './reconcilers/ownScheduleItemsReconciler';
import { reconcileFarmSetup } from './reconcilers/farmSetupReconciler';
import { reconcileOwnerVoice } from './reconcilers/ownerVoiceReconciler';
import { prefetchOwnerVoiceAfterPull } from '../../scheduler/ownerVoice/ownerVoicePrefetch';
import { uploadHeldScheduleChoices } from '../../scheduler/schedulePage/uploadHeldScheduleChoices';
import { reconcileLogs } from './reconcilers/logsReconciler';
import { reconcileInputIdentityAnswers } from './reconcilers/inputIdentityReconciler';
import { reconcileAttachments } from './reconcilers/attachmentsReconciler';
import { reconcileReferenceData } from './reconcilers/referenceDataReconciler';
import { reconcileDayLedgersAndPlannedTasks } from './reconcilers/dayLedgersAndPlannedTasksReconciler';
import { reconcileFinance } from './reconcilers/financeReconciler';
import { reconcileAttendance } from './reconcilers/attendanceReconciler';
import { reconcileFarmsPlotsCycles } from './reconcilers/farmsPlotsCyclesReconciler';
import { reconcileAttentionBoard } from './reconcilers/attentionBoardReconciler';
import { reconcileAccessScopes } from './reconcilers/accessScopeReconciler';
import { reconcileWithdrawnRecords } from './reconcilers/withdrawnRecordsReconciler';
import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { finalizeReconciliation } from './reconcilers/finalizeReconciliation';
import { dispatchPostReconcileEvents } from './reconcilers/postReconcileEvents';
import { markLogsRebuilt } from './logsRebuildMarker';
import { INPUT_LIBRARY_POLL_MS, runInputLibraryStep } from './reconcilers/inputLibraryDownload';
import { syncSchedulePictures } from '../../scheduler/pictures/schedulePictureDownload';

export { dayLedgerMetaKey } from './helpers/dayLedgerMetaKey';

export interface ReconcileSyncPullOptions {
    /**
     * Lane F1 (review N9): this pull is the one full re-pull (`logsRebuildMarker.ts`). Every log is re-merged, and
     * the marker is written in this transaction ONLY when the logs were actually reconciled.
     */
    rebuildLogs?: boolean;
    /**
     * spec: plr-d10 lane PRV — this pull was asked from the beginning (cursor '0'): its records are the whole list, so a
     * server copy it no longer carries is no longer his (`withdrawnRecordsReconciler`).
     */
    fullPull?: boolean;
}

export async function reconcileSyncPull(payload: SyncPullResponse, options: ReconcileSyncPullOptions = {}): Promise<void> {
    const db = getDatabase();

    // spec: plr-d10 lane L8b-2 (founder D-32) - the schedule each plot follows, BEFORE the crops are merged: the server's
    // choice wins on download, and the merge below must know which plots hold one so it never puts the crop-type default
    // over a choice. First, once: a choice this phone already holds goes up before the download can touch it (P10, P11).
    // B003: the server's rows are stored FIRST, so the upload never sends a choice for a plot the server already holds.
    await reconcileScheduleSubscriptions(db, payload);
    await uploadHeldScheduleChoices(db, payload);

    const { plotLookup, receivedAtUtc } = await reconcileProfileAndCrops(payload);

    // P0.5 — FAIL CLOSED ON AN UNREADABLE MUTATION QUEUE.
    //
    // `readPendingLogIds` now throws rather than answering "nothing is pending"
    // when it cannot read the queue. Without the guard's answer there is no safe
    // way to decide which logs a pull may overwrite, so the log reconciliation
    // is SKIPPED for this cycle. Everything else — reference data, farms, plots,
    // finance — carries no unsent local intent and still lands, so a farmer does
    // not lose a whole sync over it. The next cycle retries, and the honesty
    // chip continues to report the unsent work truthfully.
    let pendingLogIds: Set<string> | undefined;
    try {
        pendingLogIds = await readPendingLogIds(db);
    } catch (error) {
        console.warn(
            JSON.stringify({
                component: 'SyncPullReconciler',
                action: 'skip_log_reconciliation_guard_unavailable',
                reason: error instanceof Error ? error.message : String(error),
            }));
    }

    // lane PRV fix pass 1 (M6) — what a change of his still waits on, work AND money, parked refusals included.
    const withdrawalHolds = await readWithdrawalHolds(db);

    const attachmentsCount = (payload.attachments ?? []).length;

    let importedLogs = 0;
    let dayLedgersCount = 0;
    let plannedTasksCount = 0;
    let referenceDataUpdated = false;
    let withdrawnMoney = 0;

    await db.transaction('rw', [
        db.logs, db.attachments, db.uploadQueue, db.appMeta, db.referenceData,
        db.farms, db.plots, db.cropCycles, db.costEntries, db.financeCorrections,
        db.dayLedgers, db.plannedTasks, db.attentionCards, db.attendanceMarks,
        // lane MU-3 — the purge also reaches these (existing stores; no version bump).
        db.jobCards, db.testInstances, db.testRecommendations, db.complianceSignals,
        // lane MU-3 fix 1 (item 14) — a gone farm's plots leave the crop list; other people's names leave the profile.
        db.crops, db.farmerProfile,
        // lane L8b-2 fix round 1 (B004) - the purge reaches the schedule choices too.
        db.scheduleSubscriptions,
        // lane L8c-1 - the farm's tasks and reminders (and a task taken from this person leaves with the withdrawn list).
        db.plannedWork, db.mutationQueue,
        // schedule mechanism slice 3 - a plot-season's own schedule while it is built (server cache, replaced whole when the pull carries it).
        db.ownScheduleItems, db.ownScheduleItemRevisions,
        // repair D-9 - the farm's setup as the server holds it (server cache, replaced farm by farm when the pull carries it).
        db.farmWaterSources, db.farmMachines, db.farmPowerTimes, db.plotWater,
    ], async () => {
        if (pendingLogIds) {
            importedLogs = await reconcileLogs(
                db, payload, plotLookup, pendingLogIds, receivedAtUtc, options.rebuildLogs === true);
            if (options.rebuildLogs) {
                await markLogsRebuilt(db, receivedAtUtc);
            }
        }
        // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4) - his हो / नाही / फोटो answers, laid on the records just
        // reconciled. Their own list: an answer never moves its record's clock, so the log step above cannot carry it.
        await reconcileInputIdentityAnswers(db, payload);
        await reconcileAttachments(db, payload, receivedAtUtc);
        referenceDataUpdated = await reconcileReferenceData(db, payload, receivedAtUtc);
        const ledgerSummary = await reconcileDayLedgersAndPlannedTasks(db, payload, receivedAtUtc);
        dayLedgersCount = ledgerSummary.dayLedgersCount;
        plannedTasksCount = ledgerSummary.plannedTasksCount;
        await reconcileFinance(db, payload, receivedAtUtc);
        await reconcileAttendance(db, payload, receivedAtUtc);
        await reconcileFarmsPlotsCycles(db, payload, receivedAtUtc);
        // spec: plr-d10 lane SCH-GATE-b (D-83 = 1) - the server's planning gate per plot, stored whole in appMeta (an absent key leaves it).
        await reconcilePlanningState(db, payload, receivedAtUtc);
        // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 1) - the farms the schedule mechanism is switched on for, stored whole in appMeta (an ABSENT key is
        // an answer here: off - the server omits it when the switch is off for every farm, and an older server never sends it).
        await reconcileScheduleMechanism(db, payload, receivedAtUtc);
        // slice 3 - the works of each plot-season's own schedule and their history, as the server holds them (an absent key leaves them).
        await reconcileOwnScheduleItems(db, payload);
        // repair D-9 - each farm's water sources, motors, power times, machines and plot water, as the server holds them (an absent key leaves them).
        await reconcileFarmSetup(db, payload, receivedAtUtc);
        // slice 12b - the schedule owner's messages, clip metadata and what this plot did with them (each key replaces whole; an absent key leaves them).
        await reconcileOwnerVoice(db, payload);
        await reconcileAttentionBoard(db, payload);
        // lane MU-3 (plan step 4a) — keep only what the server lets this person read: after every other
        // reconciler, so what this pull just wrote is scanned too. An older server sends no scopes: no-op.
        await reconcileAccessScopes(db, payload, {
            userId: getAuthSession()?.userId ?? null,
            pendingLogIds,
            receivedAtUtc,
        });
        // lane L8c-1 (founder D-24c, D-26, D-79) - the tasks and reminders he may see; the server follows his rights, the phone
        // keeps exactly what it was sent. Before the withdrawn list, which then takes a task back from its old assignee.
        await reconcilePlannedWork(db, payload, { fullPull: options.fullPull === true, userId: getAuthSession()?.userId ?? null });
        // lane PRV (D-26) — records whose audience no longer includes this person leave his phone, with what hangs
        // from them; never a record with a change still queued (P10).
        withdrawnMoney = (await reconcileWithdrawnRecords(db, payload, {
            userId: getAuthSession()?.userId ?? null,
            pendingLogIds: withdrawalHolds?.logIds,
            pendingMoneyIds: withdrawalHolds?.moneyIds,
            receivedAtUtc,
            fullPull: options.fullPull === true,
        })).removedMoney;

        await finalizeReconciliation(
            db,
            payload,
            {
                importedLogs,
                importedAttachments: attachmentsCount,
                importedDayLedgers: dayLedgersCount,
                importedPlannedTasks: plannedTasksCount,
            },
            referenceDataUpdated,
            receivedAtUtc,
        );
    });

    dispatchPostReconcileEvents(payload);
    // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 4) - the product library, asked for AFTER the pull has
    // landed and OUTSIDE its Dexie transaction, at most every INPUT_LIBRARY_POLL_MS. Fire and forget: the step never throws,
    // and the .catch (which also covers a throw before the first await) means nothing it does can fail or delay this pull.
    void Promise.resolve().then(() => runInputLibraryStep(db, { minIntervalMs: INPUT_LIBRARY_POLL_MS })).catch(() => undefined);
    // spec: plr-d10 lane SCH-ID-P (D-146, D-148) - the pictures the pull NAMED for each schedule (an owner's photo, a schedule's picture, a logo),
    // fetched only when their sha changed, after the pull has landed and outside its transaction. Fire and forget: the step never throws, a
    // refusal or an offline phone just leaves the letter or leaf badge, and nothing it does can fail or delay this pull.
    void Promise.resolve().then(() => syncSchedulePictures(db, (payload as { scheduleTemplates?: unknown }).scheduleTemplates)).catch(() => undefined);
    // spec: plr-d10 schedule slices 8 and 12b (CTO gate; P10) - the schedule owner's clips and the day cards of every followed schedule (and of the versions the owner's
    // messages name), kept right after the pull lands and outside its transaction, so they open and play in the field with no signal even when no schedule screen was
    // opened online. Only what the phone does not hold yet is fetched. Fire and forget: never throws, never delays this pull.
    void Promise.resolve().then(() => prefetchOwnerVoiceAfterPull(db)).catch(() => undefined);
    if (withdrawnMoney > 0 && typeof window !== 'undefined') {
        // The money cache merges pulls; a withdrawn money record must leave it too (re-read from the phone's store).
        window.dispatchEvent(new CustomEvent('agrisync:finance-records-withdrawn'));
    }
}
