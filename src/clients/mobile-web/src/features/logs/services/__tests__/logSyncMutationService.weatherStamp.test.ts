/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context (Phase 2b — B1d)
 *
 * THE WIRE HALF of "weather is a spine": what a plot-less record's weather looks
 * like on `create_daily_log`, asserted against the CANONICAL zod schema rather
 * than against this repo's opinion of it.
 *
 * TWO THINGS ARE PROVEN HERE AND NEITHER IS COSMETIC.
 *
 *  1. A record naming a SET of plots, or none at all, sends its weather with the
 *     `plotId` KEY ABSENT — not present-and-null, not a sentinel. The server
 *     models `Guid? PlotId` and `weather_stamps.plot_id` is `uuid NULL`, so
 *     absence is a shape the server already stores; the row records the reading
 *     and the parent log records the scope it applies to.
 *
 *  2. THE TRAP. `plotId` is `ZGuid` on that schema. The weather clients fill the
 *     field with `'farm'` (`BackendWeatherClient:112`), `'device'` (`:181`) and
 *     `'unknown'` (`TomorrowIoWeatherService:64`) — none of which is a UUID. If
 *     one of those ever reaches the payload, `validatePayload` fails,
 *     `MutationQueue.enqueue` THROWS, `enqueueLogsForSync` has no try/catch, and
 *     the farmer sees "Failed to save logs" with NOTHING queued to retry. The
 *     last test states that consequence as an executable fact, so the next
 *     person to touch the enrichment finds out from a red test rather than from
 *     a farmer whose day vanished.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { LogCommandServiceImpl } from '../../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../../infrastructure/storage/DexieLogsRepository';
import { enqueueLogsForSync } from '../logSyncMutationService';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import type { WeatherPort } from '../../../../application/ports/WeatherPort';
import type { WeatherStamp } from '../../../../domain/types/weather.types';
import type {
    CropProfile,
    FarmerProfile,
    LabourEvent,
    LogScope,
    PlotGeo,
} from '../../../../types';

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
const PLOT_B = 'b0000000-0000-4000-8000-00000000000b';
const CYCLE_A = 'e0000000-0000-4000-8000-00000000000a';
const CYCLE_B = 'e0000000-0000-4000-8000-00000000000b';
const DATE = '2026-08-13';

const PLOTS: Array<[string, string, string]> = [
    [PLOT_A, 'Plot A', CYCLE_A],
    [PLOT_B, 'Plot B', CYCLE_B],
];

const grapes: CropProfile = {
    id: CROP_ID,
    name: 'Grapes',
    plots: PLOTS.map(([id, name]) => ({ id, name })),
} as unknown as CropProfile;

const ownerProfile = {
    activeOperatorId: 'owner',
    location: { lat: 20.0, lon: 73.8, source: 'manual', updatedAt: 'T' },
} as unknown as FarmerProfile;

/** Verbatim what `BackendWeatherClient.getCurrentWeather` returns. */
const providerStamp = (): WeatherStamp => ({
    id: 'wx_1',
    plotId: 'farm',
    timestampLocal: '2026-08-13T09:00:00.000Z',
    timestampProvider: '2026-08-13T08:55:00.000Z',
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

const scopeFor = (plotIds: string[], cropIds: string[] = [CROP_ID]): LogScope => ({
    selectedPlotIds: plotIds,
    selectedCropIds: cropIds,
    mode: plotIds.length > 1 ? 'multi' : 'single',
    applyPolicy: 'SHARED',
} as unknown as LogScope);

const eightWorkers = (): LabourEvent[] => ([{
    id: 'lab-1',
    type: 'HIRED',
    engagementType: 'hired_daily',
    count: 8,
    totalCost: 4000,
} as LabourEvent]);

async function seedReferenceData() {
    const db = getDatabase();
    await db.farms.bulkPut([{
        id: FARM_ID,
        payload: { id: FARM_ID },
        updatedAt: '2026-08-01T00:00:00.000Z',
    }] as never);
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

interface QueuedLogPayload {
    dailyLogId: string;
    scope?: string;
    weatherStamp?: { plotId?: string; tempC: number };
}

async function queuedPayloads(): Promise<QueuedLogPayload[]> {
    const rows = await getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();
    return rows.map(row => row.payload as unknown as QueuedLogPayload);
}

/** The real chain: real factory, real enrichment, real Dexie, real enqueue. */
async function recordAndSend(scope: LogScope) {
    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance(), weatherPort);
    const logs = await service.createFromManual(
        { date: DATE, labour: eightWorkers() },
        scope,
        [grapes],
        ownerProfile,
    );
    await service.confirmAndSave(logs);
    await enqueueLogsForSync(logs);
    await new Promise(resolve => setTimeout(resolve, 0));
    return logs;
}

describe('B1d — weather on the wire for a record that names no single plot', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.farms.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('a FARM-SCOPED save sends its weather, and the canonical schema accepts it', async () => {
        await recordAndSend(scopeFor([], ['FARM_GLOBAL']));

        const [payload] = await queuedPayloads();
        expect(payload.scope).toBe('Farm');
        expect(payload.weatherStamp).toBeDefined();
        expect(payload.weatherStamp?.tempC).toBe(29.4);
        expect(validatePayload(SyncMutationName.CreateDailyLog, payload)).toEqual({ ok: true });
    });

    it('a MULTI-PLOT save sends its weather, and the canonical schema accepts it', async () => {
        await recordAndSend(scopeFor([PLOT_A, PLOT_B]));

        const [payload] = await queuedPayloads();
        expect(payload.scope).toBe('MultiPlot');
        expect(payload.weatherStamp?.tempC).toBe(29.4);
        expect(validatePayload(SyncMutationName.CreateDailyLog, payload)).toEqual({ ok: true });
    });

    it('omits the `plotId` KEY rather than sending null or a sentinel', async () => {
        await recordAndSend(scopeFor([PLOT_A, PLOT_B]));

        const [payload] = await queuedPayloads();
        expect(
            Object.prototype.hasOwnProperty.call(payload.weatherStamp ?? {}, 'plotId')
        ).toBe(false);
    });

    it('a SINGLE-PLOT save still names its plot on the stamp', async () => {
        await recordAndSend(scopeFor([PLOT_A]));

        const [payload] = await queuedPayloads();
        expect(payload.weatherStamp?.plotId).toBe(PLOT_A);
        expect(validatePayload(SyncMutationName.CreateDailyLog, payload)).toEqual({ ok: true });
    });

    it("THE TRAP: the client's `'farm'` placeholder would be REJECTED, losing the record", async () => {
        await recordAndSend(scopeFor([PLOT_A, PLOT_B]));
        const [payload] = await queuedPayloads();

        // Exactly the payload above, with the placeholder the provider returned
        // left where the enrichment now clears it.
        const poisoned = {
            ...payload,
            weatherStamp: { ...payload.weatherStamp, plotId: 'farm' },
        };

        const verdict = validatePayload(SyncMutationName.CreateDailyLog, poisoned);
        expect(verdict.ok).toBe(false);
        // `MutationQueue.enqueue` throws on this, `enqueueLogsForSync` does not
        // catch, and the farmer's whole save fails — with no queued row to retry.
        expect(verdict.ok ? [] : verdict.errors.map(error => error.path))
            .toContain('weatherStamp.plotId');
    });
});
