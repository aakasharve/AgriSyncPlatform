/**
 * LABOUR_PHASE2 P2.3 — a cost the farmer actually incurred may not vanish from
 * his own total, and may not be pushed onto a plot he never named.
 *
 * WHAT THIS LOCKS. A farm-wide log's only selection is the FARM_GLOBAL one
 * (`LogFactory.ts:402-407`; the pull reconciler writes the same shape).
 * `getNonGlobalSelections` strips exactly that selection, so `allSelections`
 * came back empty and `getScopedLogCost` returned 0 at its first guard —
 * unconditionally, with or without a filter. A farm-wide cost therefore
 * disappeared from cost analysis entirely: not mis-allocated, gone. That is the
 * under-count half of the P4 failure ("no fabricated figure reaches a farmer"
 * cuts both ways — a figure that silently drops the farmer's own money is as
 * false as an invented one).
 *
 * THE RULING THIS ENCODES (founder, this task):
 *   - the unfiltered / farm-level total MUST include a farm-wide cost;
 *   - under a plot filter it MUST NOT — attributing it to that plot would
 *     invent an allocation the farmer never gave (founder decision O-2), and
 *     excluding it is correct because it genuinely is not that plot's cost;
 *   - what is forbidden is the old behaviour: zero everywhere.
 * A crop filter is the same case one level up: a farm-wide log has no crop.
 *
 * "Unfiltered" is an empty filter set — the convention `dayState.logInScope`
 * (dayState.ts:119-129) already uses.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect } from 'vitest';
import { getScopedLogCost } from '../costAnalysisHelpers';
import type { DailyLog } from '../../../../types';

const NONE = new Set<string>();

const log = (
    selection: Array<{ cropId: string; selectedPlotIds: string[] }>,
    grandTotal: number,
): DailyLog => ({
    id: 'log-1',
    date: '2026-08-12',
    context: {
        selection: selection.map(entry => ({
            cropId: entry.cropId,
            cropName: entry.cropId === 'FARM_GLOBAL' ? 'Entire Farm' : entry.cropId,
            selectedPlotIds: entry.selectedPlotIds,
            selectedPlotNames: entry.selectedPlotIds,
        })),
    },
    financialSummary: {
        totalLabourCost: grandTotal,
        totalInputCost: 0,
        totalMachineryCost: 0,
        totalActivityExpenses: 0,
        grandTotal,
    },
} as unknown as DailyLog);

/** 8 workers, ₹2400, recorded for the whole farm — no crop, no plot. */
const farmWideLog = (grandTotal = 2400) =>
    log([{ cropId: 'FARM_GLOBAL', selectedPlotIds: [] }], grandTotal);

describe('getScopedLogCost — a farm-wide cost belongs in the farm total and nowhere else', () => {
    it('counts a farm-wide cost in the unfiltered farm-level total', () => {
        // The bug: this was 0, so ₹2400 the farmer really spent simply was not
        // in the number he was shown.
        expect(getScopedLogCost(farmWideLog(), NONE, NONE)).toBe(2400);
    });

    it('counts it once, in full — no division across plots it was never assigned to', () => {
        // Dividing by a plot count would be the over-count failure wearing a
        // different hat: it invents an allocation to make the arithmetic tidy.
        expect(getScopedLogCost(farmWideLog(900), NONE, NONE)).toBe(900);
    });

    it('does NOT attribute a farm-wide cost to a plot the farmer did not name', () => {
        expect(getScopedLogCost(farmWideLog(), NONE, new Set(['plot-1']))).toBe(0);
    });

    it('does NOT attribute a farm-wide cost to a crop either — it has no crop', () => {
        expect(getScopedLogCost(farmWideLog(), new Set(['crop-1']), NONE)).toBe(0);
    });

    it('does not treat an unknown/blank scope as a farm-wide assertion', () => {
        // "We do not know the scope" is not the farmer saying "the whole farm".
        // Only the explicit FARM_GLOBAL marker counts.
        expect(getScopedLogCost(log([{ cropId: '', selectedPlotIds: [] }], 500), NONE, NONE)).toBe(0);
    });

    it('returns 0 for a farm-wide log that cost nothing, without inventing a figure', () => {
        expect(getScopedLogCost(farmWideLog(0), NONE, NONE)).toBe(0);
    });

    // ---- the regression that matters most: ordinary plot-scoped behaviour ----

    it('leaves an ordinary single-plot cost exactly as before', () => {
        const single = log([{ cropId: 'crop-1', selectedPlotIds: ['plot-1'] }], 1000);

        expect(getScopedLogCost(single, NONE, NONE)).toBe(1000);
        expect(getScopedLogCost(single, new Set(['crop-1']), new Set(['plot-1']))).toBe(1000);
        expect(getScopedLogCost(single, new Set(['crop-1']), new Set(['plot-2']))).toBe(0);
        expect(getScopedLogCost(single, new Set(['crop-2']), NONE)).toBe(0);
    });

    it('leaves the multi-plot proportional split exactly as before', () => {
        const twoPlots = log([{ cropId: 'crop-1', selectedPlotIds: ['plot-1', 'plot-2'] }], 1000);

        expect(getScopedLogCost(twoPlots, NONE, NONE)).toBe(1000);
        expect(getScopedLogCost(twoPlots, NONE, new Set(['plot-1']))).toBe(500);
    });

    it('leaves a crop-scoped log with no plots exactly as before', () => {
        // This selection is NOT farm-wide — it names a crop. It was already
        // included unfiltered and excluded under a plot filter, and still is.
        const cropOnly = log([{ cropId: 'crop-1', selectedPlotIds: [] }], 800);

        expect(getScopedLogCost(cropOnly, NONE, NONE)).toBe(800);
        expect(getScopedLogCost(cropOnly, NONE, new Set(['plot-1']))).toBe(0);
    });
});
