// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2 Tasks 3 and 4; founder D-32, register F09;
 * Review Focus 1 and 2) - the SERVER WINS on download.
 *
 * Through the real `reconcileSyncPull` over a fake-indexeddb phone database:
 *   - the plot's Active server subscription becomes the schedule the plot follows;
 *   - a full re-pull (`since=0`) whose crop-type default differs from his choice keeps his choice (it used to be put back to
 *     the default: `profileAndCropsReconciler`);
 *   - a crop-level `activeScheduleId` never hides a plot's own server choice;
 *   - two phones offline: the second phone's refused choice is dropped for the server's, never both, never a silent overwrite.
 */
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The runtime schedule catalog is set from the fixtures below and must not be reset by an empty reference-data pull.
vi.mock('../../../../../infrastructure/reference/TemplateCatalog', async importOriginal => ({
    ...(await importOriginal<object>()),
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));

import { reconcileSyncPull } from '../../SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../../../infrastructure/sync/MutationQueue';
import * as TemplateCatalog from '../../../../../infrastructure/reference/TemplateCatalog';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { ScheduleSubscriptionDto } from '../../../../../infrastructure/api/dtos';
import { DexieCropsRepository } from '../../../../../infrastructure/storage/DexieCropsRepository';
import { resolvePlotSchedule } from '../../../../scheduler/schedulePage/resolveSchedule';
import { choiceOf, readPlotChoices } from '../../../../scheduler/schedulePage/scheduleSubscriptions';
import { SERVER_TEMPLATE, SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, TEMPLATE_ID } from '../../../../scheduler/schedulePage/__tests__/scheduleFixtures';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';

const FARM = 'farm-1';
const TODAY = '2026-10-26';

const pull = (over: Partial<SyncPullResponse> = {}): SyncPullResponse => ({
    serverTimeUtc: '2026-10-26T06:00:00.000Z',
    nextCursorUtc: '2026-10-26T06:00:00.000Z',
    farms: [{ id: FARM, name: 'Test Farm', ownerUserId: 'user-1', createdAtUtc: '2026-04-01T00:00:00.000Z', modifiedAtUtc: '2026-05-01T00:00:00.000Z' }],
    plots: [{ id: 'plot-1', farmId: FARM, name: 'North', areaInAcres: 2.5, createdAtUtc: '2026-04-01T00:00:00.000Z', modifiedAtUtc: '2026-05-01T00:00:00.000Z' }],
    cropCycles: [{
        id: 'cycle-1', farmId: FARM, plotId: 'plot-1', cropName: 'Grapes', stage: 'x', startDate: '2026-10-17',
        createdAtUtc: '2026-03-01T00:00:00.000Z', modifiedAtUtc: '2026-05-01T00:00:00.000Z',
    }],
    dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [],
    auditEvents: [], operators: [{ userId: 'user-1', displayName: 'Ramu', role: 'PRIMARY_OWNER' }],
    scheduleTemplates: [], activityCategories: [], costCategories: [], referenceDataVersionHash: 'h',
    // The crop-type default of the library: the grape schedule that is NOT the farmer's choice below.
    cropTypes: [{ name: 'Grapes', stages: [], defaultTemplateId: TEMPLATE_ID }],
    ...over,
} as SyncPullResponse);

const sub = (over: Partial<ScheduleSubscriptionDto> = {}): ScheduleSubscriptionDto => ({
    id: 'sub-1', farmId: FARM, plotId: 'plot-1', cropCycleId: 'cycle-1', cropKey: 'grapes', scheduleTemplateId: SPRAY_TEMPLATE_ID,
    scheduleVersionTag: 'v', adoptedAtUtc: '2026-10-20T00:00:00Z', state: 'Active', referenceDate: '2026-10-19', ...over,
});

async function plotAfterPull() {
    const crops = await new DexieCropsRepository().getAll();
    const crop = crops[0];
    return { crop, plot: crop.plots[0] };
}

beforeAll(async () => {
    const actual = await vi.importActual<typeof import('../../../../../infrastructure/reference/TemplateCatalog')>('../../../../../infrastructure/reference/TemplateCatalog');
    actual.setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]);
    expect(TemplateCatalog).toBeDefined();
});
beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.crops.clear(), db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.appMeta.clear(), db.plots.clear(), db.cropCycles.clear(), db.farms.clear()]);
});

describe('Task 3 - the server wins on download', () => {
    it('the active subscription becomes the plot\'s schedule, with its day 0', async () => {
        await reconcileSyncPull(pull({ scheduleSubscriptions: [sub()] }));

        const kept = await getDatabase().scheduleSubscriptions.toArray();
        expect(kept).toEqual([expect.objectContaining({ id: 'sub-1', plotId: 'plot-1', templateId: SPRAY_TEMPLATE_ID, referenceDate: '2026-10-19', state: 'Active' })]);
        expect(kept[0].pending).toBeUndefined();
        const { crop, plot } = await plotAfterPull();
        expect(plot.schedule).toMatchObject({ templateId: SPRAY_TEMPLATE_ID, referenceDate: '2026-10-19' });
        expect(crop.activeScheduleId).toBe(SPRAY_TEMPLATE_ID); // every plot of the crop follows it, so the crop says so too
        const choice = choiceOf((await readPlotChoices()).get('plot-1')!);
        const shown = resolvePlotSchedule(crop, plot, TODAY, choice)!;
        expect([shown.template.id, shown.instance.referenceDate, shown.source]).toEqual([SPRAY_TEMPLATE_ID, '2026-10-19', 'adopted']);
    });

    it('a full re-pull (since=0) with a crop-type default different from his choice keeps his choice', async () => {
        await reconcileSyncPull(pull({ scheduleSubscriptions: [sub()] }));
        // The next pull is from the beginning: the plot's season is sent again, the library's default is TEMPLATE_ID, and the
        // subscription is NOT in this body (it did not change): the phone's own copy of it must still decide.
        await reconcileSyncPull(pull(), { fullPull: true });

        const { crop, plot } = await plotAfterPull();
        expect(crop.activeScheduleId).toBe(SPRAY_TEMPLATE_ID);
        expect(plot.schedule.templateId).toBe(SPRAY_TEMPLATE_ID);
        expect(plot.schedule.referenceDate).toBe('2026-10-19');
        const shown = resolvePlotSchedule(crop, plot, TODAY, choiceOf((await readPlotChoices()).get('plot-1')!))!;
        expect(shown.template.id).toBe(SPRAY_TEMPLATE_ID);
    });

    it('a plot with NO choice still gets the crop-type default (the default is kept for it)', async () => {
        await reconcileSyncPull(pull());
        const { crop, plot } = await plotAfterPull();
        expect(crop.activeScheduleId).toBe(TEMPLATE_ID);
        expect(plot.schedule.templateId).toBe(TEMPLATE_ID);
        expect(resolvePlotSchedule(crop, plot, TODAY)!.source).toBe('adopted'); // the download writes the default into the crop field
    });

    it('a crop-level activeScheduleId never hides a plot\'s own server choice', async () => {
        await reconcileSyncPull(pull({
            plots: [
                { id: 'plot-1', farmId: FARM, name: 'North', areaInAcres: 2.5, createdAtUtc: '2026-04-01T00:00:00.000Z', modifiedAtUtc: '2026-05-01T00:00:00.000Z' },
                { id: 'plot-2', farmId: FARM, name: 'South', areaInAcres: 1, createdAtUtc: '2026-04-01T00:00:00.000Z', modifiedAtUtc: '2026-05-01T00:00:00.000Z' },
            ],
            cropCycles: [
                { id: 'cycle-1', farmId: FARM, plotId: 'plot-1', cropName: 'Grapes', stage: 'x', startDate: '2026-10-17', createdAtUtc: '2026-03-01T00:00:00.000Z', modifiedAtUtc: '2026-05-01T00:00:00.000Z' },
                { id: 'cycle-2', farmId: FARM, plotId: 'plot-2', cropName: 'Grapes', stage: 'x', startDate: '2026-10-17', createdAtUtc: '2026-03-01T00:00:00.000Z', modifiedAtUtc: '2026-05-01T00:00:00.000Z' },
            ],
            // Only plot 1 chose (the editor is for one plot): plot 2 has none, so the crop's field stays the library default.
            scheduleSubscriptions: [sub()],
        }));

        const crops = await new DexieCropsRepository().getAll();
        const crop = crops[0];
        expect(crop.activeScheduleId).toBe(TEMPLATE_ID);
        const choices = await readPlotChoices();
        const one = crop.plots.find(p => p.id === 'plot-1')!;
        const two = crop.plots.find(p => p.id === 'plot-2')!;
        expect(resolvePlotSchedule(crop, one, TODAY, choices.has('plot-1') ? choiceOf(choices.get('plot-1')!) : null)!.template.id).toBe(SPRAY_TEMPLATE_ID);
        expect(resolvePlotSchedule(crop, two, TODAY, null)!.template.id).toBe(TEMPLATE_ID);
        // Without the subscription row, even the stored plot mark keeps the choice over the crop's field.
        expect(resolvePlotSchedule(crop, one, TODAY)!.template.id).toBe(SPRAY_TEMPLATE_ID);
    });

    it('an older server that sends no key changes nothing', async () => {
        await reconcileSyncPull(pull({ scheduleSubscriptions: [sub()] }));
        const body = pull();
        delete (body as { scheduleSubscriptions?: unknown }).scheduleSubscriptions;
        await reconcileSyncPull(body);
        expect(await getDatabase().scheduleSubscriptions.count()).toBe(1);
        expect((await plotAfterPull()).plot.schedule.templateId).toBe(SPRAY_TEMPLATE_ID);
    });
});

describe('Task 4 - two phones, offline: both end on the server\'s choice', () => {
    const phoneOwnChoice = async (waiting: 'PENDING' | 'REJECTED_USER_REVIEW') => {
        const db = getDatabase();
        // The second phone chose TEMPLATE_ID for the plot while offline: its pending row and its queued adopt.
        await db.scheduleSubscriptions.put({
            id: 'mine-1', farmId: FARM, plotId: 'plot-1', cropCycleId: 'cycle-1', templateId: TEMPLATE_ID,
            referenceDate: null, state: 'Active', adoptedAtUtc: '2026-10-21T00:00:00Z', pending: true,
        });
        await db.mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(), clientRequestId: 'adopt_schedule:mine-1', clientCommandId: 'adopt_schedule:mine-1',
            mutationType: SyncMutationName.AdoptSchedule, payload: {}, status: waiting, createdAt: 'x', updatedAt: 'x', retryCount: 0,
            ...(waiting === 'REJECTED_USER_REVIEW' ? { errorCode: 'ShramSafal.ScheduleAlreadyAdopted', lastError: 'An active schedule subscription already exists' } : {}),
        });
    };

    it('the refused (parked) second choice is dropped when the server\'s row arrives: the server\'s choice shows', async () => {
        await reconcileSyncPull(pull()); // the plot is on the phone
        await phoneOwnChoice('REJECTED_USER_REVIEW');
        await reconcileSyncPull(pull({ scheduleSubscriptions: [sub({ id: 'theirs-1', scheduleTemplateId: SPRAY_TEMPLATE_ID })] }));

        const rows = await getDatabase().scheduleSubscriptions.toArray();
        expect(rows.map(r => r.id)).toEqual(['theirs-1']); // the phone's own pending row is gone, never kept beside it
        const { crop, plot } = await plotAfterPull();
        const shown = resolvePlotSchedule(crop, plot, TODAY, choiceOf((await readPlotChoices()).get('plot-1')!))!;
        expect(shown.template.id).toBe(SPRAY_TEMPLATE_ID);
        // The refused request is NOT deleted: it stays parked for him to see (the conflict page), with its words.
        const parked = await getDatabase().mutationQueue.toArray();
        expect(parked.map(m => [m.clientRequestId, m.status])).toEqual([['adopt_schedule:mine-1', 'REJECTED_USER_REVIEW']]);
    });

    it('a refusal that arrives AFTER the server\'s row was already pulled is swept on the next pull', async () => {
        await reconcileSyncPull(pull({ scheduleSubscriptions: [sub({ id: 'theirs-1' })] }));
        await phoneOwnChoice('PENDING'); // his request is still on its way: the choice stays visible (P10)
        await reconcileSyncPull(pull());
        expect((await readPlotChoices()).get('plot-1')?.id).toBe('mine-1');

        // The server then answers ScheduleAlreadyAdopted: the request is parked. The next pull carries no subscription at all.
        await getDatabase().mutationQueue.where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), 'adopt_schedule:mine-1'])
            .modify({ status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.ScheduleAlreadyAdopted' });
        await reconcileSyncPull(pull());
        expect((await readPlotChoices()).get('plot-1')?.id).toBe('theirs-1');
    });

    it('a refusal with NO server choice (no authority) keeps the phone\'s choice visible', async () => {
        await reconcileSyncPull(pull());
        await phoneOwnChoice('REJECTED_USER_REVIEW');
        await reconcileSyncPull(pull());
        expect((await readPlotChoices()).get('plot-1')?.id).toBe('mine-1');
    });

    it('the accepted request comes back under the same id and replaces the pending row', async () => {
        await reconcileSyncPull(pull());
        await phoneOwnChoice('PENDING');
        await reconcileSyncPull(pull({ scheduleSubscriptions: [sub({ id: 'mine-1', scheduleTemplateId: TEMPLATE_ID })] }));
        const rows = await getDatabase().scheduleSubscriptions.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].pending).toBeUndefined();
    });
});
