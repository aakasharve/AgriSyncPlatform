// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 - which farm each plot on this phone belongs to, read from what the phone already holds (no new store, Dexie v33
 * unchanged): the downloaded plots table (`plots.farmId`), then the plot's waiting `create_plot`, then the phone's own record of a
 * plot it made. Through the REAL download (`reconcileSyncPull`) and the REAL add-plot door (`registerNewPlotOnServer`) over
 * fake-indexeddb: a first download, a full re-download (`since=0`) and a plot made offline before its first sync all land under
 * the right farm.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/reference/TemplateCatalog', async (importActual) => ({
    ...(await importActual<typeof import('../../../../infrastructure/reference/TemplateCatalog')>()),
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieCropsRepository } from '../../../../infrastructure/storage/DexieCropsRepository';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { reconcileSyncPull } from '../../pull/SyncPullReconciler';
import { registerNewPlotOnServer } from '../registerNewPlotOnServer';
import { readPlotFarmIndex } from '../plotFarmIndex';
import { cropsOnFarm, openFarmOf } from '../../../../app/helpers/openFarmView';
import type { CropProfile, Plot } from '../../../../types';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ME = '11111111-1111-4111-8111-111111111111';
const OWNER_A = '22222222-2222-4222-8222-222222222222';
const pid = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const A_PLOTS = [1, 2, 3, 4, 5, 6].map(pid);
const B_PLOT = pid(7);
const OFFLINE_PLOT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const at = '2026-11-27T06:00:00.000Z';
/** The drive's shape: मुकादम on A (टोमॅटो, 6 plots), owner of B (1 plot, also टोमॅटो). */
const payload = (): SyncPullResponse => ({
    serverTimeUtc: at,
    nextCursorUtc: at,
    farms: [
        { id: A, name: 'अ शेत', ownerUserId: OWNER_A, createdAtUtc: at, modifiedAtUtc: at },
        { id: B, name: 'ब शेत', ownerUserId: ME, createdAtUtc: at, modifiedAtUtc: at },
    ],
    plots: [
        ...A_PLOTS.map((id, i) => ({ id, farmId: A, name: `A${i + 1}`, areaInAcres: 1, createdAtUtc: at, modifiedAtUtc: at })),
        { id: B_PLOT, farmId: B, name: 'B1', areaInAcres: 1, createdAtUtc: at, modifiedAtUtc: at },
    ],
    cropCycles: [
        ...A_PLOTS.map((plotId, i) => ({ id: `cy-a${i}`, farmId: A, plotId, cropName: 'टोमॅटो', stage: 'x', startDate: '2026-10-01', createdAtUtc: at, modifiedAtUtc: at })),
        { id: 'cy-b', farmId: B, plotId: B_PLOT, cropName: 'टोमॅटो', stage: 'x', startDate: '2026-10-01', createdAtUtc: at, modifiedAtUtc: at },
    ],
    dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
    operators: [{ userId: ME, displayName: 'मी', role: 'PRIMARY_OWNER' }],
    scheduleTemplates: [], cropTypes: [], activityCategories: [], costCategories: [], referenceDataVersionHash: 'h',
} as unknown as SyncPullResponse);

const shape = (crops: CropProfile[]) => crops.map(c => `${c.name}:${c.plots.map(p => p.name).join(',')}`);

async function viewOf(farmId: string): Promise<string[]> {
    const index = await readPlotFarmIndex();
    if (!index) throw new Error('index not read');
    const crops = await new DexieCropsRepository().getAll();
    return shape(cropsOnFarm(crops, openFarmOf(farmId, index), index));
}

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
    localStorage.clear();
});

describe('the index of plot -> farm', () => {
    it('reads the downloaded plots, the waiting create_plot and the phone\'s record, the downloaded table first', async () => {
        const db = getDatabase();
        await db.farms.put({ id: A, payload: { id: A, ownerUserId: OWNER_A }, updatedAt: at });
        await db.plots.put({ id: 'p-down', farmId: A, payload: {}, updatedAt: at });
        await db.mutationQueue.add({
            deviceId: 'd', clientRequestId: 'r1', clientCommandId: 'c1', mutationType: SyncMutationName.CreatePlot,
            payload: { plotId: 'p-queued', farmId: B, name: 'x', areaInAcres: 1 }, status: 'PENDING', createdAt: at, updatedAt: at, retryCount: 0,
        } as never);
        // A stale queue row naming another farm for a plot the server already sent: the server's table wins.
        await db.mutationQueue.add({
            deviceId: 'd', clientRequestId: 'r2', clientCommandId: 'c2', mutationType: SyncMutationName.CreatePlot,
            payload: { plotId: 'p-down', farmId: B, name: 'x', areaInAcres: 1 }, status: 'PENDING', createdAt: at, updatedAt: at, retryCount: 0,
        } as never);
        await db.uiPrefs.put({ key: 'agrisync_pending_plot_registrations_v1', value: [{ plotId: 'p-made', farmId: B, name: 'x', areaInAcres: 1, cropName: 'x', startDate: '2026-11-27' }] });

        const index = await readPlotFarmIndex();
        expect(index?.plotFarm.get('p-down')).toBe(A);
        expect(index?.plotFarm.get('p-queued')).toBe(B);
        expect(index?.plotFarm.get('p-made')).toBe(B);
        expect([...(index?.farmIds ?? [])].sort()).toEqual([A, B].sort());
        expect(index?.farmOwner.get(A)).toBe(OWNER_A);
    });
});

describe('downloads land under the right farm', () => {
    it('a first download: farm A shows टोमॅटो with A1-A6, farm B shows टोमॅटो with B1', async () => {
        await reconcileSyncPull(payload());
        expect(await viewOf(A)).toEqual(['टोमॅटो:A1,A2,A3,A4,A5,A6']);
        expect(await viewOf(B)).toEqual(['टोमॅटो:B1']);
    });

    it('a full re-download (since=0) changes nothing', async () => {
        await reconcileSyncPull(payload());
        await reconcileSyncPull(payload(), { fullPull: true, rebuildLogs: true });
        expect(await viewOf(A)).toEqual(['टोमॅटो:A1,A2,A3,A4,A5,A6']);
        expect(await viewOf(B)).toEqual(['टोमॅटो:B1']);
    });

    it('a plot made offline on B before its first sync shows on B only - before and after the server sends it back', async () => {
        await reconcileSyncPull(payload());
        const repo = new DexieCropsRepository();
        const offline: Plot = { id: OFFLINE_PLOT, name: 'B2', baseline: { totalArea: 1, unit: 'Acre' } } as Plot;
        expect(await registerNewPlotOnServer({ plot: offline, cropName: 'टोमॅटो', farmId: B })).toBe('queued');
        const crops = await repo.getAll();
        await repo.save(crops.map(c => ({ ...c, plots: [...c.plots, offline] })));

        expect(await viewOf(B)).toEqual(['टोमॅटो:B1,B2']);
        expect(await viewOf(A)).toEqual(['टोमॅटो:A1,A2,A3,A4,A5,A6']);

        // A pull that does not carry it yet keeps it on B; the pull that carries it puts its farm in the downloaded table.
        await reconcileSyncPull(payload());
        expect(await viewOf(B)).toEqual(['टोमॅटो:B1,B2']);
        const back = payload();
        back.plots.push({ id: OFFLINE_PLOT, farmId: B, name: 'B2', areaInAcres: 1, createdAtUtc: at, modifiedAtUtc: at } as never);
        back.cropCycles.push({ id: 'cy-b2', farmId: B, plotId: OFFLINE_PLOT, cropName: 'टोमॅटो', stage: 'x', startDate: '2026-10-01', createdAtUtc: at, modifiedAtUtc: at } as never);
        await reconcileSyncPull(back);
        expect(await viewOf(B)).toEqual(['टोमॅटो:B1,B2']);
        expect(await viewOf(A)).toEqual(['टोमॅटो:A1,A2,A3,A4,A5,A6']);
    });
});
