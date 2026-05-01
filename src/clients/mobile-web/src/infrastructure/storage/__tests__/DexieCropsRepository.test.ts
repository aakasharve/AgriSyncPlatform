/**
 * Sub-plan 04 Task 2 — DexieCropsRepository round-trip behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DexieCropsRepository } from '../DexieCropsRepository';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import type { CropProfile } from '../../../types';

async function freshDb() {
    const db = getDatabase();
    try { await db.delete(); } catch { /* ignore */ }
    await resetDatabase();
}

describe('DexieCropsRepository', () => {
    beforeEach(freshDb);

    it('returns empty array when no crops are stored', async () => {
        const repo = new DexieCropsRepository();
        expect(await repo.getAll()).toEqual([]);
    });

    it('saves and retrieves a single crop', async () => {
        const repo = new DexieCropsRepository();
        const crop: CropProfile = {
            id: 'crop_grapes',
            name: 'Grapes',
            iconName: 'Grape',
            color: 'bg-emerald-500',
            plots: [],
            workflow: [],
            supportedTasks: [],
            activeScheduleId: null,
        } as unknown as CropProfile;

        await repo.save([crop]);
        const fetched = await repo.getAll();

        expect(fetched).toHaveLength(1);
        expect(fetched[0].id).toBe('crop_grapes');
        expect(fetched[0].name).toBe('Grapes');
    });

    it('save() replaces all rows (full-set semantics)', async () => {
        const repo = new DexieCropsRepository();
        const cropA = { id: 'a', name: 'A', plots: [] } as unknown as CropProfile;
        const cropB = { id: 'b', name: 'B', plots: [] } as unknown as CropProfile;

        await repo.save([cropA, cropB]);
        expect((await repo.getAll()).map(c => c.id).sort()).toEqual(['a', 'b']);

        await repo.save([cropA]);
        expect((await repo.getAll()).map(c => c.id)).toEqual(['a']);
    });
});
