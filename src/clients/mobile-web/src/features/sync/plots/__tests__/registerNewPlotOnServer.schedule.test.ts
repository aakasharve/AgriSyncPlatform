// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (lane WIZARD-F2; founder pick F2, 2026-11-19)
//
// "At plot creation ask only the date; the checked schedule for the crop is followed by itself." The schedule choice is sent to the server
// with the plot: create_plot, then create_crop_cycle, then adopt_schedule - the order the server needs (the adopt answers PlotNotFound /
// CropCycleNotFound until the first two have landed; the outbox sends oldest first and the server handles a batch in order).
// Through the REAL MutationQueue + payload validator over fake-indexeddb.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { ScheduleSubscriptionRow } from '../../../../infrastructure/storage/scheduleSubscriptionRow';
import { SessionStore } from '../../../../infrastructure/storage/SessionStore';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { PENDING_PLOT_REGISTRATIONS_KEY, cropCycleIdForPlot, reconcileUnregisteredPlots, registerNewPlotOnServer } from '../registerNewPlotOnServer';
import type { Plot } from '../../../../types';

const FARM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLOT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OLD_PLOT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OLD_CYCLE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CHECKED = '10000000-0000-4000-8000-000000000003';
const OLD_TEMPLATE = '10000000-0000-4000-8000-000000000009';
const OLD_SUB = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** A phone-made plot whose start date is the day he chose (date only, not "now"). */
const plot = (over: Partial<Plot> = {}): Plot => ({
    id: PLOT,
    name: 'नवीन बाग',
    startDate: '2026-03-04',
    createdAt: '2026-11-19T06:00:00.000Z',
    baseline: { totalArea: 20, unit: 'Guntha' },
    ...over,
} as Plot);

const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id as number) - (b.id as number));

describe('a new plot sends its schedule choice with it', () => {
    beforeEach(async () => {
        await resetDatabase();
        const db = getDatabase();
        await Promise.all([db.mutationQueue.clear(), db.cropCycles.clear(), db.plots.clear(), db.scheduleSubscriptions.clear(), db.uiPrefs.delete(PENDING_PLOT_REGISTRATIONS_KEY)]);
        SessionStore.setCurrentFarmId(FARM);
    });
    afterEach(() => SessionStore.clearCurrentFarmId());

    it('queues create_plot, create_crop_cycle, adopt_schedule - in that order, nothing else', async () => {
        const outcome = await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } });
        expect(outcome).toBe('queued');
        expect((await queue()).map(r => r.mutationType)).toEqual([
            SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle, SyncMutationName.AdoptSchedule,
        ]);
    });

    it('the crop cycle starts on the CHOSEN day, and the adopt carries that day as its reference date, for the new plot and its derived cycle', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } });
        const [, cycle, adopt] = await queue();
        expect(cycle.payload).toMatchObject({ plotId: PLOT, startDate: '2026-03-04' });
        const cycleId = await cropCycleIdForPlot(PLOT);
        expect(adopt.payload).toMatchObject({
            farmId: FARM, plotId: PLOT, cropCycleId: cycleId, scheduleTemplateId: CHECKED, referenceDate: '2026-03-04',
        });
        // the id the phone keeps for the choice is the id it sends, so the server's row comes back under it
        const subscriptionId = (adopt.payload as { subscriptionId: string }).subscriptionId;
        const kept = await getDatabase().scheduleSubscriptions.get(subscriptionId);
        expect(kept).toMatchObject({ plotId: PLOT, cropCycleId: cycleId, templateId: CHECKED, referenceDate: '2026-03-04', pending: true, state: 'Active' });
    });

    it('is a plain ADOPT (a new plot follows nothing yet), never a migrate, and says nothing about a carry-over', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } });
        const types = (await queue()).map(r => r.mutationType);
        expect(types).not.toContain(SyncMutationName.MigrateSchedule);
        const adopt = (await queue())[2];
        expect((adopt.payload as Record<string, unknown>).carryOver).toBeUndefined();
    });

    it('a plot made with no schedule choice queues exactly the two rows it always did', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes' });
        expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle]);
        expect(await getDatabase().scheduleSubscriptions.count()).toBe(0);
    });

    it('a choice that is not a real server schedule (no GUID) is never adopted and leaves no local row', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes', schedule: { templateId: 'tpl_fallback_grape', referenceDate: '2026-03-04' } });
        expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle]);
        expect(await getDatabase().scheduleSubscriptions.count()).toBe(0);
    });

    it('only the NEW plot gets a choice: another plot\'s subscription and queue rows are untouched', async () => {
        const db = getDatabase();
        const old: ScheduleSubscriptionRow = {
            id: OLD_SUB, farmId: FARM, plotId: OLD_PLOT, cropCycleId: OLD_CYCLE, templateId: OLD_TEMPLATE, referenceDate: '2026-01-01',
            state: 'Active', adoptedAtUtc: '2026-02-01T00:00:00Z', slot: 1, isMain: true, origin: 'Outside',
        };
        await db.scheduleSubscriptions.put(old);
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } });
        expect(await db.scheduleSubscriptions.get(OLD_SUB)).toEqual(old);
        const touchedOld = (await queue()).filter(r => JSON.stringify(r.payload).includes(OLD_PLOT));
        expect(touchedOld).toEqual([]);
        expect(await db.scheduleSubscriptions.where('plotId').equals(PLOT).count()).toBe(1);
    });

    it('registering the same plot twice (the start-up retry) leaves ONE adopt, not a second one the server would refuse', async () => {
        const args = { plot: plot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } };
        await registerNewPlotOnServer(args);
        await registerNewPlotOnServer(args);
        expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle, SyncMutationName.AdoptSchedule]);
        expect(await getDatabase().scheduleSubscriptions.where('plotId').equals(PLOT).count()).toBe(1);
    });

    it('with no area (nothing queued for the plot) the adopt is not queued either', async () => {
        const outcome = await registerNewPlotOnServer({ plot: plot({ baseline: { totalArea: 0, unit: 'Acre' } } as Partial<Plot>), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } });
        expect(outcome).toBe('needs-area');
        expect(await queue()).toEqual([]);
        expect(await getDatabase().scheduleSubscriptions.count()).toBe(0);
    });

    it('with no current farm nothing is queued, and no adopt', async () => {
        SessionStore.clearCurrentFarmId();
        expect(await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } })).toBe('no-farm');
        expect(await queue()).toEqual([]);
    });

    it('after the sweep cleared a refused adopt\'s pending row, the start-up retry still does not ask the server again at every start', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } });
        await getDatabase().scheduleSubscriptions.clear();
        await reconcileUnregisteredPlots();
        expect((await queue()).filter(r => r.mutationType === SyncMutationName.AdoptSchedule)).toHaveLength(1);
    });

    it('if the app stopped after the plot rows but before the adopt, the start-up retry queues the adopt behind them', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } });
        const db = getDatabase();
        const adopt = (await queue()).find(r => r.mutationType === SyncMutationName.AdoptSchedule);
        await db.mutationQueue.delete(adopt!.id as number);
        await db.scheduleSubscriptions.clear();
        await reconcileUnregisteredPlots();
        expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle, SyncMutationName.AdoptSchedule]);
    });

    it('the start-up retry of a still-unconfirmed plot does not queue a second adopt', async () => {
        await registerNewPlotOnServer({ plot: plot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-03-04' } });
        await reconcileUnregisteredPlots();
        expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle, SyncMutationName.AdoptSchedule]);
    });
});
