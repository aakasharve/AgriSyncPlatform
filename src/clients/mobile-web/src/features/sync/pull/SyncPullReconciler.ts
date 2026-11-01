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
import { reconcileLogs } from './reconcilers/logsReconciler';
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
    const { plotLookup, receivedAtUtc } = await reconcileProfileAndCrops(payload);

    const db = getDatabase();

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
    ], async () => {
        if (pendingLogIds) {
            importedLogs = await reconcileLogs(
                db, payload, plotLookup, pendingLogIds, receivedAtUtc, options.rebuildLogs === true);
            if (options.rebuildLogs) {
                await markLogsRebuilt(db, receivedAtUtc);
            }
        }
        await reconcileAttachments(db, payload, receivedAtUtc);
        referenceDataUpdated = await reconcileReferenceData(db, payload, receivedAtUtc);
        const ledgerSummary = await reconcileDayLedgersAndPlannedTasks(db, payload, receivedAtUtc);
        dayLedgersCount = ledgerSummary.dayLedgersCount;
        plannedTasksCount = ledgerSummary.plannedTasksCount;
        await reconcileFinance(db, payload, receivedAtUtc);
        await reconcileAttendance(db, payload, receivedAtUtc);
        await reconcileFarmsPlotsCycles(db, payload, receivedAtUtc);
        await reconcileAttentionBoard(db, payload);
        // lane MU-3 (plan step 4a) — keep only what the server lets this person read: after every other
        // reconciler, so what this pull just wrote is scanned too. An older server sends no scopes: no-op.
        await reconcileAccessScopes(db, payload, {
            userId: getAuthSession()?.userId ?? null,
            pendingLogIds,
            receivedAtUtc,
        });
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
    if (withdrawnMoney > 0 && typeof window !== 'undefined') {
        // The money cache merges pulls; a withdrawn money record must leave it too (re-read from the phone's store).
        window.dispatchEvent(new CustomEvent('agrisync:finance-records-withdrawn'));
    }
}
