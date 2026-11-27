// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 (founder 27 Nov) - THE seam every screen reads: `useAppData`'s `crops`, `history` and the farm's people. Home,
 * लक्ष द्या, the नोंद and voice plot pickers, शेड्यूल, आढावा, तुलना and the सेट-अप केंद्र all take `data.crops` / `data.history` from
 * here (the router hands the same lists on). In the FIX-1 drive's shape - मुकादम on farm A (टोमॅटो, 6 plots), owner of farm B (1
 * plot) - each farm shows only its own, and the header's switch (FarmContext, the ONE source of the open farm since FIX-1) flips
 * them. A save on farm B keeps every one of farm A's plots, on the phone and in the queued commands.
 *
 * Real Dexie on fake-indexeddb for the crop list, the downloaded plots and farms, and the queue; the providers are stubbed.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { CropProfile, DailyLog, FarmerProfile, Plot } from '../../../types';

const h = vi.hoisted(() => ({
    logs: [] as unknown[],
    profile: null as unknown,
}));

vi.mock('../../providers/DataSourceProvider', async () => {
    const { DexieCropsRepository } = await import('../../../infrastructure/storage/DexieCropsRepository');
    const dataSource = {
        crops: new DexieCropsRepository(),
        profile: { get: async () => h.profile, save: async () => { } },
        logs: { getAll: async () => h.logs },
    };
    return {
        useDataSource: () => ({ dataSource, auditPort: {}, isDemoMode: false, setDemoMode: async () => { }, isLoading: false }),
    };
});
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ isAuthenticated: false, session: null }) }));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => { }) } }));

import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { DexieCropsRepository } from '../../../infrastructure/storage/DexieCropsRepository';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { FarmContext } from '../../../core/session/FarmContext';
import { useAppData } from '../useAppData';

const A = 'farm-a';
const B = 'farm-b';
const at = '2026-11-27T06:00:00.000Z';
const A_PLOTS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];

const plot = (id: string): Plot => ({ id, name: id.toUpperCase(), baseline: { totalArea: 1, unit: 'Acre' } } as Plot);
const tomato = (): CropProfile => ({
    id: 'crop_tomato', name: 'टोमॅटो', iconName: 'Sprout', color: 'bg-emerald-500',
    plots: [...A_PLOTS.map(plot), plot('b1')], supportedTasks: [], workflow: [],
});
const log = (id: string, farmId: string, plotId: string, maker: string): DailyLog => ({
    id, date: '2026-11-27', dayOutcome: null, cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    context: { selection: [{ cropId: 'crop_tomato', cropName: 'टोमॅटो', selectedPlotIds: [plotId], selectedPlotNames: [plotId] }] },
    meta: { createdAtISO: at, farmId, createdByOperatorId: maker },
} as DailyLog);
const op = (id: string, name: string) => ({ id, name, role: 'WORKER', capabilities: [], isVerifier: false, isActive: true });

let open = { farmId: A as string, farms: [A, B] };
const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FarmContext.Provider value={{
        meContext: null, isLoading: false, currentFarmId: open.farmId, currentFarm: null,
        farms: open.farms.map(farmId => ({ farmId })), switchFarm: vi.fn(), refresh: async () => { }, loadFailed: false,
    } as never}>
        {children}
    </FarmContext.Provider>
);

const shape = (crops: CropProfile[]) => crops.map(c => `${c.id}:${c.plots.map(p => p.id).join(',')}`);

async function seedDrive(): Promise<void> {
    const db = getDatabase();
    await new DexieCropsRepository().save([tomato()]);
    await db.farms.bulkPut([
        { id: A, payload: { id: A, ownerUserId: 'u-owner-a' }, updatedAt: at },
        { id: B, payload: { id: B, ownerUserId: 'u-me' }, updatedAt: at },
    ]);
    await db.plots.bulkPut([...A_PLOTS.map(id => ({ id, farmId: A, payload: {}, updatedAt: at })), { id: 'b1', farmId: B, payload: {}, updatedAt: at }]);
    h.logs = [log('la', A, 'a1', 'u-worker-a'), log('lb', B, 'b1', 'u-worker-b')];
    h.profile = {
        name: 'मी', village: '', phone: '', language: 'mr', verificationStatus: 'Unverified', activeOperatorId: 'u-me',
        operators: [op('u-me', 'मी'), op('u-owner-a', 'अ मालक'), op('u-worker-a', 'अ कामगार'), op('u-worker-b', 'ब कामगार')],
        waterResources: [], motors: [], infrastructure: { waterManagement: 'Decentralized', filtrationType: 'Screen' },
    } as unknown as FarmerProfile;
}

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
    open = { farmId: A, farms: [A, B] };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('useAppData shows only the open farm', () => {
    it('crops, plots, entries and people of farm A; the switch to farm B flips every one of them', async () => {
        await seedDrive();
        const { result, rerender } = renderHook(() => useAppData(), { wrapper });
        await waitFor(() => expect(result.current.dataLoaded).toBe(true));

        expect(shape(result.current.crops)).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6']);
        expect(result.current.history.map(l => l.id)).toEqual(['la']);
        expect(result.current.farmPeople.map(o => o.id)).toEqual(['u-me', 'u-owner-a', 'u-worker-a']);

        open = { ...open, farmId: B };
        rerender();
        expect(shape(result.current.crops)).toEqual(['crop_tomato:b1']);
        expect(result.current.history.map(l => l.id)).toEqual(['lb']);
        expect(result.current.farmPeople.map(o => o.id)).toEqual(['u-me', 'u-worker-b']);
        // The hub's "पिकं · प्लॉट" line on B: one crop, one plot (the drive showed "१ पिकं · ७ प्लॉट").
        expect(result.current.crops.reduce((n, c) => n + c.plots.length, 0)).toBe(1);
    });

    it('a save on farm B keeps all of farm A\'s plots on the phone and A\'s queued plot in the queue', async () => {
        await seedDrive();
        const db = getDatabase();
        // A's plot made offline, still waiting in the queue (not downloaded yet).
        await db.mutationQueue.add({
            deviceId: 'd', clientRequestId: 'r-a7', clientCommandId: 'c-a7', mutationType: SyncMutationName.CreatePlot,
            payload: { plotId: 'a7', farmId: A, name: 'A7', areaInAcres: 1 }, status: 'PENDING', createdAt: at, updatedAt: at, retryCount: 0,
        } as never);
        const stored = await new DexieCropsRepository().getAll();
        await new DexieCropsRepository().save([{ ...stored[0], plots: [...stored[0].plots, plot('a7')] }]);

        open = { ...open, farmId: B };
        const { result, rerender } = renderHook(() => useAppData(), { wrapper });
        await waitFor(() => expect(result.current.dataLoaded).toBe(true));
        expect(shape(result.current.crops)).toEqual(['crop_tomato:b1']);

        // The add-plot door on B hands back the list it was shown, with the new plot.
        const shown = result.current.crops;
        await act(async () => {
            await result.current.handleUpdateCrops(shown.map(c => ({ ...c, plots: [...c.plots, plot('b2')] })));
        });

        const after = await new DexieCropsRepository().getAll();
        expect(after[0].plots.map(p => p.id)).toEqual([...A_PLOTS, 'b1', 'a7', 'b2']);
        expect(after[0].plots.find(p => p.id === 'b2')?.farmId).toBe(B);
        const queue = await db.mutationQueue.where('mutationType').equals(SyncMutationName.CreatePlot).toArray();
        expect(queue.map(r => (r.payload as { plotId: string }).plotId)).toContain('a7');
        expect(shape(result.current.crops)).toEqual(['crop_tomato:b1,b2']);

        // ...and farm A still shows its seven plots, the queued one included.
        open = { ...open, farmId: A };
        rerender();
        expect(shape(result.current.crops)).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6,a7']);
    });

    it('removing the crop on farm B removes only B\'s plot of it', async () => {
        await seedDrive();
        open = { ...open, farmId: B };
        const { result } = renderHook(() => useAppData(), { wrapper });
        await waitFor(() => expect(result.current.dataLoaded).toBe(true));
        await act(async () => { await result.current.handleUpdateCrops([]); });
        expect((await new DexieCropsRepository().getAll()).map(c => c.plots.map(p => p.id))).toEqual([A_PLOTS]);
        expect(result.current.crops).toEqual([]);
    });

    it('a one-farm person sees exactly what he sees today', async () => {
        const db = getDatabase();
        await new DexieCropsRepository().save([{ ...tomato(), plots: A_PLOTS.map(plot) }]);
        await db.farms.put({ id: A, payload: { id: A }, updatedAt: at });
        await db.plots.bulkPut(A_PLOTS.slice(0, 3).map(id => ({ id, farmId: A, payload: {}, updatedAt: at })));
        // An older record with no farm written on it, on a plot the phone made long ago (no farm known for it).
        h.logs = [log('la', A, 'a1', 'u-me'), { ...log('l-old', A, 'a6', 'u-me'), meta: { createdAtISO: at } } as DailyLog];
        h.profile = null;
        open = { farmId: A, farms: [A] };
        const { result } = renderHook(() => useAppData(), { wrapper });
        await waitFor(() => expect(result.current.dataLoaded).toBe(true));
        expect(shape(result.current.crops)).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6']);
        expect(result.current.history.map(l => l.id)).toEqual(['la', 'l-old']);
        expect(result.current.farmPeople).toBe(result.current.farmerProfile.operators);
    });
});
