/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 - the save from one farm's screen never deletes another farm's plots. Every crop screen hands back the list it was
 * shown (the OPEN farm's), edited. The old save wrote that list over the whole stored list, so on farm B it would have dropped farm
 * A's six plots. The merge keeps everything the screen was not shown, and removes only what the screen showed and no longer lists.
 */
import { describe, expect, it } from 'vitest';
import type { CropProfile, Plot } from '../../../types';
import { mergeFarmSave } from '../farmCropsMerge';

const A = 'farm-a';
const B = 'farm-b';

const plot = (id: string, over: Partial<Plot> = {}): Plot => ({
    id, name: id.toUpperCase(), baseline: { totalArea: 1, unit: 'Acre' },
    schedule: { id: `sch_${id}`, plotId: id, templateId: 't', referenceType: 'PLANTING', referenceDate: '2026-10-01', stageOverrides: [], expectationOverrides: [] },
    ...over,
} as Plot);
const crop = (id: string, plots: Plot[], over: Partial<CropProfile> = {}): CropProfile => ({
    id, name: id, iconName: 'Sprout', color: 'bg-emerald-500', plots, supportedTasks: [], workflow: [], ...over,
});

const A_PLOTS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const stored = (): CropProfile[] => [crop('crop_tomato', [...A_PLOTS.map(id => plot(id)), plot('b1')])];
/** What farm B's screen was shown: टोमॅटो with B's one plot. */
const seenOnB = (): CropProfile[] => [crop('crop_tomato', [plot('b1')])];
const shape = (crops: CropProfile[]) => crops.map(c => `${c.id}:${c.plots.map(p => p.id).join(',')}`);

describe('a save on farm B keeps all of farm A\'s plots', () => {
    it('adding a plot on B: A\'s six plots stay, and the new plot carries farm B', () => {
        const next = [crop('crop_tomato', [plot('b1'), plot('b2')])];
        const out = mergeFarmSave(stored(), next, seenOnB(), B);
        expect(shape(out)).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6,b1,b2']);
        expect(out[0].plots.find(p => p.id === 'b2')?.farmId).toBe(B);
        expect(out[0].plots.find(p => p.id === 'a1')?.farmId).toBeUndefined();
    });

    it('removing B\'s plot on B: only that plot goes', () => {
        const out = mergeFarmSave(stored(), [crop('crop_tomato', [])], seenOnB(), B);
        expect(shape(out)).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6']);
    });

    it('removing the crop on B removes only B\'s plots of it; the crop stays for A', () => {
        const out = mergeFarmSave(stored(), [], seenOnB(), B);
        expect(shape(out)).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6']);
    });

    it('editing B\'s plot (its map) keeps A\'s plots exactly as they were', () => {
        const before = stored();
        const next = [crop('crop_tomato', [plot('b1', { name: 'B1 नवीन' })])];
        const out = mergeFarmSave(before, next, seenOnB(), B);
        expect(out[0].plots.find(p => p.id === 'b1')?.name).toBe('B1 नवीन');
        for (const id of A_PLOTS) expect(out[0].plots.find(p => p.id === id)).toBe(before[0].plots.find(p => p.id === id));
    });

    it('a crop added on B is kept with farm B on it, after the crops already stored', () => {
        const next = [...seenOnB(), crop('c_new', [])];
        const out = mergeFarmSave(stored(), next, seenOnB(), B);
        expect(shape(out)).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6,b1', 'c_new:']);
        expect(out[1].farmId).toBe(B);
    });

    it('a crop the screen was never shown (another farm\'s, or one a download added since) is kept whole', () => {
        const onion = crop('crop_onion', [plot('a7')]);
        const out = mergeFarmSave([...stored(), onion], seenOnB(), seenOnB(), B);
        expect(shape(out)).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6,b1', 'crop_onion:a7']);
        expect(out[1]).toBe(onion);
    });

    it('a crop made on B and removed on B, holding a plot B was never shown: the plot stays, the crop no longer claims farm B', () => {
        const made = crop('c_b', [plot('b9'), plot('unknown-p')], { farmId: B });
        const out = mergeFarmSave([made], [], [crop('c_b', [plot('b9')], { farmId: B })], B);
        expect(shape(out)).toEqual(['c_b:unknown-p']);
        expect(out[0].farmId).toBeUndefined();
    });
});

describe('a one-farm person: the save is what it was', () => {
    it('everything was shown: the result is the screen\'s own list, in its own order', () => {
        const all = [crop('x', [plot('p1'), plot('p2'), plot('p3')]), crop('y', [plot('q1')]), crop('z', [])];
        const next = [crop('z', []), crop('x', [plot('p3'), plot('p1')])];
        expect(mergeFarmSave(all, next, all, null)).toEqual(next);
    });

    it('a new plot and a new crop on his farm carry it', () => {
        const all = [crop('x', [plot('p1')])];
        const next = [crop('x', [plot('p1'), plot('p2')]), crop('c_new', [])];
        const out = mergeFarmSave(all, next, all, A);
        expect(out[0].plots[1].farmId).toBe(A);
        expect(out[1].farmId).toBe(A);
        expect(shape(out)).toEqual(shape(next));
    });
});
