/**
 * LABOUR_PHASE2 P2.4 — the half of the farm-wide-cost fix that makes the
 * already-shipped half REACHABLE.
 *
 * `costAnalysisHelpers.farmScope.test.ts` (P2.3) proved `getScopedLogCost` does
 * the right thing when it is handed empty filter sets. This file is about the
 * fact that it never was: both screens resolve "nothing selected" into "every
 * crop, every plot" before calling it, so the empty-set branch was dead code and
 * a farm-wide cost the farmer really incurred reported ₹0 (`P4`).
 *
 * `isWholeFarmSelection` is the question that resolution destroyed — did the
 * farmer ask for EVERYTHING, or for something? The two tests at the bottom join
 * it to `getScopedLogCost` and assert the outcome that actually matters to a
 * farmer: his whole-farm spend appears in his farm total, and appears on no
 * single plot.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect } from 'vitest';
import { isWholeFarmSelection, getScopedLogCost } from '../costAnalysisHelpers';
import type { CropProfile, DailyLog } from '../../../../types';

/** Two crops: grapes with plots A and B, sugarcane with plot C. */
const crops = [
    { id: 'grapes', plots: [{ id: 'plot-a' }, { id: 'plot-b' }] },
    { id: 'cane', plots: [{ id: 'plot-c' }] },
] as unknown as CropProfile[];

const ALL_CROPS = ['grapes', 'cane'];
const ALL_PLOTS = { grapes: ['plot-a', 'plot-b'], cane: ['plot-c'] };

/** ₹2400 of labour recorded for the whole farm — no crop, no plot named. */
const farmWideLog = (grandTotal = 2400): DailyLog => ({
    id: 'log-farm',
    date: '2026-08-12',
    context: {
        selection: [{
            cropId: 'FARM_GLOBAL',
            cropName: 'Entire Farm',
            selectedPlotIds: [],
            selectedPlotNames: [],
        }],
    },
    financialSummary: { grandTotal },
} as unknown as DailyLog);

describe('isWholeFarmSelection — did the farmer narrow anything?', () => {
    it('an empty selection is the whole farm', () => {
        // "Not filtered" — the convention `getScopedLogCost` and
        // `dayState.logInScope` already read.
        expect(isWholeFarmSelection(crops, [], {})).toBe(true);
    });

    it('ticking EVERY crop and EVERY plot is also the whole farm', () => {
        // This is the case that actually ships: ReflectPage seeds both to all
        // on mount, so an empty selection never survives past first render. A
        // farmer who has narrowed nothing must get the same total whichever
        // route he took to say so.
        expect(isWholeFarmSelection(crops, ALL_CROPS, ALL_PLOTS)).toBe(true);
    });

    it('all crops with no per-crop plot lists is the whole farm', () => {
        expect(isWholeFarmSelection(crops, ALL_CROPS, {})).toBe(true);
    });

    it('one crop of two is NOT the whole farm', () => {
        expect(isWholeFarmSelection(crops, ['grapes'], ALL_PLOTS)).toBe(false);
    });

    it('all crops but one plot short is NOT the whole farm', () => {
        // The subtle one. Every crop is ticked, so a crop-level check alone
        // would call this the whole farm and drop a farm-wide cost onto a view
        // the farmer has genuinely narrowed.
        expect(isWholeFarmSelection(crops, ALL_CROPS, { grapes: ['plot-a'], cane: ['plot-c'] }))
            .toBe(false);
    });

    it('a narrowed plot list on ONE crop is enough to disqualify', () => {
        expect(isWholeFarmSelection(crops, [], { grapes: ['plot-a'] })).toBe(false);
    });

    it('FARM_GLOBAL in the crop list is not the farmer naming a crop', () => {
        // The crop list never contains FARM_GLOBAL, so leaving it in would make
        // the "every crop is selected" comparison fail forever.
        expect(isWholeFarmSelection(crops, ['FARM_GLOBAL', ...ALL_CROPS], ALL_PLOTS)).toBe(true);
        expect(isWholeFarmSelection(crops, ['FARM_GLOBAL'], {})).toBe(true);
    });

    it('a farm with no crops yet has nothing to narrow', () => {
        expect(isWholeFarmSelection([], [], {})).toBe(true);
    });

    it('a crop with no plots does not block the whole-farm reading', () => {
        const cropless = [{ id: 'grapes', plots: [] }] as unknown as CropProfile[];
        expect(isWholeFarmSelection(cropless, ['grapes'], {})).toBe(true);
    });

    it('an empty plot list for a crop means "not filtered", not "none"', () => {
        expect(isWholeFarmSelection(crops, ALL_CROPS, { grapes: [], cane: [] })).toBe(true);
    });
});

describe('the farmer-visible outcome the predicate unlocks', () => {
    it("a whole-farm view shows the whole farm's spend", () => {
        // What the screen does today: resolve to every crop and every plot,
        // hand those to getScopedLogCost, and get ₹0 for a real ₹2400 spend.
        const resolvedCropIds = new Set(ALL_CROPS);
        const resolvedPlotIds = new Set(['plot-a', 'plot-b', 'plot-c']);
        expect(getScopedLogCost(farmWideLog(), resolvedCropIds, resolvedPlotIds)).toBe(0);

        // What it does once the predicate decides which sets to pass.
        const isWholeFarm = isWholeFarmSelection(crops, ALL_CROPS, ALL_PLOTS);
        const cropIds = isWholeFarm ? new Set<string>() : resolvedCropIds;
        const plotIds = isWholeFarm ? new Set<string>() : resolvedPlotIds;
        expect(getScopedLogCost(farmWideLog(), cropIds, plotIds)).toBe(2400);
    });

    it('and a narrowed view still shows it on NO plot', () => {
        // The founder ruling, and `P1`: a farm-wide cost appears in the farm
        // total and is never attributed to a single plot. Guessing a split
        // would invent a number the farmer never gave (`O-2`).
        const narrowed = { grapes: ['plot-a'], cane: ['plot-c'] };
        const isWholeFarm = isWholeFarmSelection(crops, ALL_CROPS, narrowed);
        expect(isWholeFarm).toBe(false);

        const cropIds = isWholeFarm ? new Set<string>() : new Set(ALL_CROPS);
        const plotIds = isWholeFarm ? new Set<string>() : new Set(['plot-a', 'plot-c']);
        expect(getScopedLogCost(farmWideLog(), cropIds, plotIds)).toBe(0);
    });

    it('a plot-scoped log is unaffected either way', () => {
        // The widening must not disturb the ordinary case. With every crop and
        // plot selected the log already scored its full cost; with empty sets
        // ("not filtered") it must score exactly the same.
        const plotLog = {
            id: 'log-plot',
            date: '2026-08-12',
            context: {
                selection: [{
                    cropId: 'grapes',
                    cropName: 'Grapes',
                    selectedPlotIds: ['plot-a'],
                    selectedPlotNames: ['A'],
                }],
            },
            financialSummary: { grandTotal: 900 },
        } as unknown as DailyLog;

        const resolved = getScopedLogCost(plotLog, new Set(ALL_CROPS), new Set(['plot-a', 'plot-b', 'plot-c']));
        const widened = getScopedLogCost(plotLog, new Set<string>(), new Set<string>());

        expect(resolved).toBe(900);
        expect(widened).toBe(900);
    });
});
