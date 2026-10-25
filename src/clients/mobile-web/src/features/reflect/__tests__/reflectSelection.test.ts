/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * शेताची स्थिती — which crop and which plots the whole page shows. The page used to keep two loose
 * pieces of state (`viewCrops`, `viewPlots`); the redesign picks a crop ("सर्व पिकं" or one) and its plots,
 * and every other section still reads the SAME two pieces, derived here, so the existing scope rules
 * (`isWholeFarmSelection`, `getScopedLogCost`) keep working unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
    isLogInScope, pickCrop, plotRefsInScope, selectAll, togglePlot, toViewScope,
} from '../overview/reflectSelection';
import { CANE, CROPS, GRAPE, crop, farmLog, log } from './reflectFixtures';

describe('reflect selection', () => {
    it('opens on every crop and every plot', () => {
        const scope = toViewScope(CROPS, selectAll(CROPS));
        expect(scope.viewCrops).toEqual(['grape', 'cane']);
        expect(scope.viewPlots).toEqual({ grape: ['g1', 'g2'], cane: ['c1'] });
    });

    it('picking one crop narrows to that crop with all of its plots', () => {
        const scope = toViewScope(CROPS, pickCrop(CROPS, 'grape'));
        expect(scope.viewCrops).toEqual(['grape']);
        expect(scope.viewPlots).toEqual({ grape: ['g1', 'g2'] });
    });

    it('un-picking a plot hides it; un-picking the last plot picks them all again (never an empty page)', () => {
        let sel = pickCrop(CROPS, 'grape');
        sel = togglePlot(CROPS, sel, 'g2');
        expect(toViewScope(CROPS, sel).viewPlots).toEqual({ grape: ['g1'] });
        sel = togglePlot(CROPS, sel, 'g1');
        expect(toViewScope(CROPS, sel).viewPlots).toEqual({ grape: ['g1', 'g2'] });
    });

    it('a crop whose every plot is un-picked leaves the scope instead of meaning "all of its plots"', () => {
        const sel = togglePlot(CROPS, selectAll(CROPS), 'c1');
        const scope = toViewScope(CROPS, sel);
        expect(scope.viewCrops).toEqual(['grape']);
        expect(scope.viewPlots.cane).toBeUndefined();
    });

    it('a log is in scope only when its crop and one of its plots are picked', () => {
        const scope = toViewScope(CROPS, togglePlot(CROPS, pickCrop(CROPS, 'grape'), 'g2'));
        expect(isLogInScope(log({ id: 'a', plotIds: ['g1'] }), scope)).toBe(true);
        expect(isLogInScope(log({ id: 'b', plotIds: ['g2'] }), scope)).toBe(false);
        expect(isLogInScope(log({ id: 'c', cropId: 'cane', plotIds: ['c1'] }), scope)).toBe(false);
        // the whole-farm record is not any crop's: the farm-wide panel and the calendar carry it
        expect(isLogInScope(farmLog({ id: 'd' }), scope)).toBe(false);
    });

    it('lists one card per picked plot, in the farm order, carrying the crop colour and plot number', () => {
        const refs = plotRefsInScope(CROPS, toViewScope(CROPS, selectAll(CROPS)));
        expect(refs.map(r => r.key)).toEqual(['grape:g1', 'grape:g2', 'cane:c1']);
        expect(refs[1]).toMatchObject({ plotName: 'थॉम्पसन', cropName: 'द्राक्ष', cropColor: 'bg-purple-500', plotIndex: 1 });
        expect(refs[2].crop).toBe(CANE);
        expect(refs[0].plot).toBe(GRAPE.plots[0]);
    });

    it('a crop with no plot yet still gets its one card', () => {
        const bare = crop('onion', 'कांदा', 'Onion', 'bg-amber-500', []);
        const crops = [...CROPS, bare];
        const refs = plotRefsInScope(crops, toViewScope(crops, selectAll(crops)));
        expect(refs.map(r => r.key)).toEqual(['grape:g1', 'grape:g2', 'cane:c1', 'onion']);
        expect(refs[3].plotId).toBeUndefined();
    });
});
