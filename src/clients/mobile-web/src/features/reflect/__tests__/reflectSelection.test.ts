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
    isLogInScope, pickCrop, plotRefsInScope, selectAll, soloPlotId, togglePlot, toViewScope, viewHasManyPlots,
} from '../overview/reflectSelection';
import { CANE, CROPS, GRAPE, crop, farmLog, log, plot } from './reflectFixtures';

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

/**
 * Lane UI-9a (founder pick, overview C): with MANY plots in view and every plot picked, one tap on a number shows ONLY that plot
 * (before: the tap took it off, so one plot of 15 took 14 taps). A small farm keeps the tap it always had.
 */
describe('reflect selection - one tap shows only that plot (many plots)', () => {
    const many = crop('grape', 'द्राक्ष', 'Grapes', 'bg-purple-500', Array.from({ length: 15 }, (_, i) => plot(`g${i + 1}`, `द्राक्ष G${i + 1}`)));
    const FARM = [many, CANE];
    const idsOf = (sel: { plotIds: string[] }) => [...sel.plotIds].sort();

    it('a view with 7 or more plots of a crop is a "many plots" view; 6 are not', () => {
        expect(viewHasManyPlots(FARM, 'all')).toBe(true);
        expect(viewHasManyPlots(FARM, 'grape')).toBe(true);
        expect(viewHasManyPlots(FARM, 'cane')).toBe(false); // the one-plot crop on its own
        const six = crop('g', 'द्राक्ष', 'Grapes', 'bg-purple-500', Array.from({ length: 6 }, (_, i) => plot(`s${i}`, `S${i}`)));
        expect(viewHasManyPlots([six], 'all')).toBe(false);
        const seven = crop('g', 'द्राक्ष', 'Grapes', 'bg-purple-500', Array.from({ length: 7 }, (_, i) => plot(`s${i}`, `S${i}`)));
        expect(viewHasManyPlots([seven], 'all')).toBe(true);
    });

    it('with all plots picked, one tap on a number shows ONLY that plot, and the page is on that plot alone', () => {
        const sel = togglePlot(FARM, selectAll(FARM), 'g7');
        expect(sel.plotIds).toEqual(['g7']);
        const scope = toViewScope(FARM, sel);
        expect(scope.viewCrops).toEqual(['grape']);
        expect(scope.viewPlots).toEqual({ grape: ['g7'] });
        expect(plotRefsInScope(FARM, scope).map(r => r.key)).toEqual(['grape:g7']);
        expect(soloPlotId(FARM, sel)).toBe('g7');
    });

    it('also with one crop picked: all of its plots picked and one tap shows only that plot', () => {
        const sel = togglePlot(FARM, pickCrop(FARM, 'grape'), 'g3');
        expect(sel).toMatchObject({ crop: 'grape', plotIds: ['g3'] });
    });

    it('after that first tap, taps add and remove as usual', () => {
        let sel = togglePlot(FARM, selectAll(FARM), 'g7');
        sel = togglePlot(FARM, sel, 'g9');
        expect(idsOf(sel)).toEqual(['g7', 'g9']);
        expect(soloPlotId(FARM, sel)).toBeUndefined();
        sel = togglePlot(FARM, sel, 'g7');
        expect(sel.plotIds).toEqual(['g9']);
        sel = togglePlot(FARM, sel, 'c1'); // a plot of the other crop adds as usual
        expect(idsOf(sel)).toEqual(['c1', 'g9']);
    });

    it('un-picking the only picked plot brings every plot back (the page is never empty)', () => {
        const solo = togglePlot(FARM, selectAll(FARM), 'g7');
        const back = togglePlot(FARM, solo, 'g7');
        expect(idsOf(back)).toEqual(idsOf(selectAll(FARM)));
        expect(toViewScope(FARM, back).viewCrops).toEqual(['grape', 'cane']);
    });

    it('with only some plots picked a tap still adds or removes (the solo rule is for "all picked" only)', () => {
        const some = { crop: 'all', plotIds: ['g1', 'g2', 'g3'] };
        expect(togglePlot(FARM, some, 'g2').plotIds).toEqual(['g1', 'g3']);
        expect(togglePlot(FARM, some, 'g4').plotIds).toEqual(['g1', 'g2', 'g3', 'g4']);
    });

    it('a small farm keeps the tap it always had: with every plot picked a tap takes that plot OFF', () => {
        const sel = togglePlot(CROPS, selectAll(CROPS), 'g1');
        expect(idsOf(sel)).toEqual(['c1', 'g2']);
        expect(soloPlotId(CROPS, sel)).toBeUndefined(); // no "only G7" line for a small farm
    });

    it('soloPlotId names the one plot only in a many-plots view with exactly one picked', () => {
        expect(soloPlotId(FARM, selectAll(FARM))).toBeUndefined();
        expect(soloPlotId(FARM, { crop: 'all', plotIds: ['g1', 'g2'] })).toBeUndefined();
        expect(soloPlotId(FARM, { crop: 'all', plotIds: ['g5'] })).toBe('g5');
    });
});
