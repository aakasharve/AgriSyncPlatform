// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 box 2e — THE WIRING, which the reconciler's own tests cannot prove.
 *
 * `strandedLogReconciler.test.ts` mocks `BackgroundSyncWorker` away so it can
 * test the rule in isolation. That leaves one thing unproven and it is the thing
 * most likely to break silently: `BackgroundSyncWorker.start()` reaches the
 * reconciler through a DYNAMIC import, taken because
 * `logSyncMutationService` imports `backgroundSyncWorker` and a static import
 * would close a cycle through this file's own singleton.
 *
 * A dynamic import that fails to resolve throws at call time, not build time,
 * and the caller logs and continues — so the recovery would simply never run and
 * nothing would say so. This file drives the REAL worker method, through the
 * REAL cycle, and checks a stranded record actually comes back.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { LogCommandServiceImpl } from '../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../storage/DexieLogsRepository';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { mutationQueue } from '../MutationQueue';
import { parentClientRequestIdForDailyLog } from '../MutationDependency';
import type { CropProfile, FarmerProfile, LogScope, PlotGeo } from '../../../types';
import type { WeatherPort } from '../../../application/ports/WeatherPort';
import type { WeatherStamp } from '../../../domain/types/weather.types';

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';
const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT_A = 'a0000000-0000-4000-8000-00000000000a';
const CYCLE_A = 'e0000000-0000-4000-8000-00000000000a';

vi.mock('../../storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => 'f0000000-0000-4000-8000-000000000001',
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

// No auth session is mocked in, so `safeRunCycle` returns before touching the
// network. `enqueueLogsForSync` calls `triggerNow()` and that is a real call to
// a real worker — which is part of what this file is proving does not explode.

const grapes = {
    id: CROP_ID, name: 'Grapes', plots: [{ id: PLOT_A, name: 'Plot A' }],
} as unknown as CropProfile;

const ownerProfile = {
    activeOperatorId: 'owner',
    location: { lat: 20.0, lon: 73.8, source: 'manual', updatedAt: 'T' },
} as unknown as FarmerProfile;

const stamp = (): WeatherStamp => ({
    id: 'wx_1', plotId: 'farm',
    timestampLocal: '2026-08-15T09:00:00.000Z',
    timestampProvider: '2026-08-15T08:55:00.000Z',
    provider: 'tomorrow.io', tempC: 29.4, humidity: 61, windKph: 8, precipMm: 0,
    cloudCoverPct: 20, conditionText: 'Partly Cloudy', iconCode: 'partly_cloudy',
    rainProbNext6h: 10,
});

const weatherPort = {
    getCurrentWeather: vi.fn(async (_geo: PlotGeo) => stamp()),
    getForecast: vi.fn(async () => []),
} as unknown as WeatherPort;

const scope = {
    selectedPlotIds: [PLOT_A], selectedCropIds: [CROP_ID],
    mode: 'single', applyPolicy: 'SHARED',
} as unknown as LogScope;

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();

    const fresh = getDatabase();
    await fresh.farms.bulkPut([{
        id: FARM_ID, payload: { id: FARM_ID }, updatedAt: '2026-08-01T00:00:00.000Z',
    }] as never);
    await fresh.plots.bulkPut([{
        id: PLOT_A, payload: { id: PLOT_A, farmId: FARM_ID, name: 'Plot A' },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
    await fresh.cropCycles.bulkPut([{
        id: CYCLE_A, plotId: PLOT_A,
        payload: {
            id: CYCLE_A, plotId: PLOT_A, farmId: FARM_ID, cropName: 'Grapes',
            // Review B001 — recovery resolves the cycle by DATE CONTAINMENT, so
            // a cycle fixture without dates is now a cycle nothing can land in.
            startDate: '2026-06-01',
            modifiedAtUtc: '2026-08-01T00:00:00.000Z',
        },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
}

describe('BackgroundSyncWorker.reconcileStrandedLogs — §P0.7 box 2e wiring', () => {
    beforeEach(async () => {
        await freshDb();
        localStorage.clear();
    });

    it('the_worker_reaches_the_reconciler_through_the_dynamic_import_and_recovers_the_record', async () => {
        // THE CRASH: the log is saved, the enqueue never happens.
        const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance(), weatherPort);
        const logs = await service.createFromManual({ date: '2026-08-15' }, scope, [grapes], ownerProfile);
        await service.confirmAndSave(logs);
        const logId = logs[0].id;

        await backgroundSyncWorker.reconcileStrandedLogs();

        const row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), parentClientRequestIdForDailyLog(logId)])
            .first();
        expect(row, 'the dynamic import resolved and the stranded record was re-queued').toBeDefined();
        expect(row?.status).toBe('PENDING');
    });

    it('is_safe_on_a_device_with_nothing_stranded', async () => {
        await expect(backgroundSyncWorker.reconcileStrandedLogs()).resolves.toBeUndefined();
        expect(await getDatabase().mutationQueue.count()).toBe(0);
    });
});
