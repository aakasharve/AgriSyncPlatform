// spec: 2026-08-12-labour-phase2-server-truth-farm-context (Phase 2b — B1a)
//
// WHAT THIS FILE IS FOR.
//
// B1a widens the push path so it can carry the farmer's whole spatial
// assertion — `{scope, plotIds, plotId?, cropCycleId?}` — instead of the single
// plot `resolveLogPlot` used to pick with `selectedPlotIds[0]`. B1a changes NO
// behaviour: every log this app can persist today has exactly one plot, so the
// payload it emits must come out the other side unchanged, to the byte.
//
// THAT CLAIM IS ONLY WORTH ANYTHING IF IT WAS MEASURED BEFORE THE CHANGE.
// The first describe block below was written and run against the UNMODIFIED
// `logSyncMutationService.ts` (blob `6ba4cd50`, byte-identical to
// `labour-v1-green`) and passed. It is then re-run against the modified module.
// A test authored after the fact can only prove the new code agrees with
// itself; this one proves the new code agrees with the old.
//
// It asserts the payload TWICE, deliberately:
//   - `Object.keys(...)` — the object as JavaScript sees it, so an added key
//     whose value happens to be `undefined` cannot slip through.
//   - `JSON.stringify(...)` — the object as the WIRE sees it, in order, which
//     is what `MutationQueue` persists and what `/sync/push` receives.
// Either alone is escapable. Together they are the byte-identity claim.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DailyLog } from '../../../../types';

const { enqueueCreate, enqueueTask, plotsGet, cropCyclesWhere, triggerNow } = vi.hoisted(() => ({
    enqueueCreate: vi.fn(),
    enqueueTask: vi.fn(),
    plotsGet: vi.fn(),
    cropCyclesWhere: vi.fn(),
    triggerNow: vi.fn(),
}));

vi.mock('../../../../application/usecases/sync/CreateDailyLogCommand', () => ({
    CreateDailyLogCommand: { enqueue: enqueueCreate },
}));

vi.mock('../../../../application/usecases/sync/AddLogTaskCommand', () => ({
    AddLogTaskCommand: { enqueue: enqueueTask },
}));

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        plots: { get: plotsGet },
        cropCycles: { where: cropCyclesWhere },
    }),
}));

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow },
}));

import { enqueueLogsForSync, resolveLogFarmId } from '../logSyncMutationService';
// NOT mocked, deliberately — the real canonical validator the mutation queue
// runs, so a payload this module builds is proven to be one `/sync/push` will
// accept rather than one that merely looks right.
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const LOG_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FARM_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLOT_A = 'c1c1c1c1-cccc-4ccc-8ccc-cccccccccccc';
const PLOT_B = 'c2c2c2c2-cccc-4ccc-8ccc-cccccccccccc';
const PLOT_C = 'c3c3c3c3-cccc-4ccc-8ccc-cccccccccccc';
const CYCLE_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** A log the way `LogFactory` writes one today: exactly one plot. */
const singlePlotLog = (): DailyLog => ({
    id: LOG_UUID,
    date: '2026-08-12',
    context: {
        selection: [{
            cropId: 'crop-1',
            cropName: 'Grapes',
            selectedPlotIds: [PLOT_A],
            selectedPlotNames: ['Plot A'],
        }],
    },
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    meta: { createdAtISO: '2026-08-12T04:00:00.000Z' },
} as unknown as DailyLog);

/** The shape Phase 2b's un-split factory produces: ONE log, several plots. */
const multiPlotLog = (plotIds: string[]): DailyLog => ({
    ...singlePlotLog(),
    context: {
        selection: [{
            cropId: 'crop-1',
            cropName: 'Grapes',
            selectedPlotIds: plotIds,
            selectedPlotNames: plotIds.map((_, i) => `Plot ${i}`),
        }],
    },
} as unknown as DailyLog);

const farmWideLog = (): DailyLog => ({
    ...singlePlotLog(),
    context: {
        selection: [{
            cropId: 'FARM_GLOBAL',
            cropName: 'Entire Farm',
            selectedPlotIds: [],
            selectedPlotNames: [],
        }],
    },
} as unknown as DailyLog);

const plotRow = (id: string, farmId = FARM_UUID) => ({ payload: { id, farmId } });

const sentPayload = () => enqueueCreate.mock.calls[0][0];

beforeEach(() => {
    enqueueCreate.mockReset().mockResolvedValue('m1');
    enqueueTask.mockReset().mockResolvedValue('m2');
    triggerNow.mockReset().mockResolvedValue(undefined);
    plotsGet.mockReset().mockImplementation(async (id: string) => plotRow(id));
    cropCyclesWhere.mockReset().mockReturnValue({
        equals: () => ({
            toArray: async () => [{
                payload: {
                    id: CYCLE_A,
                    cropName: 'Grapes',
                    modifiedAtUtc: '2026-08-01T00:00:00Z',
                },
            }],
        }),
    });
});

// ---------------------------------------------------------------------------
// The regression that matters most: today's log, unchanged.
// ---------------------------------------------------------------------------

describe('B1a — a single-plot log emits a byte-identical payload', () => {
    it('sends exactly the keys it sent before, in the same order, with the same values', async () => {
        await enqueueLogsForSync([singlePlotLog()]);

        const payload = sentPayload();

        // As JavaScript sees it. A new `scope` or `plotIds` key would show up
        // here even if its value were `undefined` and JSON dropped it.
        expect(Object.keys(payload)).toEqual([
            'dailyLogId',
            'farmId',
            'plotId',
            'cropCycleId',
            'logDate',
            'sourceAiJobId',
            'weatherStamp',
            'labour',
        ]);

        // As the wire sees it.
        expect(JSON.stringify(payload)).toBe(
            `{"dailyLogId":"${LOG_UUID}","farmId":"${FARM_UUID}","plotId":"${PLOT_A}","cropCycleId":"${CYCLE_A}","logDate":"2026-08-12"}`,
        );
    });

    it('states no scope at all — absent is what every shipped client means by "Plot"', async () => {
        await enqueueLogsForSync([singlePlotLog()]);

        const payload = sentPayload();
        expect(Object.prototype.hasOwnProperty.call(payload, 'scope')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(payload, 'plotIds')).toBe(false);
    });

    it('still resolves the plot and the crop cycle out of Dexie, and still queues', async () => {
        const result = await enqueueLogsForSync([singlePlotLog()]);

        expect(result.queuedLogIds).toEqual([LOG_UUID]);
        expect(result.skippedLogIds).toEqual([]);
        expect(triggerNow).toHaveBeenCalledTimes(1);
    });

    it('still skips — and claims nothing — when the plot has not synced down yet', async () => {
        plotsGet.mockResolvedValue(undefined);

        const result = await enqueueLogsForSync([singlePlotLog()]);

        expect(result.queuedLogIds).toEqual([]);
        expect(result.skippedLogIds).toEqual([LOG_UUID]);
        expect(enqueueCreate).not.toHaveBeenCalled();
    });

    it('still skips when the plot has no crop cycle', async () => {
        cropCyclesWhere.mockReturnValue({ equals: () => ({ toArray: async () => [] }) });

        const result = await enqueueLogsForSync([singlePlotLog()]);

        expect(result.skippedLogIds).toEqual([LOG_UUID]);
    });

    it('still skips a farm-wide log, exactly as before — B1a invents no farm id', async () => {
        // `resolveSyncTarget` reads the farm off the plot, and a farm-scoped log
        // has no plot. Making this enqueueable needs a farm id from somewhere
        // that is NOT a plot, which no `.ts` on this path has. Guessing one
        // ("the only farm in Dexie") is the fabrication O-1 closed, so the log
        // stays skipped and the honesty surfaces keep saying so.
        const result = await enqueueLogsForSync([farmWideLog()]);

        expect(result.queuedLogIds).toEqual([]);
        expect(result.skippedLogIds).toEqual([LOG_UUID]);
        expect(enqueueCreate).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// The new capability. Nothing in the app produces these inputs until B1b, so
// they are driven directly.
// ---------------------------------------------------------------------------

describe('B1a — a multi-plot log states the whole set, and no cycle', () => {
    it('emits scope MultiPlot with every plot the farmer named, in selection order', async () => {
        await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B, PLOT_C])]);

        const payload = sentPayload();
        expect(payload.scope).toBe('MultiPlot');
        expect(payload.plotIds).toEqual([PLOT_A, PLOT_B, PLOT_C]);
    });

    it('carries NO plotId and NO cropCycleId — the two keys the CHECK forbids', async () => {
        // Not merely "undefined": `CreateDailyLogHandler` rejects the whole
        // command when either key has a value, and `ck_daily_logs_scope`
        // rejects the row. Absence is the contract.
        await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B])]);

        const payload = sentPayload();
        expect(Object.prototype.hasOwnProperty.call(payload, 'plotId')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(payload, 'cropCycleId')).toBe(false);
    });

    it('never asks Dexie for a crop cycle at all', async () => {
        await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B])]);

        expect(cropCyclesWhere).not.toHaveBeenCalled();
    });

    it('is a payload the canonical schema accepts', async () => {
        await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B, PLOT_C])]);

        expect(validatePayload(SyncMutationName.CreateDailyLog, sentPayload())).toEqual({ ok: true });
    });

    it('reads EVERY selection entry, so a second crop\'s plots are not dropped', async () => {
        const twoCropLog = {
            ...singlePlotLog(),
            context: {
                selection: [
                    { cropId: 'crop-1', cropName: 'Grapes', selectedPlotIds: [PLOT_A], selectedPlotNames: ['A'] },
                    { cropId: 'crop-2', cropName: 'Sugarcane', selectedPlotIds: [PLOT_B], selectedPlotNames: ['B'] },
                ],
            },
        } as unknown as DailyLog;

        await enqueueLogsForSync([twoCropLog]);

        expect(sentPayload().plotIds).toEqual([PLOT_A, PLOT_B]);
    });

    it('collapses a repeated plot instead of sending a set the server refuses', async () => {
        await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B, PLOT_A])]);

        expect(sentPayload().plotIds).toEqual([PLOT_A, PLOT_B]);
    });

    it('falls back to a plain Plot payload when the set collapses to one plot', async () => {
        await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_A])]);

        const payload = sentPayload();
        expect(Object.prototype.hasOwnProperty.call(payload, 'scope')).toBe(false);
        expect(payload.plotId).toBe(PLOT_A);
        expect(payload.cropCycleId).toBe(CYCLE_A);
    });

    it('skips the whole log when ONE of the named plots is unknown to this device', async () => {
        plotsGet.mockImplementation(async (id: string) => (id === PLOT_C ? undefined : plotRow(id)));

        const result = await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B, PLOT_C])]);

        // Queueing {A,B} would silently shrink the farmer's assertion to the
        // plots this device happens to have pulled.
        expect(result.skippedLogIds).toEqual([LOG_UUID]);
        expect(enqueueCreate).not.toHaveBeenCalled();
    });

    it('skips rather than pick a farm when the named plots disagree about one', async () => {
        plotsGet.mockImplementation(async (id: string) =>
            plotRow(id, id === PLOT_B ? 'e0e0e0e0-eeee-4eee-8eee-eeeeeeeeeeee' : FARM_UUID));

        const result = await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B])]);

        expect(result.skippedLogIds).toEqual([LOG_UUID]);
        expect(enqueueCreate).not.toHaveBeenCalled();
    });
});

describe('B1a — resolveLogFarmId, the correction route, moves with the push path', () => {
    it('one plot: the farm that plot belongs to (unchanged)', async () => {
        await expect(resolveLogFarmId(singlePlotLog())).resolves.toBe(FARM_UUID);
    });

    it('several plots: the one farm they all belong to', async () => {
        await expect(resolveLogFarmId(multiPlotLog([PLOT_A, PLOT_B, PLOT_C]))).resolves.toBe(FARM_UUID);
    });

    it('no plots: null, so a farm-wide correction is refused rather than mis-routed', async () => {
        await expect(resolveLogFarmId(farmWideLog())).resolves.toBeNull();
    });

    it('plots in different farms: null, never the first one', async () => {
        plotsGet.mockImplementation(async (id: string) =>
            plotRow(id, id === PLOT_B ? 'e0e0e0e0-eeee-4eee-8eee-eeeeeeeeeeee' : FARM_UUID));

        await expect(resolveLogFarmId(multiPlotLog([PLOT_A, PLOT_B]))).resolves.toBeNull();
    });
});
