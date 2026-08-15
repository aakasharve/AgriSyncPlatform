// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 box 2e — THE CRASH RE-ENQUEUE RECONCILER.
 *
 * The crash is REPRODUCED, not simulated: the save path is run for real —
 * `LogCommandServiceImpl.confirmAndSave` writes the Dexie row — and then
 * `enqueueLogsForSync` is simply never called, which is exactly what a process
 * death between the two writes leaves behind. The record is on the handset, no
 * mutation row exists, and nothing in the app is looking for it.
 *
 * The other half of this file is the FALSE POSITIVE. "No mutation row" is also
 * true of every log this device pulled DOWN from the server, and re-enqueueing
 * those as fresh creates would push the farmer's whole synced history back at
 * the server. That is the failure mode a bare predicate has, and it is worse
 * than the bug being fixed.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { LogCommandServiceImpl } from '../../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../../infrastructure/storage/DexieLogsRepository';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { parentClientRequestIdForDailyLog } from '../../../../infrastructure/sync/MutationDependency';
import { enqueueLogsForSync } from '../../../logs/services/logSyncMutationService';
import { reconcileStrandedLogs } from '../strandedLogReconciler';
import type { CropProfile, FarmerProfile, LogScope, PlotGeo } from '../../../../types';
import type { WeatherPort } from '../../../../application/ports/WeatherPort';
import type { WeatherStamp } from '../../../../domain/types/weather.types';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';

vi.mock('../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => 'f0000000-0000-4000-8000-000000000001',
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT_A = 'a0000000-0000-4000-8000-00000000000a';
const CYCLE_A = 'e0000000-0000-4000-8000-00000000000a';
const DATE = '2026-08-15';

const grapes: CropProfile = {
    id: CROP_ID,
    name: 'Grapes',
    plots: [{ id: PLOT_A, name: 'Plot A' }],
} as unknown as CropProfile;

const ownerProfile = {
    activeOperatorId: 'owner',
    location: { lat: 20.0, lon: 73.8, source: 'manual', updatedAt: 'T' },
} as unknown as FarmerProfile;

/**
 * Verbatim what `BackendWeatherClient.getCurrentWeather` returns, including the
 * `'farm'` placeholder in `plotId` that the enrichment normalises. A partial or
 * absent stamp makes `validatePayload` reject the whole `create_daily_log`, so
 * a thin fixture here would be testing the fixture rather than the reconciler.
 */
const providerStamp = (): WeatherStamp => ({
    id: 'wx_1',
    plotId: 'farm',
    timestampLocal: '2026-08-15T09:00:00.000Z',
    timestampProvider: '2026-08-15T08:55:00.000Z',
    provider: 'tomorrow.io',
    tempC: 29.4,
    humidity: 61,
    windKph: 8,
    precipMm: 0,
    cloudCoverPct: 20,
    conditionText: 'Partly Cloudy',
    iconCode: 'partly_cloudy',
    rainProbNext6h: 10,
});

const weatherPort = {
    getCurrentWeather: vi.fn(async (_geo: PlotGeo) => providerStamp()),
    getForecast: vi.fn(async () => []),
} as unknown as WeatherPort;

const scope: LogScope = {
    selectedPlotIds: [PLOT_A],
    selectedCropIds: [CROP_ID],
    mode: 'single',
    applyPolicy: 'SHARED',
} as unknown as LogScope;

async function seedReferenceData() {
    const db = getDatabase();
    await db.farms.bulkPut([{
        id: FARM_ID, payload: { id: FARM_ID }, updatedAt: '2026-08-01T00:00:00.000Z',
    }] as never);
    await db.plots.bulkPut([{
        id: PLOT_A, payload: { id: PLOT_A, farmId: FARM_ID, name: 'Plot A' },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
    await db.cropCycles.bulkPut([{
        id: CYCLE_A, plotId: PLOT_A,
        payload: {
            id: CYCLE_A, plotId: PLOT_A, farmId: FARM_ID, cropName: 'Grapes',
            modifiedAtUtc: '2026-08-01T00:00:00.000Z',
        },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
}

/**
 * THE CRASH. The save runs for real and then the process "dies" before
 * `enqueueLogsForSync` — the two writes are not in one transaction.
 */
async function saveWithoutEnqueueing(): Promise<string> {
    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance(), weatherPort);
    const logs = await service.createFromManual(
        { date: DATE, notes: 'शेतात पाणी दिले' },
        scope,
        [grapes],
        ownerProfile,
    );
    await service.confirmAndSave(logs);
    return logs[0].id;
}

async function createMutationFor(logId: string) {
    return getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([mutationQueue.getDeviceId(), parentClientRequestIdForDailyLog(logId)])
        .first();
}

async function createMutationCount(): Promise<number> {
    return getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.CreateDailyLog).count();
}

describe('strandedLogReconciler — §P0.7 box 2e', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.outbox.clear();
        await db.auditEvents.clear();
        await db.farms.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('a_log_stranded_by_a_crash_between_the_two_writes_is_put_back_on_the_queue', async () => {
        const logId = await saveWithoutEnqueueing();

        // The state a farmer's phone is in RIGHT NOW: the record exists and
        // nothing anywhere is going to tell the server about it.
        expect(await getDatabase().logs.get(logId)).toBeDefined();
        expect(await createMutationFor(logId)).toBeUndefined();

        const result = await reconcileStrandedLogs();

        expect(result.stranded).toBe(1);
        expect(result.requeued).toBe(1);
        const row = await createMutationFor(logId);
        expect(row?.status).toBe('PENDING');
        expect((row?.payload as { dailyLogId: string }).dailyLogId).toBe(logId);
    });

    it('running_it_twice_does_not_create_a_second_copy_of_the_farmers_record', async () => {
        await saveWithoutEnqueueing();

        await reconcileStrandedLogs();
        const afterFirst = await createMutationCount();
        const second = await reconcileStrandedLogs();

        expect(afterFirst).toBe(1);
        expect(await createMutationCount()).toBe(1);
        // Second pass finds nothing stranded: the row it wrote is the evidence.
        expect(second.stranded).toBe(0);
    });

    it('a_log_that_was_already_enqueued_is_left_alone', async () => {
        const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance(), weatherPort);
        const logs = await service.createFromManual({ date: DATE }, scope, [grapes], ownerProfile);
        await service.confirmAndSave(logs);
        await enqueueLogsForSync(logs);

        const result = await reconcileStrandedLogs();

        expect(result.stranded).toBe(0);
        expect(await createMutationCount()).toBe(1);
    });

    it('an_APPLIED_row_still_counts_as_enqueued_which_is_why_APPLIED_must_never_be_pruned', async () => {
        const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance(), weatherPort);
        const logs = await service.createFromManual({ date: DATE }, scope, [grapes], ownerProfile);
        await service.confirmAndSave(logs);
        await enqueueLogsForSync(logs);
        const row = await createMutationFor(logs[0].id);
        await mutationQueue.markApplied(row!.id as number);

        const result = await reconcileStrandedLogs();

        // A successfully-synced log's ONLY proof it was ever enqueued is this
        // row. Prune APPLIED and the next launch re-sends the farmer's history.
        expect(result.stranded).toBe(0);
        expect(await createMutationCount()).toBe(1);
    });

    it('a_DISCARDED_row_still_counts_as_enqueued_and_is_not_resurrected', async () => {
        const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance(), weatherPort);
        const logs = await service.createFromManual({ date: DATE }, scope, [grapes], ownerProfile);
        await service.confirmAndSave(logs);
        await enqueueLogsForSync(logs);
        const row = await createMutationFor(logs[0].id);
        await mutationQueue.markRejectedDropped(row!.id as number);

        const result = await reconcileStrandedLogs();

        // The farmer explicitly dropped this. Re-queueing it would overturn a
        // decision they made — ruling R10, an acknowledged loss is not a bug.
        expect(result.stranded).toBe(0);
        expect((await createMutationFor(logs[0].id))?.status).toBe('REJECTED_DROPPED');
    });

    it('THE_FALSE_POSITIVE_a_log_pulled_from_the_server_is_never_re_enqueued', async () => {
        // A log created on the farmer's other handset, or by the seeder, arrives
        // through `reconcileLogs` with a `serverModifiedAtUtc` and NO local
        // mutation row. The bare predicate would push every one of them back at
        // the server as a fresh create.
        const logId = await saveWithoutEnqueueing();
        await getDatabase().logs.update(logId, { serverModifiedAtUtc: '2026-08-15T06:00:00.000Z' });

        const result = await reconcileStrandedLogs();

        expect(result.examined).toBe(0);
        expect(result.stranded).toBe(0);
        expect(await createMutationCount()).toBe(0);
    });

    it('a_deleted_log_is_not_resurrected', async () => {
        const logId = await saveWithoutEnqueueing();
        await getDatabase().logs.update(logId, { isDeleted: 1 });

        const result = await reconcileStrandedLogs();

        expect(result.examined).toBe(0);
        expect(await createMutationCount()).toBe(0);
    });

    it('a_stranded_log_it_cannot_route_is_COUNTED_not_silently_dropped', async () => {
        const logId = await saveWithoutEnqueueing();
        // The ordinary "plot not yet pulled" case: `resolveSyncTarget` refuses.
        await getDatabase().plots.clear();
        await getDatabase().cropCycles.clear();

        const result = await reconcileStrandedLogs();

        expect(result.stranded).toBe(1);
        expect(result.requeued).toBe(0);
        expect(result.unroutable).toBe(1);
        // And the record is still there — nothing was deleted to tidy up.
        expect(await getDatabase().logs.get(logId)).toBeDefined();
    });

    it('the_key_it_checks_is_the_key_the_save_path_writes', async () => {
        // The precondition the whole module rests on. If `CreateDailyLogCommand`
        // ever mints a random id, this reconciler double-writes every log —
        // so the derivation is asserted here, against the real save path, not
        // assumed.
        const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance(), weatherPort);
        const logs = await service.createFromManual({ date: DATE }, scope, [grapes], ownerProfile);
        await service.confirmAndSave(logs);
        await enqueueLogsForSync(logs);

        const rows = await getDatabase().mutationQueue
            .where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();

        expect(rows[0].clientRequestId).toBe(parentClientRequestIdForDailyLog(logs[0].id));
    });
});
