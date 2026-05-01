/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 2 — Dexie-backed CropRepository.
 *
 * Replaces the localStorage-backed implementation in `DexieDataSource.ts`
 * (`LocalCropRepository`). Implements the existing `CropRepository` port
 * one-for-one so callers don't need to change.
 *
 * Storage shape: each crop is stored as one row in the v14 `crops` store
 * with `id` (e.g. `crop_grapes`) as the primary key and the full
 * CropProfile blob as `data`. `updatedAtMs` is recorded for migrator
 * freshness checks but is not consumed by callers today.
 *
 * `save()` is replace-all semantics (clear + bulkAdd in a single
 * transaction) to mirror the behavior of the localStorage implementation
 * it replaces — which writes the entire JSON-serialized crops array
 * atomically. The transactional boundary keeps reads consistent with
 * concurrent writes.
 */

import { getDatabase } from './DexieDatabase';
import type { CropRepository } from '../../application/ports/AppDataSource';
import type { CropProfile } from '../../types';
import { normalizeMojibakeDeep } from '../../shared/utils/textEncoding';

export class DexieCropsRepository implements CropRepository {
    async getAll(): Promise<CropProfile[]> {
        const rows = await getDatabase().crops.toArray();
        const raw = rows.map(r => r.data as CropProfile);
        return normalizeMojibakeDeep(raw).value as CropProfile[];
    }

    async save(crops: CropProfile[]): Promise<void> {
        const db = getDatabase();
        const normalized = normalizeMojibakeDeep(crops).value as CropProfile[];
        const now = Date.now();
        await db.transaction('rw', db.crops, async () => {
            await db.crops.clear();
            await db.crops.bulkAdd(
                normalized.map(c => ({ id: c.id, data: c, updatedAtMs: now }))
            );
        });
    }
}
