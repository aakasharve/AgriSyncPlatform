/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 *
 * ACCEPTANCE JOURNEY 8 — "one engagement, one quantity" (founder decision O-2).
 *
 * ```text
 * Select Plot A + B + C
 * -> report 8 workers as ONE shared engagement
 * -> save
 * -> ONE canonical labour quantity = 8   (scope='MultiPlot', plot_ids={A,B,C})
 * -> reload                              -> still 8
 * -> context still identifies A + B + C
 * -> NEVER 24
 * -> NO fabricated per-plot allocation (no 3/3/2 in headcount OR money)
 * -> ONE labourAssignmentId, addressable by attribution and correction
 * ```
 *
 * WHY THIS IS AN END-TO-END TEST AND NOT A UNIT TEST. The defect was never in
 * one function. `LogFactory` emitted one `DailyLog` per plot;
 * `allocateLabourForPlot` copied `count` into each by spread while
 * `allocateAmountAcrossPlots` DIVIDED the money into the same rows; the confirm
 * boundary then minted one `labourAssignmentId` per row; and
 * `GetLabourDataHandler` summed the rows. Every piece looked defensible alone.
 * Eight workers on three plots reached the server as three rows of eight and
 * were reported as twenty-four man-days, with the money simultaneously split
 * 3/3/2 — one object read two contradictory ways at once.
 *
 * So this runs the REAL chain a farmer's tap runs: the real `LogFactory`, the
 * real `LogCommandServiceImpl.confirmAndSave` writing to real Dexie
 * (fake-indexeddb), the real `enqueueLogsForSync`, the real `MutationQueue` and
 * the real `PayloadValidator` against the canonical zod schema. "Reload" is a
 * genuine re-read out of Dexie through the production repository, not a
 * variable held in scope.
 *
 * The 24 is asserted as a SUM over every queued payload, not as a property of
 * one of them. Asserting "this payload says 8" would still pass if three
 * payloads each said 8 — which is precisely the shipped defect.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { LogFactory } from '../LogFactory';
import { LogCommandServiceImpl } from '../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../infrastructure/storage/DexieLogsRepository';
import { enqueueLogsForSync } from '../../../features/logs/services/logSyncMutationService';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type {
    CropProfile,
    DailyLog,
    FarmerProfile,
    LabourEvent,
    LogScope,
} from '../../../types';

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));

// The finance capture reads the ACTIVE farm from here (Decision 3a) and the
// `add_cost_entry` schema pins it as a UUID, exactly as
// `LogCommandService.captureMoneyEvents.test.ts` does.
vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => 'f0000000-0000-4000-8000-000000000001',
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';
const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT_A = 'a0000000-0000-4000-8000-00000000000a';
const PLOT_B = 'b0000000-0000-4000-8000-00000000000b';
const PLOT_C = 'c0000000-0000-4000-8000-00000000000c';
const CYCLE_A = 'e0000000-0000-4000-8000-00000000000a';
const CYCLE_B = 'e0000000-0000-4000-8000-00000000000b';
const CYCLE_C = 'e0000000-0000-4000-8000-00000000000c';
const DATE = '2026-08-13';

const PLOTS: Array<[string, string, string]> = [
    [PLOT_A, 'Plot A', CYCLE_A],
    [PLOT_B, 'Plot B', CYCLE_B],
    [PLOT_C, 'Plot C', CYCLE_C],
];

const grapes: CropProfile = {
    id: CROP_ID,
    name: 'Grapes',
    plots: PLOTS.map(([id, name]) => ({ id, name })),
} as unknown as CropProfile;

const ownerProfile = { activeOperatorId: 'owner' } as unknown as FarmerProfile;

const threePlotScope: LogScope = {
    selectedPlotIds: [PLOT_A, PLOT_B, PLOT_C],
    selectedCropIds: [CROP_ID],
    mode: 'multi',
    applyPolicy: 'SHARED',
} as unknown as LogScope;

/** 8 workers, one engagement, ₹4000 in total. No `targetPlotName` anywhere. */
const eightWorkersShared = (): LabourEvent[] => ([{
    id: 'lab-1',
    type: 'HIRED',
    engagementType: 'hired_daily',
    count: 8,
    maleCount: 5,
    femaleCount: 3,
    totalCost: 4000,
    activity: 'छाटणी',
} as LabourEvent]);

async function seedReferenceData() {
    const db = getDatabase();
    await db.plots.bulkPut(PLOTS.map(([id, name]) => ({
        id,
        payload: { id, farmId: FARM_ID, name },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    })) as never);
    await db.cropCycles.bulkPut(PLOTS.map(([plotId, , cycleId]) => ({
        id: cycleId,
        plotId,
        payload: {
            id: cycleId,
            plotId,
            farmId: FARM_ID,
            cropName: 'Grapes',
            modifiedAtUtc: '2026-08-01T00:00:00.000Z',
        },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    })) as never);
}

async function createdDailyLogPayloads() {
    const rows = await getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();
    return rows.map(row => row.payload as {
        dailyLogId: string;
        farmId: string;
        scope?: string;
        plotIds?: string[];
        plotId?: string;
        cropCycleId?: string;
        labour?: Array<{ labourAssignmentId: string; workerCount?: number; maleCount?: number; femaleCount?: number; totalCost?: number }>;
    });
}

async function addCostEntryPayloads() {
    const rows = await getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.AddCostEntry).toArray();
    return rows.map(row => row.payload as { amount: number; plotId?: string; cropCycleId?: string });
}

/** The whole farmer journey, run through production code. */
async function recordEightWorkersAcrossThreePlots(): Promise<DailyLog[]> {
    const logs = LogFactory.createFromManualEntry(
        { date: DATE, labour: eightWorkersShared() },
        threePlotScope,
        [grapes],
        ownerProfile,
    );

    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance());
    await service.confirmAndSave(logs);
    await enqueueLogsForSync(logs);
    // `captureMoneyEventsFromLog` is fire-and-forget.
    await new Promise(resolve => setTimeout(resolve, 0));

    return logs;
}

describe('JOURNEY 8 — 8 workers across A+B+C stay 8 (founder decision O-2)', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('records ONE log for the whole engagement, not one per plot', async () => {
        const logs = await recordEightWorkersAcrossThreePlots();

        expect(logs).toHaveLength(1);
    });

    it('THE HEADLINE: the total worker count reaching the server is 8 — NEVER 24', async () => {
        await recordEightWorkersAcrossThreePlots();

        const payloads = await createdDailyLogPayloads();
        const totalWorkers = payloads
            .flatMap(payload => payload.labour ?? [])
            .reduce((sum, item) => sum + (item.workerCount ?? 0), 0);

        // Summed across EVERY queued log. Three logs of 8 would read 24 here,
        // which is exactly what shipped.
        expect(totalWorkers).toBe(8);
        expect(totalWorkers).not.toBe(24);
    });

    it('carries the male/female split once, not once per plot', async () => {
        await recordEightWorkersAcrossThreePlots();

        const items = (await createdDailyLogPayloads()).flatMap(payload => payload.labour ?? []);
        expect(items.reduce((s, i) => s + (i.maleCount ?? 0), 0)).toBe(5);
        expect(items.reduce((s, i) => s + (i.femaleCount ?? 0), 0)).toBe(3);
    });

    it('states scope MultiPlot with plot_ids {A,B,C}, and no plot and no cycle', async () => {
        await recordEightWorkersAcrossThreePlots();

        const payloads = await createdDailyLogPayloads();
        expect(payloads).toHaveLength(1);

        const [payload] = payloads;
        expect(payload.scope).toBe('MultiPlot');
        expect(payload.plotIds).toEqual([PLOT_A, PLOT_B, PLOT_C]);
        expect(payload.farmId).toBe(FARM_ID);
        // `ck_daily_logs_scope` requires both NULL for MultiPlot, and
        // `CreateDailyLogHandler` rejects the command if either is present.
        expect(Object.prototype.hasOwnProperty.call(payload, 'plotId')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(payload, 'cropCycleId')).toBe(false);
    });

    it('mints ONE labourAssignmentId, so attribution and correction can address it', async () => {
        await recordEightWorkersAcrossThreePlots();

        const ids = (await createdDailyLogPayloads())
            .flatMap(payload => payload.labour ?? [])
            .map(item => item.labourAssignmentId);

        expect(ids).toHaveLength(1);
        expect(new Set(ids).size).toBe(1);
        expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    // The mutation run measured the divided shape exactly: restoring
    // `allocateAmountAcrossPlots` turns the farmer's stated ₹4000 into
    // [1333.34, 1333.33, 1333.33] — three amounts he never said.
    it('sends the stated ₹4000 whole — never 1333.34 / 1333.33 / 1333.33', async () => {
        await recordEightWorkersAcrossThreePlots();

        const totals = (await createdDailyLogPayloads())
            .flatMap(payload => payload.labour ?? [])
            .map(item => item.totalCost);

        expect(totals).toEqual([4000]);
        expect(totals.reduce((sum: number, total) => sum + (total ?? 0), 0)).toBe(4000);
    });

    it('captures the expense at the level the farmer asserted — one entry, no plot', async () => {
        await recordEightWorkersAcrossThreePlots();

        const expenses = await addCostEntryPayloads();
        expect(expenses).toHaveLength(1);
        expect(expenses[0].amount).toBe(4000);
        // A multi-plot amount belongs at exactly one level of aggregation. The
        // per-plot split is a Finance decision against ExpenseAllocationPolicy
        // with a farmer-visible strategy, never an implicit default here.
        expect(expenses[0].plotId).toBeUndefined();
    });

    it('AFTER RELOAD: the record re-read from Dexie still says 8, and still names A+B+C', async () => {
        await recordEightWorkersAcrossThreePlots();

        // A real read through the production repository, not the object above.
        const reloaded = await DexieLogsRepository.getInstance().getAll();
        expect(reloaded).toHaveLength(1);

        const [log] = reloaded;
        expect(log.labour).toHaveLength(1);
        expect(log.labour[0].count).toBe(8);
        expect(log.labour[0].totalCost).toBe(4000);

        const plotIds = log.context.selection.flatMap(entry => entry.selectedPlotIds);
        expect(plotIds).toEqual([PLOT_A, PLOT_B, PLOT_C]);
        expect(log.context.selection.flatMap(entry => entry.selectedPlotNames))
            .toEqual(['Plot A', 'Plot B', 'Plot C']);
    });

    it('states the money once in its own summary — not three times, not a third each', async () => {
        const [log] = await recordEightWorkersAcrossThreePlots();

        expect(log.financialSummary.totalLabourCost).toBe(4000);
        expect(log.financialSummary.grandTotal).toBe(4000);
    });
});

// ---------------------------------------------------------------------------
// The surrounding behaviour this must not have cost.
// ---------------------------------------------------------------------------

describe('JOURNEY 8 — what the un-split must NOT change', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('a single-plot save still produces one plot-scoped log with its cycle', async () => {
        const logs = LogFactory.createFromManualEntry(
            { date: DATE, labour: eightWorkersShared() },
            { ...threePlotScope, selectedPlotIds: [PLOT_A], mode: 'single' } as LogScope,
            [grapes],
            ownerProfile,
        );

        expect(logs).toHaveLength(1);
        // The child id is still scoped to its plot, exactly as before.
        expect(logs[0].labour[0].id).toBe(`lab-1::${PLOT_A}`);

        const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance());
        await service.confirmAndSave(logs);
        await enqueueLogsForSync(logs);

        const [payload] = await createdDailyLogPayloads();
        expect(payload.plotId).toBe(PLOT_A);
        expect(payload.cropCycleId).toBe(CYCLE_A);
        expect(Object.prototype.hasOwnProperty.call(payload, 'scope')).toBe(false);
        expect(payload.labour?.[0].workerCount).toBe(8);
    });

    it('per-plot figures the FARMER supplied are still recorded per plot', async () => {
        // The founder's rule has two halves. This is the second: an engagement
        // the farmer pinned to a plot is not a shared engagement, and it keeps
        // its own record. Nothing is invented — the numbers are his.
        const logs = LogFactory.createFromManualEntry(
            {
                date: DATE,
                labour: [
                    { id: 'lab-a', type: 'HIRED', count: 5, totalCost: 2500, targetPlotName: 'Plot A' } as LabourEvent,
                    { id: 'lab-b', type: 'HIRED', count: 3, totalCost: 1500, targetPlotName: 'Plot B' } as LabourEvent,
                ],
            },
            threePlotScope,
            [grapes],
            ownerProfile,
        );

        const byPlot = logs.map(log => ({
            plots: log.context.selection.flatMap(entry => entry.selectedPlotIds),
            workers: log.labour.map(event => event.count),
        }));

        expect(byPlot).toContainEqual({ plots: [PLOT_A], workers: [5] });
        expect(byPlot).toContainEqual({ plots: [PLOT_B], workers: [3] });
        // Still 8 in total, and still nothing on Plot C.
        expect(logs.flatMap(log => log.labour).reduce((s, e) => s + (e.count ?? 0), 0)).toBe(8);
    });

    it('an empty three-plot save still produces exactly one log, not zero', async () => {
        // `useLogCommands` reads `logs.length === 0` as "No plots selected".
        const logs = LogFactory.createFromManualEntry({ date: DATE }, threePlotScope, [grapes], ownerProfile);

        expect(logs).toHaveLength(1);
        expect(logs[0].context.selection[0].selectedPlotIds).toEqual([PLOT_A, PLOT_B, PLOT_C]);
    });

    it('a farm-wide save is untouched — still one log, still no plot', async () => {
        const logs = LogFactory.createFromManualEntry(
            { date: DATE, labour: eightWorkersShared() },
            { selectedPlotIds: [], selectedCropIds: ['FARM_GLOBAL'], mode: 'single', applyPolicy: 'SHARED' } as unknown as LogScope,
            [grapes],
            ownerProfile,
        );

        expect(logs).toHaveLength(1);
        expect(logs[0].context.selection[0].cropId).toBe('FARM_GLOBAL');
        expect(logs[0].context.selection[0].selectedPlotIds).toEqual([]);
        expect(logs[0].labour[0].count).toBe(8);
    });

    it('the day-level facts are recorded once, not once per plot', async () => {
        const logs = LogFactory.createFromManualEntry(
            {
                date: DATE,
                manualTotalCost: 4000,
                fullTranscript: 'आज तिन्ही प्लॉटवर ८ मजूर होते',
                labour: [
                    { id: 'lab-a', type: 'HIRED', count: 5, targetPlotName: 'Plot A' } as LabourEvent,
                    { id: 'lab-b', type: 'HIRED', count: 3, targetPlotName: 'Plot B' } as LabourEvent,
                ],
                disturbance: { scope: 'PARTIAL', group: 'weather', reason: 'पाऊस', blockedSegments: [] },
            },
            threePlotScope,
            [grapes],
            ownerProfile,
        );

        expect(logs.filter(log => log.disturbance).length).toBe(1);
        expect(logs.filter(log => log.manualTotalCost !== undefined).length).toBe(1);
        expect(logs.filter(log => log.fullTranscript).length).toBe(1);
    });
});
