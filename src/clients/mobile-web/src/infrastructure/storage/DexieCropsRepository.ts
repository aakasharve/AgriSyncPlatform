/**
 * Sub-plan 04 Task 2 — Dexie-backed crops repository.
 *
 * Replaces the inline LocalCropRepository in DexieDataSource.ts. Crops were
 * the last domain blob still living in localStorage; moving them to Dexie
 * unlocks the localStorage architecture gate enforced by Task 3.
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
