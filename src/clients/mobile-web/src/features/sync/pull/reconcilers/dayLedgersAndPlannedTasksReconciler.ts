/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Reconciles day-ledger snapshots + planned tasks. Both flows write into
 * their respective Dexie tables and stamp index keys into appMeta.
 *
 * Must run inside the orchestrator's `db.transaction('rw', ...)` block.
 */

import type {
    PlannedTask as PlannedTaskDto,
    SyncPullResponse,
} from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { dayLedgerMetaKey } from '../helpers/dayLedgerMetaKey';

export interface DayLedgersAndPlannedTasksSummary {
    dayLedgersCount: number;
    plannedTasksCount: number;
}

export async function reconcileDayLedgersAndPlannedTasks(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    receivedAtUtc: string,
): Promise<DayLedgersAndPlannedTasksSummary> {
    const dayLedgers = payload.dayLedgers ?? [];
    const plannedTasks = (payload.plannedActivities as PlannedTaskDto[]) ?? [];

    for (const dayLedger of dayLedgers) {
        await db.dayLedgers.put({
            id: dayLedger.id,
            farmId: dayLedger.farmId,
            dateKey: getDateKey(dayLedger.ledgerDate),
            payload: dayLedger,
            updatedAt: receivedAtUtc,
        });

        await db.appMeta.put({
            key: dayLedgerMetaKey(dayLedger.id),
            value: dayLedger,
            updatedAt: receivedAtUtc,
        });
    }

    for (const plannedTask of plannedTasks) {
        await db.plannedTasks.put({
            id: plannedTask.id,
            cropCycleId: plannedTask.cropCycleId,
            plannedDate: getDateKey(plannedTask.plannedDate),
            payload: plannedTask,
            updatedAt: receivedAtUtc,
        });
    }

    await db.appMeta.put({
        key: 'shramsafal_day_ledgers_index_v1',
        value: {
            ids: dayLedgers.map(dayLedger => dayLedger.id),
            importedAtUtc: receivedAtUtc,
            importedCount: dayLedgers.length,
        },
        updatedAt: receivedAtUtc,
    });

    await db.appMeta.put({
        key: 'shramsafal_planned_tasks_index_v1',
        value: {
            ids: plannedTasks.map(task => task.id),
            importedAtUtc: receivedAtUtc,
            importedCount: plannedTasks.length,
        },
        updatedAt: receivedAtUtc,
    });

    return {
        dayLedgersCount: dayLedgers.length,
        plannedTasksCount: plannedTasks.length,
    };
}
