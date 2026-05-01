// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 2 (T2-3) — DexieCropsRepository round-trip coverage.
 *
 * Locks the storage-boundary contract that Sub-plan 04's mobile-web app
 * relies on for crops. The repository implements the existing
 * `CropRepository` port (application/ports/AppDataSource), so swapping out
 * the implementation in DexieDataSource (T2-5) does not change any caller.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { resetDatabase, getDatabase } from '../DexieDatabase';
import { DexieCropsRepository } from '../DexieCropsRepository';
import type { CropProfile } from '../../../types';

const minimalCrop = (id: string, name: string): CropProfile => ({
    id,
    name,
    iconName: 'Sprout',
    color: 'bg-emerald-500',
    plots: [],
    supportedTasks: [],
    workflow: [],
});

describe('DexieCropsRepository (Sub-plan 04 Task 2)', () => {
    beforeEach(async () => {
        // Delete + null the singleton so each test sees a fresh DB and
        // doesn't carry rows from the previous case.
        const db = getDatabase();
        await db.delete();
        await resetDatabase();
    });

    it('returns an empty array when no crops are stored', async () => {
        const repo = new DexieCropsRepository();
        expect(await repo.getAll()).toEqual([]);
    });

    it('round-trips a single crop via save() then getAll()', async () => {
        const repo = new DexieCropsRepository();
        await repo.save([minimalCrop('crop_grapes', 'Grapes')]);

        const fetched = await repo.getAll();
        expect(fetched).toHaveLength(1);
        expect(fetched[0].id).toBe('crop_grapes');
        expect(fetched[0].name).toBe('Grapes');
    });

    it('round-trips multiple crops preserving identity', async () => {
        const repo = new DexieCropsRepository();
        await repo.save([
            minimalCrop('crop_grapes', 'Grapes'),
            minimalCrop('crop_onion', 'Onion'),
            minimalCrop('crop_sugarcane', 'Sugarcane'),
        ]);

        const fetched = await repo.getAll();
        expect(new Set(fetched.map(c => c.id))).toEqual(
            new Set(['crop_grapes', 'crop_onion', 'crop_sugarcane'])
        );
    });

    it('save() is replace-all semantics (clears prior rows)', async () => {
        const repo = new DexieCropsRepository();
        await repo.save([
            minimalCrop('crop_grapes', 'Grapes'),
            minimalCrop('crop_onion', 'Onion'),
        ]);

        await repo.save([minimalCrop('crop_wheat', 'Wheat')]);

        const fetched = await repo.getAll();
        expect(fetched).toHaveLength(1);
        expect(fetched[0].id).toBe('crop_wheat');
    });
});
