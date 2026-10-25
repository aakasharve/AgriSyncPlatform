// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3)
//
// A plot made on the phone never reached the server and its logs could never resolve a
// crop cycle. Through the REAL MutationQueue + payload validator over fake-indexeddb.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDatabase, type MutationQueueStatus } from '../../../../infrastructure/storage/DexieDatabase';
import { SessionStore } from '../../../../infrastructure/storage/SessionStore';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../../../../infrastructure/sync/retryCap';
import { findSendablePendingPlot } from '../pendingPlots';
import { getUnqueueableLogCount, resetUnqueueableLogs } from '../../status/unqueueableLogs';
import {
    PENDING_PLOT_REGISTRATIONS_KEY,
    UNSTATED_STAGE,
    areaInAcres,
    cropCycleIdForPlot,
    reconcileUnregisteredPlots,
    registerNewPlotOnServer,
} from '../registerNewPlotOnServer';
import type { Plot } from '../../../../types';

const FARM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FARM_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PLOT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const plot = (over: Partial<Plot> = {}): Plot => ({
    id: PLOT,
    name: 'नवीन बाग',
    startDate: '2026-10-25T06:00:00.000Z',
    createdAt: '2026-10-25T06:00:00.000Z',
    baseline: { totalArea: 20, unit: 'Guntha' },
    ...over,
} as Plot);

async function queued() {
    const rows = await getDatabase().mutationQueue.toArray();
    return rows
        .filter((r) => r.mutationType === SyncMutationName.CreatePlot || r.mutationType === SyncMutationName.CreateCropCycle)
        .sort((a, b) => (a.id as number) - (b.id as number));
}

describe('a plot made on the phone is sent to the server', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.cropCycles.clear();
        await db.plots.clear();
        await db.uiPrefs.delete(PENDING_PLOT_REGISTRATIONS_KEY);
        SessionStore.clearCurrentFarmId();
        resetUnqueueableLogs();
    });
    afterEach(() => SessionStore.clearCurrentFarmId());

    it('queues create_plot, then create_crop_cycle, with the phone\'s own ids and valid payloads', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        expect(await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' })).toBe('queued');

        const rows = await queued();
        expect(rows.map((r) => r.mutationType)).toEqual([SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle]);
        expect(rows[0].payload).toEqual({ plotId: PLOT, farmId: FARM_A, name: 'नवीन बाग', areaInAcres: 0.5 });
        const cycle = rows[1].payload as { plotId: string; cropName: string; stage: string; startDate: string; cropCycleId: string };
        expect(cycle.plotId).toBe(PLOT);
        expect(cycle.cropName).toBe('Grapes');
        expect(cycle.stage).toBe(UNSTATED_STAGE);
        expect(cycle.startDate).toBe('2026-10-25');
        expect(cycle.cropCycleId).toBe(await cropCycleIdForPlot(PLOT));
    });

    it('writes NOTHING into the phone\'s copies of the server\'s plots and cycles before the server answers', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        expect(await getDatabase().plots.count()).toBe(0);
        expect(await getDatabase().cropCycles.count()).toBe(0);
    });

    it('the crop cycle id is derived from the plot id: same plot, same id; different plot, different id', async () => {
        const a = await cropCycleIdForPlot(PLOT);
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(await cropCycleIdForPlot(PLOT)).toBe(a);
        expect(await cropCycleIdForPlot(FARM_A)).not.toBe(a);
    });

    it('registering the same plot twice leaves one plot row and one cycle row in the queue', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        expect((await queued()).map((r) => r.mutationType)).toEqual([SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle]);
    });

    it('with no area: nothing queued, reported as unsent (the server refuses a plot without one)', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        expect(await registerNewPlotOnServer({ plot: plot({ baseline: { totalArea: 0, unit: 'Acre' } } as Partial<Plot>), cropName: 'Grapes' })).toBe('needs-area');
        expect(await queued()).toEqual([]);
        expect(getUnqueueableLogCount()).toBe(1);
    });

    it('with no current farm: nothing queued, reported as unsent', async () => {
        expect(await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' })).toBe('no-farm');
        expect(await queued()).toEqual([]);
        expect(getUnqueueableLogCount()).toBe(1);
    });

    it('refuses an old-style "p_" id instead of sending something the server would reject', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        expect(await registerNewPlotOnServer({ plot: plot({ id: `p_${PLOT}` }), cropName: 'Grapes' })).toBe('not-a-server-id');
        expect(await queued()).toEqual([]);
    });
});

describe('the start-up retry', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.plots.clear();
        await db.uiPrefs.delete(PENDING_PLOT_REGISTRATIONS_KEY);
        SessionStore.clearCurrentFarmId();
    });

    it('re-queues on the farm the plot was MADE on, even when another farm is open now', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await getDatabase().mutationQueue.clear(); // as if the rows were lost
        SessionStore.setCurrentFarmId(FARM_B);

        expect(await reconcileUnregisteredPlots()).toBe(1);
        const rows = await queued();
        expect(rows).toHaveLength(2);
        expect((rows[0].payload as { farmId: string }).farmId).toBe(FARM_A);
    });

    it('drops a plot the server has sent back, and queues nothing for it', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await getDatabase().mutationQueue.clear();
        await getDatabase().plots.put({ id: PLOT, farmId: FARM_A, payload: {}, updatedAt: '2026-10-26T00:00:00Z' });

        expect(await reconcileUnregisteredPlots()).toBe(0);
        expect(await queued()).toEqual([]);
        const pending = await getDatabase().uiPrefs.get(PENDING_PLOT_REGISTRATIONS_KEY);
        expect(pending?.value).toEqual([]);
    });

    it('a plot still waiting collapses into its existing queue rows', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await reconcileUnregisteredPlots();
        expect(await queued()).toHaveLength(2);
    });
});

// Review round 3 B1 — a log may use a recorded plot only while both of its rows are live.
describe('when a log may be queued on a plot made on this phone', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.plots.clear();
        await db.uiPrefs.delete(PENDING_PLOT_REGISTRATIONS_KEY);
        SessionStore.setCurrentFarmId(FARM_A);
    });
    afterEach(() => SessionStore.clearCurrentFarmId());

    async function setStatus(mutationType: string, status: MutationQueueStatus, retryCount = 0) {
        const row = (await queued()).find((r) => r.mutationType === mutationType);
        await getDatabase().mutationQueue.update(row!.id as number, { status, retryCount });
    }

    it('yes, while its plot and cycle rows are queued', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        expect((await findSendablePendingPlot(PLOT))?.farmId).toBe(FARM_A);
    });

    it('yes, once the plot is accepted and the cycle is still on the way', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await setStatus(SyncMutationName.CreatePlot, 'APPLIED');
        expect(await findSendablePendingPlot(PLOT)).not.toBeNull();
    });

    it('no, when the plot is recorded but its rows never reached the queue', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await getDatabase().mutationQueue.clear();
        expect(await findSendablePendingPlot(PLOT)).toBeNull();
    });

    it('no, when the server refused the plot', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await setStatus(SyncMutationName.CreatePlot, 'REJECTED_USER_REVIEW');
        expect(await findSendablePendingPlot(PLOT)).toBeNull();
    });

    it('no, when the farmer discarded the plot', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await setStatus(SyncMutationName.CreatePlot, 'REJECTED_DROPPED');
        expect(await findSendablePendingPlot(PLOT)).toBeNull();
    });

    it('no, when the crop cycle ran out of retries', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await setStatus(SyncMutationName.CreateCropCycle, 'FAILED', MAX_AUTO_RETRY_COUNT);
        expect(await findSendablePendingPlot(PLOT)).toBeNull();
    });

    it('the start-up retry does not bring a discarded plot back to life', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        await setStatus(SyncMutationName.CreatePlot, 'REJECTED_DROPPED');
        await reconcileUnregisteredPlots();
        const rows = await queued();
        expect(rows).toHaveLength(2);
        expect(rows.find((r) => r.mutationType === SyncMutationName.CreatePlot)?.status).toBe('REJECTED_DROPPED');
    });
});

describe('area in acres', () => {
    it('converts the units the wizard offers', () => {
        expect(areaInAcres(2, 'Acre')).toBe(2);
        expect(areaInAcres(20, 'Guntha')).toBe(0.5);
        expect(areaInAcres(100, 'Are')).toBe(2.4711);
    });
    it('never invents an area: missing or negative is 0, and a 0 is never sent', () => {
        expect(areaInAcres(undefined, 'Acre')).toBe(0);
        expect(areaInAcres(-3, 'Acre')).toBe(0);
    });
});
