// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 - the crop list's merge-safe save. `save()` replaces the whole list (the download's own write); a screen's save
 * goes through `saveMerged`, which reads the list AS STORED, inside one transaction, and writes what the merge makes of it. So a
 * farm's save is merged into the newest stored list, never into a copy the screen held from before a download.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import { DexieCropsRepository } from '../DexieCropsRepository';
import type { CropProfile, Plot } from '../../../types';

const plot = (id: string): Plot => ({ id, name: id, baseline: { totalArea: 1, unit: 'Acre' } } as Plot);
const crop = (id: string, plots: Plot[]): CropProfile => ({ id, name: id, iconName: 'Sprout', color: 'bg-emerald-500', plots, supportedTasks: [], workflow: [] });

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
});

describe('DexieCropsRepository.saveMerged', () => {
    it('hands the merge the list as stored now, writes its answer and returns it', async () => {
        const repo = new DexieCropsRepository();
        await repo.save([crop('crop_tomato', [plot('a1'), plot('b1')])]);
        // A download lands after the screen read the list: farm A gains a plot the screen never saw.
        await repo.save([crop('crop_tomato', [plot('a1'), plot('a2'), plot('b1')])]);

        let handed: CropProfile[] = [];
        const out = await repo.saveMerged(stored => {
            handed = stored;
            return [{ ...stored[0], plots: [...stored[0].plots, plot('b2')] }];
        });

        expect(handed[0].plots.map(p => p.id)).toEqual(['a1', 'a2', 'b1']);
        expect(out[0].plots.map(p => p.id)).toEqual(['a1', 'a2', 'b1', 'b2']);
        expect((await repo.getAll())[0].plots.map(p => p.id)).toEqual(['a1', 'a2', 'b1', 'b2']);
    });

    it('a merge that throws writes nothing', async () => {
        const repo = new DexieCropsRepository();
        await repo.save([crop('crop_tomato', [plot('a1')])]);
        await expect(repo.saveMerged(() => { throw new Error('no'); })).rejects.toThrow('no');
        expect((await repo.getAll())[0].plots.map(p => p.id)).toEqual(['a1']);
    });
});
