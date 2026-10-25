/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The selection rules of the crop -> plot flow (PLR-D5): several crops, only the plots
 * worked, "all" shortcuts, the exclusive whole-farm choice. Same contract as CropSelector.
 */
import { describe, expect, it } from 'vitest';
import {
    EMPTY_SELECTION, FARM_GLOBAL, allCropsSelected, allPlotsSelected, isReady, pendingCrops, selectAllPlots,
    selectEverything, toggleCrop, toggleGlobal, togglePlot, totalPlots,
} from '../cropSelection';

const CANE = { id: 'cane', plots: [{ id: 'cane1' }, { id: 'cane2' }] };
const GRAPE = { id: 'grape', plots: [{ id: 'g1' }, { id: 'g2' }] };
const GUAVA = { id: 'guava', plots: [{ id: 'gu1' }] };
const ALL = [CANE, GRAPE, GUAVA];

describe('cropSelection', () => {
    it('a farmer can pick two crops out of three and only the plots he worked (adjacent plots across crops)', () => {
        let s = toggleCrop(EMPTY_SELECTION, CANE);
        s = togglePlot(s, 'cane', 'cane2');
        s = toggleCrop(s, GRAPE);
        s = togglePlot(s, 'grape', 'g1');
        expect(s.crops).toEqual(['cane', 'grape']);
        expect(s.plots).toEqual({ cane: ['cane2'], grape: ['g1'] });
        expect(totalPlots(s)).toBe(2);
        expect(isReady(s)).toBe(true);
        expect(s.crops).not.toContain('guava');
    });

    it('a crop with several plots starts with none chosen; a single-plot crop has its plot chosen for him', () => {
        expect(toggleCrop(EMPTY_SELECTION, CANE).plots).toEqual({ cane: [] });
        expect(toggleCrop(EMPTY_SELECTION, GUAVA).plots).toEqual({ guava: ['gu1'] });
        expect(isReady(toggleCrop(EMPTY_SELECTION, CANE))).toBe(false);
        expect(isReady(toggleCrop(EMPTY_SELECTION, GUAVA))).toBe(true);
    });

    it('removing a crop removes its plots; a plot toggles on and off', () => {
        let s = togglePlot(toggleCrop(EMPTY_SELECTION, CANE), 'cane', 'cane1');
        s = togglePlot(s, 'cane', 'cane2');
        expect(s.plots.cane).toEqual(['cane1', 'cane2']);
        s = togglePlot(s, 'cane', 'cane1');
        expect(s.plots.cane).toEqual(['cane2']);
        s = toggleCrop(s, CANE);
        expect(s).toEqual(EMPTY_SELECTION);
    });

    it('the whole farm is exclusive and ready with no plot; picking a crop or plot leaves it', () => {
        const g = toggleGlobal(EMPTY_SELECTION);
        expect(g.crops).toEqual([FARM_GLOBAL]);
        expect(isReady(g)).toBe(true);
        expect(toggleGlobal(g)).toEqual(EMPTY_SELECTION);
        expect(toggleCrop(g, GRAPE).crops).toEqual(['grape']);
        expect(togglePlot(g, 'cane', 'cane1').crops).toEqual(['cane']);
    });

    it('"all" shortcuts: everything, or every plot of the crops already chosen', () => {
        const everything = selectEverything(ALL);
        expect(everything.crops).toEqual(['cane', 'grape', 'guava']);
        expect(totalPlots(everything)).toBe(5);
        expect(allCropsSelected(everything, ALL)).toBe(true);

        const two = toggleCrop(toggleCrop(EMPTY_SELECTION, CANE), GRAPE);
        expect(allPlotsSelected(two, ALL)).toBe(false);
        const filled = selectAllPlots(two, ALL);
        expect(filled.plots).toEqual({ cane: ['cane1', 'cane2'], grape: ['g1', 'g2'] });
        expect(allPlotsSelected(filled, ALL)).toBe(true);
        expect(allCropsSelected(filled, ALL)).toBe(false);
    });

    it('reports crops chosen but with no plot yet (so the screen can say so)', () => {
        const s = togglePlot(toggleCrop(toggleCrop(EMPTY_SELECTION, CANE), GRAPE), 'grape', 'g1');
        expect(pendingCrops(s)).toEqual(['cane']);
    });
});
