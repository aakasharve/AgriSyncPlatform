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
import type { CostCategoryRef } from '../../../../domain/finance/CostCategory';
import { schedulePicturesSignature } from '../../../scheduler/pictures/schedulePictureDownload';

export const REFERENCE_DATA_VERSION_META_KEY =
    'shramsafal_reference_data_version_hash_v1';

/**
 * spec: plr-d10 lane SCH-ID-P - which pictures the last pull named for the schedules. The server's version hash covers the schedules' content
 * but NOT their picture fields, so a photo added, replaced or removed would otherwise never reach the stored list (and a phone that restarts
 * offline would lose it from its schedules).
 */
export const SCHEDULE_PICTURES_SIGNATURE_META_KEY =
    'shramsafal_schedule_pictures_signature_v1';

type ReferencePayload = SyncPullResponse & {
    scheduleTemplates?: unknown[];
    cropTypes?: unknown[];
    activityCategories?: string[];
    // DATA_PRINCIPLE_SPINE 02.5 — wire-shape change: server now emits
    // CostCategoryRef[] (id + mr/hi/en) instead of a flat string array.
    costCategories?: CostCategoryRef[];
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

    // Same schedules, other pictures: only the schedule list is rewritten (the other three rows and the update flag are untouched).
    const picturesSignature = schedulePicturesSignature(scheduleTemplates);
    const previousPictures = await db.appMeta.get(SCHEDULE_PICTURES_SIGNATURE_META_KEY);
    const previousPicturesSignature = typeof previousPictures?.value === 'string' ? previousPictures.value : '';
    if (!referenceDataUpdated && previousPicturesSignature !== picturesSignature) {
        await db.referenceData.put({
            key: 'scheduleTemplates',
            data: scheduleTemplates,
            versionHash: referenceDataVersionHash,
            updatedAt: receivedAtUtc,
        });
    }
    if (previousPicturesSignature !== picturesSignature) {
        await db.appMeta.put({
            key: SCHEDULE_PICTURES_SIGNATURE_META_KEY,
            value: picturesSignature,
            updatedAt: receivedAtUtc,
        });
    }

    await db.appMeta.put({
        key: REFERENCE_DATA_VERSION_META_KEY,
        value: referenceDataVersionHash,
        updatedAt: receivedAtUtc,
    });

    return referenceDataUpdated;
}
