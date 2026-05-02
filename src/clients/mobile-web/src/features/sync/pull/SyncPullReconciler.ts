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
import { readPendingLogIds } from './internal/pendingMutations';
import { reconcileProfileAndCrops } from './reconcilers/profileAndCropsReconciler';
import { reconcileLogs } from './reconcilers/logsReconciler';
import { reconcileAttachments } from './reconcilers/attachmentsReconciler';
import { reconcileReferenceData } from './reconcilers/referenceDataReconciler';
import { reconcileDayLedgersAndPlannedTasks } from './reconcilers/dayLedgersAndPlannedTasksReconciler';
import { reconcileFinance } from './reconcilers/financeReconciler';
import { reconcileFarmsPlotsCycles } from './reconcilers/farmsPlotsCyclesReconciler';
import { reconcileAttentionBoard } from './reconcilers/attentionBoardReconciler';
import { finalizeReconciliation } from './reconcilers/finalizeReconciliation';
import { dispatchPostReconcileEvents } from './reconcilers/postReconcileEvents';

export { dayLedgerMetaKey } from './helpers/dayLedgerMetaKey';

export async function reconcileSyncPull(payload: SyncPullResponse): Promise<void> {
    const { plotLookup, receivedAtUtc } = await reconcileProfileAndCrops(payload);

    const db = getDatabase();
    const pendingLogIds = await readPendingLogIds(db);
    const attachmentsCount = (payload.attachments ?? []).length;

    let importedLogs = 0;
    let dayLedgersCount = 0;
    let plannedTasksCount = 0;
    let referenceDataUpdated = false;

    await db.transaction('rw', [
        db.logs, db.attachments, db.uploadQueue, db.appMeta, db.referenceData,
        db.farms, db.plots, db.cropCycles, db.costEntries, db.financeCorrections,
        db.dayLedgers, db.plannedTasks, db.attentionCards,
    ], async () => {
        importedLogs = await reconcileLogs(db, payload, plotLookup, pendingLogIds);
        await reconcileAttachments(db, payload, receivedAtUtc);
        referenceDataUpdated = await reconcileReferenceData(db, payload, receivedAtUtc);
        const ledgerSummary = await reconcileDayLedgersAndPlannedTasks(db, payload, receivedAtUtc);
        dayLedgersCount = ledgerSummary.dayLedgersCount;
        plannedTasksCount = ledgerSummary.plannedTasksCount;
        await reconcileFinance(db, payload, receivedAtUtc);
        await reconcileFarmsPlotsCycles(db, payload, receivedAtUtc);
        await reconcileAttentionBoard(db, payload);

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
}
