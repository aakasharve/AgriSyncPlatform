// spec: 2026-08-12-labour-phase2-server-truth-farm-context (Phase 2b — B1c)
//
// WHAT THIS FILE IS FOR.
//
// A farm-scoped log (संपूर्ण शेत) could not be PUSHED AT ALL. `resolveLogPlots`
// answers "which farm?" by reading `db.plots[].payload.farmId`, and a
// farm-scoped log has no plot by definition — so the log fell into
// `skippedLogIds` and never left the phone. B1c gives the push path an honest
// non-plot source: the farm the record itself carries, stamped at save time.
//
// THE THREE THINGS THIS FILE HAS TO PROVE, in order of how much they matter:
//
//   1. A farm-scoped log with a recorded farm is QUEUED, with the exact payload
//      the server's `Farm` contract requires.
//   2. A farm-scoped log whose farm cannot be established is REFUSED and
//      REPORTED — never sent to a guessed farm, and never silently dropped.
//   3. Plot and MultiPlot payloads are UNCHANGED. That is the regression that
//      matters most; `logSyncMutationService.scopeTarget.test.ts` holds the
//      byte-identity claim and is re-run alongside this file.
//
// Same harness as `scopeTarget.test.ts` — the real module, the real canonical
// zod validator, Dexie mocked at the boundary — so the two files agree about
// what "the push path" is.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DailyLog } from '../../../../types';

const { enqueueCreate, enqueueTask, plotsGet, farmsGet, cropCyclesWhere, triggerNow } = vi.hoisted(() => ({
    enqueueCreate: vi.fn(),
    enqueueTask: vi.fn(),
    plotsGet: vi.fn(),
    farmsGet: vi.fn(),
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
        farms: { get: farmsGet },
        cropCycles: { where: cropCyclesWhere },
    }),
}));

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow },
}));

import { enqueueLogsForSync, resolveLogFarmId } from '../logSyncMutationService';
// NOT mocked, deliberately — the canonical validator `MutationQueue.enqueue`
// runs, so a `Farm` payload built here is proven to be one `/sync/push` accepts.
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const LOG_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FARM_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** A farm the farmer also owns, and was NOT in when the log was created. */
const OTHER_FARM_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PLOT_A = 'c1c1c1c1-cccc-4ccc-8ccc-cccccccccccc';
const PLOT_B = 'c2c2c2c2-cccc-4ccc-8ccc-cccccccccccc';
const CYCLE_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const baseLog = (): DailyLog => ({
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

/**
 * संपूर्ण शेत, exactly as `LogFactory.createFarmGlobalManualLog` writes one, plus
 * the farm `confirmAndSave` stamps on it.
 *
 * `null` — NOT `undefined` — means "this record names no farm". A default
 * parameter treats an explicit `undefined` as absent and silently hands back the
 * default, which would make every "no recorded farm" test below quietly assert
 * the happy path instead. It did, on the first run.
 */
const farmWideLog = (farmId: string | null = FARM_UUID): DailyLog => ({
    ...baseLog(),
    context: {
        selection: [{
            cropId: 'FARM_GLOBAL',
            cropName: 'Entire Farm',
            selectedPlotIds: [],
            selectedPlotNames: [],
        }],
    },
    meta: {
        createdAtISO: '2026-08-12T04:00:00.000Z',
        ...(farmId ? { farmId } : {}),
    },
} as unknown as DailyLog);

const multiPlotLog = (plotIds: string[], farmId?: string): DailyLog => ({
    ...baseLog(),
    context: {
        selection: [{
            cropId: 'crop-1',
            cropName: 'Grapes',
            selectedPlotIds: plotIds,
            selectedPlotNames: plotIds.map((_, i) => `Plot ${i}`),
        }],
    },
    meta: {
        createdAtISO: '2026-08-12T04:00:00.000Z',
        ...(farmId ? { farmId } : {}),
    },
} as unknown as DailyLog);

const plotRow = (id: string, farmId = FARM_UUID) => ({ payload: { id, farmId } });

const sentPayload = () => enqueueCreate.mock.calls[0][0];

beforeEach(() => {
    enqueueCreate.mockReset().mockResolvedValue('m1');
    enqueueTask.mockReset().mockResolvedValue('m2');
    triggerNow.mockReset().mockResolvedValue(undefined);
    plotsGet.mockReset().mockImplementation(async (id: string) => plotRow(id));
    // The pull has delivered both of this farmer's farms to this device.
    farmsGet.mockReset().mockImplementation(async (id: string) =>
        (id === FARM_UUID || id === OTHER_FARM_UUID ? { id, payload: { id } } : undefined));
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
// JOURNEY 1, at the push boundary. The end-to-end version of this journey —
// real LogFactory, real confirmAndSave, real Dexie — is
// `entireFarmJourney.test.ts`; this is the payload contract in isolation.
// ---------------------------------------------------------------------------

describe('B1c — a farm-scoped log can finally be pushed', () => {
    it('QUEUES the log instead of skipping it', async () => {
        const result = await enqueueLogsForSync([farmWideLog()]);

        // The whole defect, in two lines: this used to read
        // `queuedLogIds: []` / `skippedLogIds: [LOG_UUID]`.
        expect(result.queuedLogIds).toEqual([LOG_UUID]);
        expect(result.skippedLogIds).toEqual([]);
        expect(triggerNow).toHaveBeenCalledTimes(1);
    });

    it('states scope Farm, an EMPTY plot set, and the recorded farm id', async () => {
        await enqueueLogsForSync([farmWideLog()]);

        const payload = sentPayload();
        expect(payload.scope).toBe('Farm');
        expect(payload.plotIds).toEqual([]);
        expect(payload.farmId).toBe(FARM_UUID);
    });

    it('carries NO plotId and NO cropCycleId — absent, not null', async () => {
        // `CreateDailyLogValidator` requires `PlotId is null && CropCycleId is
        // null` for `Farm`, `CreateDailyLogHandler` rejects a non-empty plot
        // set, and `ck_daily_logs_scope` welds both into the row. A key present
        // with a null value is a different thing from an absent key on the wire.
        await enqueueLogsForSync([farmWideLog()]);

        const payload = sentPayload();
        expect(Object.prototype.hasOwnProperty.call(payload, 'plotId')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(payload, 'cropCycleId')).toBe(false);
    });

    it('is a payload the canonical schema accepts', async () => {
        await enqueueLogsForSync([farmWideLog()]);

        expect(validatePayload(SyncMutationName.CreateDailyLog, sentPayload())).toEqual({ ok: true });
    });

    it('never asks Dexie for a plot or a crop cycle — there is neither to ask about', async () => {
        await enqueueLogsForSync([farmWideLog()]);

        expect(plotsGet).not.toHaveBeenCalled();
        expect(cropCyclesWhere).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// The refusals. Each one is a farmer's labour NOT going to the wrong farm.
// ---------------------------------------------------------------------------

describe('B1c — a farm it cannot establish is refused, visibly', () => {
    it('a farm-wide log that records NO farm is reported, not silently dropped', async () => {
        // A log written before the farm was recorded on it, or saved while the
        // app had no farm context at all. There is no honest answer available,
        // and "the only farm in Dexie" is not one.
        const result = await enqueueLogsForSync([farmWideLog(null)]);

        expect(result.queuedLogIds).toEqual([]);
        // In `skippedLogIds`, which `useLogCommands.enqueueForSyncAndNoteSkips`
        // feeds to BOTH the toast the farmer reads and the header chip
        // (`noteUnqueueableLogs`), so the app stops claiming `पाठवलं ✓`.
        // Dropping it silently would be the original defect with extra steps.
        expect(result.skippedLogIds).toEqual([LOG_UUID]);
        expect(enqueueCreate).not.toHaveBeenCalled();
    });

    it('never substitutes a farm from Dexie when the record names none', async () => {
        // Even with farms sitting right there in `db.farms`, and even when there
        // is only ONE of them, nothing may reach for it. Founder decision O-1.
        farmsGet.mockImplementation(async (id: string) => ({ id, payload: { id } }));

        await enqueueLogsForSync([farmWideLog(null)]);

        expect(enqueueCreate).not.toHaveBeenCalled();
    });

    it('refuses a farm this device has never been told about by the server', async () => {
        // `db.farms` is written only by `/sync/pull`, into the per-user
        // database. A recorded farm absent from it is a farm this login has no
        // server-issued evidence for — the shape a stale cross-login
        // `SessionStore` value would take. Refusing costs a record that stays on
        // the phone and is reported; accepting risks a cross-tenant write.
        const result = await enqueueLogsForSync([farmWideLog('f0f0f0f0-ffff-4fff-8fff-ffffffffffff')]);

        expect(result.skippedLogIds).toEqual([LOG_UUID]);
        expect(enqueueCreate).not.toHaveBeenCalled();
    });

    it('sends the farm the farmer was IN, never the farm they are in now', async () => {
        // The push runs whenever `BackgroundSyncWorker` next fires — which can
        // be after the farmer has switched farms in the header pill. The record
        // was created in FARM_UUID and must reach FARM_UUID, no matter what the
        // app's current context has become. This is why the farm is captured at
        // save time instead of resolved here.
        await enqueueLogsForSync([farmWideLog(FARM_UUID)]);

        expect(sentPayload().farmId).toBe(FARM_UUID);
        expect(sentPayload().farmId).not.toBe(OTHER_FARM_UUID);
    });
});

// ---------------------------------------------------------------------------
// The regression that matters most.
// ---------------------------------------------------------------------------

describe('B1c — plot-scoped and multi-plot logs are untouched', () => {
    it('a single-plot log still emits exactly the keys it emitted before', async () => {
        await enqueueLogsForSync([baseLog()]);

        const payload = sentPayload();
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
        expect(JSON.stringify(payload)).toBe(
            `{"dailyLogId":"${LOG_UUID}","farmId":"${FARM_UUID}","plotId":"${PLOT_A}","cropCycleId":"${CYCLE_A}","logDate":"2026-08-12"}`,
        );
    });

    it('a multi-plot log still states MultiPlot and its whole set', async () => {
        await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B])]);

        const payload = sentPayload();
        expect(payload.scope).toBe('MultiPlot');
        expect(payload.plotIds).toEqual([PLOT_A, PLOT_B]);
    });

    it('THE PLOT DECIDES THE FARM — a recorded farm never overrides it', async () => {
        // The plot's farm comes from server-issued reference data and is what
        // the server itself will check the write against; the recorded farm is a
        // capture of what the app was showing. Where both exist they are the
        // same value in practice — and where they could differ, the plot wins,
        // because that is what shipped and what the server verifies.
        await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B], OTHER_FARM_UUID)]);

        expect(sentPayload().farmId).toBe(FARM_UUID);
    });

    it('a plot this device has not pulled still refuses, recorded farm or not', async () => {
        // `resolveLogPlots` returns null for THREE reasons and only one of them
        // is farm scope. This is a PLOT-scoped log whose plot evidence is
        // missing; the recorded farm is not a substitute for it, or a
        // mis-attributed plot log would start flowing.
        plotsGet.mockResolvedValue(undefined);

        const result = await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B], FARM_UUID)]);

        expect(result.skippedLogIds).toEqual([LOG_UUID]);
        expect(enqueueCreate).not.toHaveBeenCalled();
    });

    it('plots that disagree about their farm still refuse, recorded farm or not', async () => {
        plotsGet.mockImplementation(async (id: string) =>
            plotRow(id, id === PLOT_B ? OTHER_FARM_UUID : FARM_UUID));

        const result = await enqueueLogsForSync([multiPlotLog([PLOT_A, PLOT_B], FARM_UUID)]);

        expect(result.skippedLogIds).toEqual([LOG_UUID]);
        expect(enqueueCreate).not.toHaveBeenCalled();
    });

    it('a plot with no crop cycle still refuses', async () => {
        cropCyclesWhere.mockReturnValue({ equals: () => ({ toArray: async () => [] }) });

        const result = await enqueueLogsForSync([{
            ...baseLog(),
            meta: { createdAtISO: '2026-08-12T04:00:00.000Z', farmId: FARM_UUID },
        } as unknown as DailyLog]);

        expect(result.skippedLogIds).toEqual([LOG_UUID]);
    });
});

// ---------------------------------------------------------------------------
// The same resolver feeds labour CORRECTION. One choke point, both paths.
// ---------------------------------------------------------------------------

describe('B1c — resolveLogFarmId makes farm-wide correction reachable', () => {
    it('a farm-wide log now resolves, so UpdateLog can route its correction', async () => {
        // `UpdateLog` refuses every labour correction when this returns null.
        // Until B1c that was every farm-wide log, always.
        await expect(resolveLogFarmId(farmWideLog())).resolves.toBe(FARM_UUID);
    });

    it('a farm-wide log with no recorded farm still resolves to null', async () => {
        await expect(resolveLogFarmId(farmWideLog(null))).resolves.toBeNull();
    });

    it('a farm-wide log naming a farm this device lacks still resolves to null', async () => {
        await expect(resolveLogFarmId(farmWideLog('f0f0f0f0-ffff-4fff-8fff-ffffffffffff')))
            .resolves.toBeNull();
    });

    it('one plot: still the farm that plot belongs to', async () => {
        await expect(resolveLogFarmId(baseLog())).resolves.toBe(FARM_UUID);
    });

    it('plots in different farms: still null, and NOT the recorded farm', async () => {
        plotsGet.mockImplementation(async (id: string) =>
            plotRow(id, id === PLOT_B ? OTHER_FARM_UUID : FARM_UUID));

        await expect(resolveLogFarmId(multiPlotLog([PLOT_A, PLOT_B], FARM_UUID))).resolves.toBeNull();
    });

    it('a plot this device has not pulled: still null, and NOT the recorded farm', async () => {
        plotsGet.mockResolvedValue(undefined);

        await expect(resolveLogFarmId(multiPlotLog([PLOT_A], FARM_UUID))).resolves.toBeNull();
    });
});
