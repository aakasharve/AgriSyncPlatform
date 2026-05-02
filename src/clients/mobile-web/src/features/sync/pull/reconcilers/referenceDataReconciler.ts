/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Persists scheduleTemplates / cropTypes / activityCategories /
 * costCategories into Dexie's referenceData table, version-gated by
 * `referenceDataVersionHash`. Updates the version meta entry so the
 * post-tx setScheduleTemplatesFromReferenceData call sees fresh data.
 *
 * Must run inside the orchestrator's `db.transaction('rw', ...)` block.
 *
 * Returns true if reference data tables were rewritten this pull.
 */

import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';

export const REFERENCE_DATA_VERSION_META_KEY =
    'shramsafal_reference_data_version_hash_v1';

type ReferencePayload = SyncPullResponse & {
    scheduleTemplates?: unknown[];
    cropTypes?: unknown[];
    activityCategories?: string[];
    costCategories?: string[];
    referenceDataVersionHash?: string;
};

export async function reconcileReferenceData(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    receivedAtUtc: string,
): Promise<boolean> {
    const referencePayload = payload as ReferencePayload;
    const scheduleTemplates = referencePayload.scheduleTemplates ?? [];
    const cropTypes = referencePayload.cropTypes ?? [];
    const activityCategories = referencePayload.activityCategories ?? [];
    const costCategories = referencePayload.costCategories ?? [];
    const referenceDataVersionHash =
        referencePayload.referenceDataVersionHash?.trim() ?? '';

    if (referenceDataVersionHash.length === 0) {
        return false;
    }

    const previousVersionMeta = await db.appMeta.get(REFERENCE_DATA_VERSION_META_KEY);
    const previousVersionHash = typeof previousVersionMeta?.value === 'string'
        ? previousVersionMeta.value
        : '';

    let referenceDataUpdated = false;
    if (previousVersionHash !== referenceDataVersionHash) {
        await db.referenceData.put({
            key: 'scheduleTemplates',
            data: scheduleTemplates,
            versionHash: referenceDataVersionHash,
            updatedAt: receivedAtUtc,
        });
        await db.referenceData.put({
            key: 'cropTypes',
            data: cropTypes,
            versionHash: referenceDataVersionHash,
            updatedAt: receivedAtUtc,
        });
        await db.referenceData.put({
            key: 'activityCategories',
            data: activityCategories,
            versionHash: referenceDataVersionHash,
            updatedAt: receivedAtUtc,
        });
        await db.referenceData.put({
            key: 'costCategories',
            data: costCategories,
            versionHash: referenceDataVersionHash,
            updatedAt: receivedAtUtc,
        });

        referenceDataUpdated = true;
    }

    await db.appMeta.put({
        key: REFERENCE_DATA_VERSION_META_KEY,
        value: referenceDataVersionHash,
        updatedAt: receivedAtUtc,
    });

    return referenceDataUpdated;
}
