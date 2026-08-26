/**
 * LABOUR_PHASE2 P2.4 — the farm-level "today so far" reader, and the fence
 * around it.
 *
 * ITS SIBLING TEST IS THE POINT. `appContentDailyCounts.farmScope.test.ts`
 * locks `getTodayCounts` EXCLUDING farm-wide logs, because its consumer chain
 * sums per-plot maps and including them turns a plot's 3 labour entries into 11
 * (ruling `R24`). That door stays shut. This file proves the other half — that
 * the farm-wide work is not lost, it is counted somewhere that has no plot key
 * and therefore cannot be summed per plot.
 *
 * Between them the two files state the whole rule: ONE record, counted ONCE, at
 * the scope the farmer asserted (`P1`, `O-2`).
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect } from 'vitest';
import {
    getFarmWideDaySummary,
    getTodayCounts,
    hasFarmWideWork,
    isFarmWideSelection,
} from '../appContentDailyCounts';
import type { DailyLog } from '../../../types';

const DATE = '2026-08-12';
const OTHER_DATE = '2026-08-11';

const makeLog = (
    id: string,
    date: string,
    selection: Array<{ cropId: string; selectedPlotIds: string[] }>,
    labourCount: number,
    grandTotal?: number,
): DailyLog => ({
    id,
    date,
    context: {
        selection: selection.map(entry => ({
            cropId: entry.cropId,
            cropName: entry.cropId,
            selectedPlotIds: entry.selectedPlotIds,
            selectedPlotNames: entry.selectedPlotIds,
        })),
    },
    cropActivities: [],
    irrigation: [],
    labour: Array.from({ length: labourCount }, (_, i) => ({ id: `${id}-lab-${i}` })),
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    ...(grandTotal === undefined ? {} : { financialSummary: { grandTotal } }),
} as unknown as DailyLog);

/** "आज संपूर्ण शेतात ८ मजूर होते" — no crop, no plot, ₹2400. */
const farmWide = (id = 'farm-1', labour = 1, total?: number) =>
    makeLog(id, DATE, [{ cropId: 'FARM_GLOBAL', selectedPlotIds: [] }], labour, total);

const onPlot = (id: string, plotId: string, labour = 1) =>
    makeLog(id, DATE, [{ cropId: 'grapes', selectedPlotIds: [plotId] }], labour);

describe('isFarmWideSelection — what counts as "the whole farm"', () => {
    it('recognises the sentinel both writers emit', () => {
        expect(isFarmWideSelection([{ cropId: 'FARM_GLOBAL', selectedPlotIds: [] }])).toBe(true);
    });

    it('a plot-scoped selection is not farm-wide', () => {
        expect(isFarmWideSelection([{ cropId: 'grapes', selectedPlotIds: ['plot-a'] }])).toBe(false);
    });

    it('a MISSING cropId is not an assertion of "everywhere"', () => {
        // "We do not know the scope" is not the farmer saying "the whole farm".
        // Reading an absence as an assertion is the guess-scope-from-nothing
        // fabrication O-1 closed.
        expect(isFarmWideSelection([{ selectedPlotIds: [] }])).toBe(false);
        expect(isFarmWideSelection([{ cropId: '', selectedPlotIds: [] }])).toBe(false);
    });

    it('an empty or absent selection asserts nothing', () => {
        expect(isFarmWideSelection([])).toBe(false);
        expect(isFarmWideSelection(undefined)).toBe(false);
        expect(isFarmWideSelection(null)).toBe(false);
    });

    it('a mixed record that names the whole farm counts as farm-wide', () => {
        expect(isFarmWideSelection([
            { cropId: 'grapes', selectedPlotIds: ['plot-a'] },
            { cropId: 'FARM_GLOBAL', selectedPlotIds: [] },
        ])).toBe(true);
    });
});

describe('getFarmWideDaySummary — counted once, at the scope asserted', () => {
    it('finds the whole-farm work the per-plot reader is right to ignore', () => {
        const history = [farmWide('farm-1', 3)];

        // The per-plot reader answers "nothing on plot-a", correctly.
        expect(getTodayCounts(history, 'plot-a', DATE).labour).toBe(0);
        // And the farm-level reader answers "3 farm-wide labour entries".
        expect(getFarmWideDaySummary(history, DATE).counts.labour).toBe(3);
    });

    it('counts ONE record once, however many plots are on screen', () => {
        // This is R24 restated as an assertion. The old "fix" — teaching
        // getTodayCounts to return farm-wide logs — multiplied one record by
        // the plot count. This reader takes no plot at all, so there is no
        // shape in which a caller can reproduce that.
        const history = [farmWide('farm-1', 8)];
        const summary = getFarmWideDaySummary(history, DATE);

        expect(summary.recordCount).toBe(1);
        expect(summary.counts.labour).toBe(8);
    });

    it('ignores plot-scoped records entirely', () => {
        // The mirror of the R24 guard: farm-level must not absorb plot work
        // either, or the two panels would double-count the same day.
        const history = [onPlot('p1', 'plot-a', 3), onPlot('p2', 'plot-b', 4)];
        const summary = getFarmWideDaySummary(history, DATE);

        expect(summary.recordCount).toBe(0);
        expect(summary.counts.labour).toBe(0);
    });

    it('sums several farm-wide records for the same day', () => {
        const history = [farmWide('farm-1', 2), farmWide('farm-2', 5), onPlot('p1', 'plot-a', 9)];
        const summary = getFarmWideDaySummary(history, DATE);

        expect(summary.recordCount).toBe(2);
        expect(summary.counts.labour).toBe(7);
    });

    it("does not reach into another day's records", () => {
        const history = [
            farmWide('today', 2),
            makeLog('yesterday', OTHER_DATE, [{ cropId: 'FARM_GLOBAL', selectedPlotIds: [] }], 6),
        ];

        expect(getFarmWideDaySummary(history, DATE).counts.labour).toBe(2);
        expect(getFarmWideDaySummary(history, OTHER_DATE).counts.labour).toBe(6);
    });

    it('reports zero — not null, not a guess — for a day with no farm-wide work', () => {
        const summary = getFarmWideDaySummary([onPlot('p1', 'plot-a')], DATE);

        expect(summary.recordCount).toBe(0);
        expect(summary.statedSpend).toBe(0);
        expect(hasFarmWideWork(summary)).toBe(false);
    });

    it('an empty history is not an error', () => {
        expect(getFarmWideDaySummary([], DATE).recordCount).toBe(0);
    });
});

describe('the money on those records', () => {
    it('sums what the farmer stated, at the scope he stated it', () => {
        const history = [farmWide('farm-1', 1, 2400), farmWide('farm-2', 1, 600)];
        expect(getFarmWideDaySummary(history, DATE).statedSpend).toBe(3000);
    });

    it('a record carrying no amount contributes nothing, and is not an error', () => {
        // Absent is not zero-with-confidence, but for a SUM they coincide, and
        // the alternative — inventing a figure for a record the farmer put no
        // money on — is the fabrication P4 forbids.
        const history = [farmWide('farm-1', 1, 2400), farmWide('farm-2', 1)];
        const summary = getFarmWideDaySummary(history, DATE);

        expect(summary.statedSpend).toBe(2400);
        expect(summary.recordCount).toBe(2);
    });

    it('never counts a plot-scoped amount into the farm-wide figure', () => {
        // The panel shows what was asserted AT FARM LEVEL. Pulling plot spend in
        // would make it a farm total, which is CostAnalysisSection's job and
        // would double-count against it.
        const plotWithMoney = makeLog('p1', DATE, [{ cropId: 'grapes', selectedPlotIds: ['plot-a'] }], 1, 5000);
        expect(getFarmWideDaySummary([plotWithMoney], DATE).statedSpend).toBe(0);
    });

    it('does not split a farm-wide amount across anything', () => {
        // O-2: guessing a per-plot share would invent a number the farmer never
        // gave. The figure appears whole, at farm level, or not at all.
        const summary = getFarmWideDaySummary([farmWide('farm-1', 8, 2400)], DATE);
        expect(summary.statedSpend).toBe(2400);
    });
});
