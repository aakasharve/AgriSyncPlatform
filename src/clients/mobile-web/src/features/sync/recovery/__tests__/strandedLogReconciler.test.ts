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

const { triggerNowMock, clientErrorMock } = vi.hoisted(() => ({
    triggerNowMock: vi.fn().mockResolvedValue(undefined),
    clientErrorMock: vi.fn(),
}));

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: triggerNowMock },
}));

// Review B005 — the sink is asserted, not assumed. `emitClientError` is the
// module `index.tsx` already wires `window.onerror` into, and it reaches
// `analyticsOutbox` -> `POST /analytics/ingest`.
vi.mock('../../../../core/telemetry/eventEmitters', () => ({
    emitClientError: clientErrorMock,
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
/** This season's grape cycle. Open — no `endDate`. */
const CYCLE_OPEN = 'e0000000-0000-4000-8000-00000000000a';
/** Last season's grape cycle on the SAME plot, closed. */
const CYCLE_CLOSED = 'e0000000-0000-4000-8000-00000000000b';
const DATE = '2026-08-15';
/** Inside `CYCLE_CLOSED`, months before `CYCLE_OPEN` even started. */
const LAST_SEASON_DATE = '2025-11-04';

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

function cycleRow(id: string, startDate: string, endDate?: string) {
    return {
        id, plotId: PLOT_A,
        payload: {
            id, plotId: PLOT_A, farmId: FARM_ID, cropName: 'Grapes',
            startDate, ...(endDate ? { endDate } : {}),
            modifiedAtUtc: '2026-08-01T00:00:00.000Z',
        },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    };
}

/**
 * @param cycles which crop cycles the device currently holds. The default is the
 *   single open cycle every other test in this file wants; the B001 tests pass
 *   two, which is the situation that made the old behaviour fabricate.
 */
async function seedReferenceData(cycles = [cycleRow(CYCLE_OPEN, '2026-06-01')]) {
    const db = getDatabase();
    await db.farms.bulkPut([{
        id: FARM_ID, payload: { id: FARM_ID }, updatedAt: '2026-08-01T00:00:00.000Z',
    }] as never);
    await db.plots.bulkPut([{
        id: PLOT_A, payload: { id: PLOT_A, farmId: FARM_ID, name: 'Plot A' },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
    await db.cropCycles.bulkPut(cycles as never);
}

/**
 * THE CRASH. The save runs for real and then the process "dies" before
 * `enqueueLogsForSync` — the two writes are not in one transaction.
 */
async function saveWithoutEnqueueing(date = DATE): Promise<string> {
    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance(), weatherPort);
    const logs = await service.createFromManual(
        { date, notes: 'शेतात पाणी दिले' },
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

    // -----------------------------------------------------------------------
    // Review B001 — recovery must not resolve "then" using "now".
    // -----------------------------------------------------------------------

    it('B001_a_stranded_log_from_a_CLOSED_cycle_is_not_attributed_to_the_open_one', async () => {
        // Two grape cycles on the same plot, which is the ordinary shape of a
        // second season. The old behaviour sorted open-first and would have
        // stamped this record with CYCLE_OPEN — right date, invented attribution.
        await getDatabase().cropCycles.clear();
        await seedReferenceData([
            cycleRow(CYCLE_CLOSED, '2025-09-01', '2025-12-31'),
            cycleRow(CYCLE_OPEN, '2026-06-01'),
        ]);
        const logId = await saveWithoutEnqueueing(LAST_SEASON_DATE);

        const result = await reconcileStrandedLogs();

        expect(result.requeued).toBe(1);
        const payload = (await createMutationFor(logId))?.payload as { cropCycleId?: string; logDate: string };
        expect(payload.logDate).toBe(LAST_SEASON_DATE);
        expect(payload.cropCycleId).not.toBe(CYCLE_OPEN);
        // The log's own date lands inside exactly one cycle, so the attribution
        // is evidence, not a preference.
        expect(payload.cropCycleId).toBe(CYCLE_CLOSED);
    });

    it('B001_when_the_date_does_not_identify_one_cycle_nothing_is_attributed_at_all', async () => {
        // Two cycles that both contain the log's date. There is no honest answer,
        // so there is no answer: the record stays on the device and is reported.
        await getDatabase().cropCycles.clear();
        await seedReferenceData([
            cycleRow(CYCLE_CLOSED, '2025-09-01', '2026-12-31'),
            cycleRow(CYCLE_OPEN, '2025-10-01'),
        ]);
        const logId = await saveWithoutEnqueueing(LAST_SEASON_DATE);

        const result = await reconcileStrandedLogs();

        expect(result.stranded).toBe(1);
        expect(result.requeued).toBe(0);
        expect(result.unroutable).toBe(1);
        expect(await createMutationFor(logId)).toBeUndefined();
        // And the only copy is untouched.
        expect(await getDatabase().logs.get(logId)).toBeDefined();
    });

    it('B001_a_log_predating_every_cycle_the_device_holds_is_left_unattributed', async () => {
        // Zero matches is as unresolved as two. The old sort would still have
        // answered — it always answers, as long as the plot has any cycle at all.
        const logId = await saveWithoutEnqueueing('2024-03-02');

        const result = await reconcileStrandedLogs();

        expect(result.stranded).toBe(1);
        expect(result.requeued).toBe(0);
        expect(result.unroutable).toBe(1);
        expect(await createMutationFor(logId)).toBeUndefined();
    });

    it('B001_the_normal_save_path_is_untouched_and_still_resolves_at_capture_time', async () => {
        // The default is `'at-capture'`. A record saved today still routes to the
        // open cycle through the same code, with no date-containment involved.
        await getDatabase().cropCycles.clear();
        await seedReferenceData([
            cycleRow(CYCLE_CLOSED, '2025-09-01', '2025-12-31'),
            cycleRow(CYCLE_OPEN, '2026-06-01'),
        ]);
        const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance(), weatherPort);
        const logs = await service.createFromManual({ date: DATE }, scope, [grapes], ownerProfile);
        await service.confirmAndSave(logs);

        await enqueueLogsForSync(logs);

        const payload = (await createMutationFor(logs[0].id))?.payload as { cropCycleId?: string };
        expect(payload.cropCycleId).toBe(CYCLE_OPEN);
    });

    // -----------------------------------------------------------------------
    // Review B004 — one sync cycle for the pass, not one per stranded log.
    // -----------------------------------------------------------------------

    it('B004_three_stranded_logs_produce_ONE_sync_cycle_not_three', async () => {
        await saveWithoutEnqueueing('2026-08-13');
        await saveWithoutEnqueueing('2026-08-14');
        await saveWithoutEnqueueing('2026-08-15');
        triggerNowMock.mockClear();

        const result = await reconcileStrandedLogs();

        expect(result.requeued).toBe(3);
        // Three logs, three enqueues, ONE round trip. `triggerNow` is awaited and
        // chains onto `currentCycle`, so three would have been three sequential
        // push+pull+AI cycles at app start on rural mobile data.
        expect(triggerNowMock).toHaveBeenCalledTimes(1);
    });

    it('B004_a_pass_that_recovers_nothing_does_not_touch_the_network', async () => {
        triggerNowMock.mockClear();

        await reconcileStrandedLogs();

        expect(triggerNowMock).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Review B005 — a still-stranded record must reach somewhere a human looks.
    // -----------------------------------------------------------------------

    it('B005_an_unroutable_record_is_REPORTED_to_the_telemetry_sink_not_just_counted', async () => {
        const logId = await saveWithoutEnqueueing();
        await getDatabase().plots.clear();
        await getDatabase().cropCycles.clear();
        clientErrorMock.mockClear();

        const result = await reconcileStrandedLogs();

        expect(result.unroutable).toBe(1);
        // The returned count is discarded by the only production caller, so the
        // count alone was counting-then-dropping. This is the line that reaches
        // `analyticsOutbox` -> POST /analytics/ingest.
        expect(clientErrorMock).toHaveBeenCalledTimes(1);
        const { message } = clientErrorMock.mock.calls[0][0] as { message: string };
        expect(message).toContain('[strandedLogReconciler]');
        expect(message).toContain(logId);
        // Log ids and dates only — never payloads, notes or transcripts.
        expect(message).not.toContain('शेतात पाणी दिले');
    });

    it('B1_the_same_unroutable_record_is_reported_ONCE_not_once_per_app_launch', async () => {
        // `reconcileStrandedLogs` runs at every worker start and nothing about an
        // unroutable record changes between launches, so the report used to fire
        // again every single time the app opened, for ever — drowning the only
        // channel that tells anyone the record is stranded.
        const logId = await saveWithoutEnqueueing();
        await getDatabase().plots.clear();
        await getDatabase().cropCycles.clear();
        clientErrorMock.mockClear();

        await reconcileStrandedLogs();   // launch 1
        await reconcileStrandedLogs();   // launch 2
        await reconcileStrandedLogs();   // launch 3

        expect(clientErrorMock).toHaveBeenCalledTimes(1);
        expect((clientErrorMock.mock.calls[0][0] as { message: string }).message).toContain(logId);
    });

    it('B1_silent_is_not_invisible_every_pass_still_counts_the_record', async () => {
        await saveWithoutEnqueueing();
        await getDatabase().plots.clear();
        await getDatabase().cropCycles.clear();

        await reconcileStrandedLogs();
        const second = await reconcileStrandedLogs();

        // The alarm is once; the accounting is every pass. A caller or a future
        // sweep still sees the record on the third launch and the tenth.
        expect(second.stranded).toBe(1);
        expect(second.unroutable).toBe(1);
        expect(second.requeued).toBe(0);
    });

    it('B1_a_DIFFERENT_record_still_gets_its_own_report', async () => {
        // Dedup must be per record, not a global "already said something".
        await getDatabase().plots.clear();
        await getDatabase().cropCycles.clear();
        const first = await saveWithoutEnqueueing('2026-08-13');
        clientErrorMock.mockClear();
        await reconcileStrandedLogs();

        const second = await saveWithoutEnqueueing('2026-08-14');
        await reconcileStrandedLogs();

        expect(clientErrorMock).toHaveBeenCalledTimes(2);
        const messages = clientErrorMock.mock.calls.map(c => (c[0] as { message: string }).message);
        expect(messages.some(m => m.includes(first))).toBe(true);
        expect(messages.some(m => m.includes(second))).toBe(true);
    });

    it('B1_a_record_that_becomes_routable_and_strands_again_is_not_re_alarmed', async () => {
        // The record recovered, so the earlier alarm was answered. If it strands
        // again for the SAME reason that is not new information.
        const logId = await saveWithoutEnqueueing();
        await getDatabase().plots.clear();
        await getDatabase().cropCycles.clear();
        clientErrorMock.mockClear();
        await reconcileStrandedLogs();
        expect(clientErrorMock).toHaveBeenCalledTimes(1);

        // Reference data comes back; the record routes and is no longer stranded.
        await seedReferenceData();
        const recovered = await reconcileStrandedLogs();
        expect(recovered.requeued).toBe(1);
        expect(await createMutationFor(logId)).toBeDefined();

        expect(clientErrorMock).toHaveBeenCalledTimes(1);
    });

    it('B005_a_clean_pass_reports_nothing', async () => {
        clientErrorMock.mockClear();

        await reconcileStrandedLogs();

        expect(clientErrorMock).not.toHaveBeenCalled();
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
