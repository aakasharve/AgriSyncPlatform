/**
 * LABOUR_PHASE2 P2.3 — item C, and a correction to how it was framed.
 *
 * The brief called both functions here under-counters and asked that a
 * farm-wide log be pulled into them. THE CODE SAYS OTHERWISE, and the
 * difference is the over-count failure, not a style preference:
 *
 *   `getTodayCounts(history, plotId, dateStr)` answers ONE question — "what was
 *   logged today FOR THIS PLOT". Its only consumer chain is
 *   `AppContent.tsx:69` → `mainView.tsx:494-505`, which calls it once per plot
 *   in the current context and hands the map to `ManualEntry`, and
 *   `ManualEntry.tsx:356-373` SUMS those per-plot maps across
 *   `selectedPlotIds`. So making this function return a farm-wide log for any
 *   plotId multiplies that log by the number of plots in context: the farmer's
 *   8 farm-wide workers are reported as 24 on a three-plot context. That is
 *   precisely the over-count half of the P4 failure, and it also attributes
 *   farm work to a plot the farmer never named (founder decision O-2).
 *   Excluding a farm-wide log from a per-plot count is therefore CORRECT, and
 *   these tests exist to stop the next reader "fixing" it.
 *
 *   `getTodayPlotData(history, crops)` is a per-plot rollup whose entry type
 *   requires a real `Plot` AND a real `CropProfile`. A farm-wide log has
 *   neither, so a row for it could only be built by fabricating both — closed
 *   by founder decision O-1. It is also currently UNREAD: `AppContent.tsx:71`
 *   provides it and `AppFeatureContexts.tsx:9` declares it, but nothing
 *   destructures it, so no change here can reach a farmer.
 *
 * WHERE THE REAL UNDER-COUNT IS. When the farmer's context IS the whole farm,
 * `mainView.tsx:498-502` derives its plot ids from that context, gets none, and
 * passes `{}`; `ManualEntry` then shows zeros while a farm-wide log exists for
 * today. The farm-level day figure has no home in this module, and the fix is
 * in those two `.tsx` files — outside this task's gate. The farm-level day
 * total that DOES exist, `dayState.getDayState`, already includes farm-wide
 * logs, because `logInScope` (dayState.ts:119-129) treats an empty filter as
 * "not filtered".
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect } from 'vitest';
import { getTodayCounts } from '../appContentDailyCounts';
import type { DailyLog } from '../../../types';

const DATE = '2026-08-12';

const log = (
    selection: Array<{ cropId: string; selectedPlotIds: string[] }>,
    labourCount: number,
): DailyLog => ({
    id: `log-${selection[0].cropId}-${labourCount}`,
    date: DATE,
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
    labour: Array.from({ length: labourCount }, (_, i) => ({ id: `l${i}` })),
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
} as unknown as DailyLog);

/** 8 workers, recorded for the whole farm — no crop, no plot. */
const farmWideLog = () => log([{ cropId: 'FARM_GLOBAL', selectedPlotIds: [] }], 8);

describe('getTodayCounts — a per-plot tally must not claim farm-wide work for a plot', () => {
    it('does NOT add a farm-wide log to a plot the farmer did not name', () => {
        // The consumer sums this across every plot in context, so counting it
        // here reports 8 farm-wide workers as 16 on a two-plot context.
        expect(getTodayCounts([farmWideLog()], 'plot-1', DATE).labour).toBe(0);
        expect(getTodayCounts([farmWideLog()], 'plot-2', DATE).labour).toBe(0);
    });

    it('keeps a farm-wide log out of EVERY plot, not just unrelated ones', () => {
        const history = [farmWideLog(), log([{ cropId: 'crop-1', selectedPlotIds: ['plot-1'] }], 3)];

        // plot-1's own 3 workers, and only those.
        expect(getTodayCounts(history, 'plot-1', DATE).labour).toBe(3);
    });

    // ---- ordinary behaviour, unchanged ----

    it('still counts a plot-scoped log for its own plot', () => {
        const history = [log([{ cropId: 'crop-1', selectedPlotIds: ['plot-1'] }], 4)];

        expect(getTodayCounts(history, 'plot-1', DATE).labour).toBe(4);
        expect(getTodayCounts(history, 'plot-2', DATE).labour).toBe(0);
    });

    it('still counts a multi-plot log for each plot it names', () => {
        // Unchanged, and deliberately different from the farm-wide case: the
        // farmer named both plots, so both are his own assertion.
        const history = [log([{ cropId: 'crop-1', selectedPlotIds: ['plot-1', 'plot-2'] }], 2)];

        expect(getTodayCounts(history, 'plot-1', DATE).labour).toBe(2);
        expect(getTodayCounts(history, 'plot-2', DATE).labour).toBe(2);
    });

    it('still ignores other days', () => {
        expect(getTodayCounts([log([{ cropId: 'crop-1', selectedPlotIds: ['plot-1'] }], 4)], 'plot-1', '2026-08-11').labour).toBe(0);
    });
});
