/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Final step inside the reconciliation transaction: stamp the
 * `shramsafal_last_reconciled_pull_v1` appMeta entry capturing what was
 * imported. Used by debug surfaces + ops dashboards.
 */

import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';

type ReferencePayload = SyncPullResponse & {
    scheduleTemplates?: unknown[];
    referenceDataVersionHash?: string;
};

export interface ReconciliationCounts {
    importedLogs: number;
    importedAttachments: number;
    importedDayLedgers: number;
    importedPlannedTasks: number;
}

export async function finalizeReconciliation(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    counts: ReconciliationCounts,
    referenceDataUpdated: boolean,
    receivedAtUtc: string,
): Promise<void> {
    const referencePayload = payload as ReferencePayload;
    const scheduleTemplates = referencePayload.scheduleTemplates ?? [];
    const referenceDataVersionHash =
        referencePayload.referenceDataVersionHash?.trim() ?? '';

    await db.appMeta.put({
        key: 'shramsafal_last_reconciled_pull_v1',
        value: {
            serverTimeUtc: payload.serverTimeUtc,
            nextCursorUtc: payload.nextCursorUtc,
            receivedAtUtc,
            importedLogs: counts.importedLogs,
            importedAttachments: counts.importedAttachments,
            importedScheduleTemplates: scheduleTemplates.length,
            importedDayLedgers: counts.importedDayLedgers,
            importedPlannedTasks: counts.importedPlannedTasks,
            referenceDataVersionHash: referenceDataVersionHash || null,
            referenceDataUpdated,
        },
        updatedAt: receivedAtUtc,
    });
}
