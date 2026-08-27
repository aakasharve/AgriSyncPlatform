/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context (Phase 2b — B1c)
 *
 * ACCEPTANCE JOURNEY 1 — "संपूर्ण शेत" (plan §L).
 *
 * ```text
 * Select संपूर्ण शेत
 * -> 8 workers
 * -> save
 * -> the log is QUEUED for sync (not in skippedLogIds)
 * -> payload: scope='Farm', empty plot set, no plotId, no cropCycleId,
 *    and the CORRECT farmId
 * -> the server accepts it
 * -> reload -> still Entire Farm
 * ```
 *
 * WHY END-TO-END AND NOT A UNIT TEST. The gap this closes spanned four files
 * that were each individually correct. `LogFactory` wrote a farm-scoped log with
 * an empty plot set; `confirmAndSave` persisted it; `enqueueLogsForSync` asked
 * "which farm?" the only way it knew — through a plot — got nothing, and dropped
 * the record on the floor. A test that mocks any one of those links can prove
 * the link and miss the chain. So this runs the REAL chain a farmer's tap runs:
 * the real `LogFactory`, the real `LogCommandServiceImpl.confirmAndSave` writing
 * to real Dexie (fake-indexeddb), the real `enqueueLogsForSync`, the real
 * `MutationQueue`, and the real `PayloadValidator` against the canonical zod
 * schema — which is the closest a client test gets to "the server accepts it".
 * "Reload" is a genuine re-read out of Dexie through the production repository.
 *
 * It is a sibling of `LogFactory.oneEngagementOneQuantity.test.ts` (JOURNEY 8)
 * and deliberately uses the same harness, so the two journeys cannot drift into
 * disagreeing about what saving a log does.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { LogFactory } from '../../../../core/domain/LogFactory';
import { LogCommandServiceImpl } from '../../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../../infrastructure/storage/DexieLogsRepository';
import { enqueueLogsForSync, resolveLogFarmId } from '../logSyncMutationService';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { reconcileLogs } from '../../../sync/pull/reconcilers/logsReconciler';
import type { PlotLookupEntry } from '../../../sync/pull/reconcilers/profileAndCropsReconciler';
import type { DailyLogDto, SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type {
    CropProfile,
    DailyLog,
    FarmerProfile,
    LabourEvent,
    LogScope,
} from '../../../../types';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';
/** A second farm the same farmer owns. The multi-farm case is the norm here. */
const OTHER_FARM_ID = 'f0000000-0000-4000-8000-000000000002';
const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT_A = 'a0000000-0000-4000-8000-00000000000a';
const CYCLE_A = 'e0000000-0000-4000-8000-00000000000a';
const DATE = '2026-08-13';

/**
 * The farm context the app is displaying — the `FarmContextSwitcher` pill in
 * `AppHeader`, persisted by `FarmContext`/`switchFarm` through `SessionStore`.
 * Mutable, because "the farmer switched farms after saving" is the exact case
 * that decides whether the farm is CAPTURED or merely inferred later.
 */
let currentFarmId: string | null = FARM_ID;

vi.mock('../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => currentFarmId,
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

const grapes: CropProfile = {
    id: CROP_ID,
    name: 'Grapes',
    plots: [{ id: PLOT_A, name: 'Plot A' }],
} as unknown as CropProfile;

const ownerProfile = { activeOperatorId: 'owner' } as unknown as FarmerProfile;

/** What tapping "संपूर्ण शेत" produces: no plots, the FARM_GLOBAL crop id. */
const entireFarmScope: LogScope = {
    selectedPlotIds: [],
    selectedCropIds: ['FARM_GLOBAL'],
    mode: 'single',
    applyPolicy: 'SHARED',
} as unknown as LogScope;

const plotScope: LogScope = {
    selectedPlotIds: [PLOT_A],
    selectedCropIds: [CROP_ID],
    mode: 'single',
    applyPolicy: 'SHARED',
} as unknown as LogScope;

/** 8 workers, one engagement. */
const eightWorkers = (): LabourEvent[] => ([{
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
    // Both of the farmer's farms have been pulled down, as they are after any
    // successful `/sync/pull`.
    await db.farms.bulkPut([FARM_ID, OTHER_FARM_ID].map(id => ({
        id,
        payload: { id },
        updatedAt: '2026-08-01T00:00:00.000Z',
    })) as never);
    await db.plots.bulkPut([{
        id: PLOT_A,
        payload: { id: PLOT_A, farmId: FARM_ID, name: 'Plot A' },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
    await db.cropCycles.bulkPut([{
        id: CYCLE_A,
        plotId: PLOT_A,
        payload: {
            id: CYCLE_A,
            plotId: PLOT_A,
            farmId: FARM_ID,
            cropName: 'Grapes',
            modifiedAtUtc: '2026-08-01T00:00:00.000Z',
        },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
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
        labour?: Array<{ workerCount?: number; totalCost?: number }>;
    });
}

/** The whole farmer journey, run through production code. */
async function recordEightWorkersOnTheWholeFarm(
    scope: LogScope = entireFarmScope,
    labour: LabourEvent[] = eightWorkers(),
): Promise<{ logs: DailyLog[]; outcome: Awaited<ReturnType<typeof enqueueLogsForSync>> }> {
    const logs = LogFactory.createFromManualEntry(
        { date: DATE, labour },
        scope,
        [grapes],
        ownerProfile,
    );

    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance());
    await service.confirmAndSave(logs);
    const outcome = await enqueueLogsForSync(logs);
    // `captureMoneyEventsFromLog` is fire-and-forget.
    await new Promise(resolve => setTimeout(resolve, 0));

    return { logs, outcome };
}

describe('JOURNEY 1 — संपूर्ण शेत, 8 workers, saved and SENT', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.farms.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        currentFarmId = FARM_ID;
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('THE HEADLINE: the log is QUEUED for sync, not skipped', async () => {
        const { logs, outcome } = await recordEightWorkersOnTheWholeFarm();

        expect(logs).toHaveLength(1);
        // Before B1c this read `queuedLogIds: []`, `skippedLogIds: [<id>]` —
        // the farmer's eight workers never left the handset.
        expect(outcome.queuedLogIds).toEqual([logs[0].id]);
        expect(outcome.skippedLogIds).toEqual([]);
    });

    it('sends scope=Farm, an empty plot set, no plot, no cycle, and the CORRECT farm', async () => {
        await recordEightWorkersOnTheWholeFarm();

        const payloads = await createdDailyLogPayloads();
        expect(payloads).toHaveLength(1);

        const [payload] = payloads;
        expect(payload.scope).toBe('Farm');
        expect(payload.plotIds).toEqual([]);
        expect(payload.farmId).toBe(FARM_ID);
        expect(payload.farmId).not.toBe(OTHER_FARM_ID);
        // Absent, not null: the CHECK, the validator and the handler all reject
        // a `Farm` row that carries either.
        expect(Object.prototype.hasOwnProperty.call(payload, 'plotId')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(payload, 'cropCycleId')).toBe(false);
    });

    it('THE SERVER ACCEPTS IT — the canonical payload schema validates', async () => {
        await recordEightWorkersOnTheWholeFarm();

        const [payload] = await createdDailyLogPayloads();
        expect(validatePayload(SyncMutationName.CreateDailyLog, payload)).toEqual({ ok: true });
    });

    it('carries the 8 workers, once, on the same payload', async () => {
        await recordEightWorkersOnTheWholeFarm();

        const items = (await createdDailyLogPayloads()).flatMap(p => p.labour ?? []);
        expect(items).toHaveLength(1);
        expect(items[0].workerCount).toBe(8);
        expect(items[0].totalCost).toBe(4000);
    });

    it('AFTER RELOAD: the record re-read from Dexie is still Entire Farm', async () => {
        await recordEightWorkersOnTheWholeFarm();

        // A real read through the production repository, not the object above.
        const [log] = await DexieLogsRepository.getInstance().getAll();

        expect(log.context.selection[0].cropId).toBe('FARM_GLOBAL');
        expect(log.context.selection[0].selectedPlotIds).toEqual([]);
        expect(log.labour[0].count).toBe(8);
        // And it still knows which farm, so a later push or correction can route.
        expect(log.meta?.farmId).toBe(FARM_ID);
    });
});

describe('JOURNEY 1 — the farm is the one the farmer was IN', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.farms.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        currentFarmId = FARM_ID;
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('a farm switched AFTER the save does not move the record', async () => {
        // The save happens in FARM_ID. `enqueueLogsForSync` runs immediately
        // here, but `BackgroundSyncWorker` retries and re-reads later, and the
        // record is what it re-reads. Recording the farm at save time is what
        // makes this stable; resolving "the current farm" at push time would
        // have quietly re-homed a whole day's labour.
        const { logs } = await recordEightWorkersOnTheWholeFarm();

        currentFarmId = OTHER_FARM_ID;

        const [log] = await DexieLogsRepository.getInstance().getAll();
        expect(log.meta?.farmId).toBe(FARM_ID);
        await expect(resolveLogFarmId(log)).resolves.toBe(FARM_ID);

        const [payload] = await createdDailyLogPayloads();
        expect(payload.farmId).toBe(FARM_ID);
        expect(payload.dailyLogId).toBe(logs[0].id);
    });

    it('a save made while in the OTHER farm goes to the other farm', async () => {
        currentFarmId = OTHER_FARM_ID;

        const { outcome } = await recordEightWorkersOnTheWholeFarm();

        expect(outcome.skippedLogIds).toEqual([]);
        expect((await createdDailyLogPayloads())[0].farmId).toBe(OTHER_FARM_ID);
    });

    it('with NO farm context, the record is refused and REPORTED — never guessed', async () => {
        // `db.farms` holds two farms right here. Nothing may reach for one.
        currentFarmId = null;

        // The engagement states NO cost here, and that is a deliberate dodge
        // around a PRE-EXISTING, unrelated defect rather than part of the
        // journey: with no farm context and a stated cost,
        // `captureMoneyEventsFromLog` -> `createMoneyEventFromSource` falls back
        // to the literal string `'farm_unknown'`
        // (`financeCommandService.ts:98`), which fails the `add_cost_entry`
        // ZGuid check inside a `void`-ed promise and surfaces as an unhandled
        // rejection. That is the finance capture path (Decision 3a already
        // documents the class), it predates this change and is untouched by it —
        // reported, not silently absorbed, and not fixed here.
        const { logs, outcome } = await recordEightWorkersOnTheWholeFarm(
            entireFarmScope,
            [{ id: 'lab-1', type: 'HIRED', engagementType: 'hired_daily', count: 8 } as LabourEvent],
        );

        expect(outcome.queuedLogIds).toEqual([]);
        expect(outcome.skippedLogIds).toEqual([logs[0].id]);
        expect(await createdDailyLogPayloads()).toHaveLength(0);

        // And it is genuinely still on the phone, which is what the honesty
        // surfaces tell the farmer (`sync.onPhone` — "फोनवर सेव्ह ✓").
        expect(await DexieLogsRepository.getInstance().getAll()).toHaveLength(1);
    });
});

describe('JOURNEY 1 — what it must not have cost', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.farms.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        currentFarmId = FARM_ID;
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('a plot-scoped save still sends plotId + cropCycleId and states no scope', async () => {
        await recordEightWorkersOnTheWholeFarm(plotScope);

        const [payload] = await createdDailyLogPayloads();
        expect(payload.plotId).toBe(PLOT_A);
        expect(payload.cropCycleId).toBe(CYCLE_A);
        expect(payload.farmId).toBe(FARM_ID);
        expect(Object.prototype.hasOwnProperty.call(payload, 'scope')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(payload, 'plotIds')).toBe(false);
    });

    it('a plot-scoped save is routed by its PLOT even when the farm context has moved on', async () => {
        // The plot's farm is server-issued reference data and is what the server
        // checks the write against. The recorded farm never overrides it.
        currentFarmId = OTHER_FARM_ID;

        await recordEightWorkersOnTheWholeFarm(plotScope);

        expect((await createdDailyLogPayloads())[0].farmId).toBe(FARM_ID);
    });
});

// ---------------------------------------------------------------------------
// The round trip. A feature that works until the first sync and then silently
// stops is the class of half-truth this phase exists to remove.
// ---------------------------------------------------------------------------

describe('JOURNEY 1 — after the server acknowledges it, the log is still farm-wide and still correctable', () => {
    const serverFarmDto = (id: string): DailyLogDto => ({
        id,
        farmId: FARM_ID,
        scope: 'Farm',
        plotIds: [],
        plotId: null,
        cropCycleId: null,
        operatorUserId: 'u0000000-0000-4000-8000-000000000001',
        logDate: DATE,
        createdAtUtc: `${DATE}T04:00:00.000Z`,
        modifiedAtUtc: `${DATE}T05:00:00.000Z`,
        tasks: [],
        verificationEvents: [],
    } as unknown as DailyLogDto);

    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.farms.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        currentFarmId = FARM_ID;
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('survives save -> ack -> pull with the farm intact, so correction stays reachable', async () => {
        const { logs } = await recordEightWorkersOnTheWholeFarm();
        const logId = logs[0].id;

        // The pull rebuilds the whole record from the DTO. `meta` is replaced
        // wholesale, so without the reconciler carrying `farmId` the farm
        // stamped at save time would be erased here — and farm-wide correction
        // would stop working for exactly the logs that reached the server.
        await reconcileLogs(
            getDatabase(),
            { dailyLogs: [serverFarmDto(logId)] } as unknown as SyncPullResponse,
            new Map<string, PlotLookupEntry>(),
            new Set<string>(),
        );

        const [reloaded] = await DexieLogsRepository.getInstance().getAll();
        expect(reloaded.context.selection[0].cropId).toBe('FARM_GLOBAL');
        expect(reloaded.context.selection[0].selectedPlotIds).toEqual([]);
        expect(reloaded.meta?.farmId).toBe(FARM_ID);

        // `UpdateLog` refuses every labour correction when this is null. That
        // was every farm-wide log, always, before B1c.
        await expect(resolveLogFarmId(reloaded)).resolves.toBe(FARM_ID);
    });

    it('the farm comes off the WIRE, so the server outranks whatever this device thinks now', async () => {
        const { logs } = await recordEightWorkersOnTheWholeFarm();
        currentFarmId = OTHER_FARM_ID;

        await reconcileLogs(
            getDatabase(),
            { dailyLogs: [serverFarmDto(logs[0].id)] } as unknown as SyncPullResponse,
            new Map<string, PlotLookupEntry>(),
            new Set<string>(),
        );

        const [reloaded] = await DexieLogsRepository.getInstance().getAll();
        expect(reloaded.meta?.farmId).toBe(FARM_ID);
    });
});
