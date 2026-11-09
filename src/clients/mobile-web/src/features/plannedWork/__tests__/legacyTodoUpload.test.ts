// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Task 4; founder D-1, D-29, D-31, P10) - the ONE-TIME UPLOAD of the old local to-dos,
 * through the real mutation queue, the real store and the real pull reconciler over a fake-indexeddb phone database:
 *   - an open old to-do is queued as his own reminder under an id derived from the OLD id; run twice is ONE create per old to-do;
 *   - done and cancelled old to-dos are not uploaded; a to-do for the whole farm is scope Farm; a plot of this farm is that plot, a plot of
 *     another farm is "not fixed";
 *   - the old copy stays until the server ACKNOWLEDGES each item (the pull brings the server's row), then that item leaves it - and only it;
 *   - a refused upload stays visible on this phone with its words (the parked create), nothing is deleted;
 *   - concurrent runs queue one create each, and a run for a farm whose upload finished does nothing.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import { getLocalPlannedWork } from '../data/plannedWorkStore';
import { legacyTodoTaskId } from '../data/plannedWorkIds';
import { LEGACY_TODOS_KEY, legacyUploadIsDone, uploadLegacyTodos } from '../data/legacyTodoUpload';

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const ME = '22222222-2222-4222-8222-222222222222';
const PLOT = '44444444-4444-4444-8444-444444444441';
const FOREIGN_PLOT = '44444444-4444-4444-8444-444444444499';

const old = (id: string, over: Record<string, unknown> = {}) => ({
    id, title: `काम ${id}`, plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL', priority: 'normal', status: 'pending', sourceType: 'manual', createdAt: '2026-10-01T05:00:00.000Z', ...over,
});

const seedOld = async (todos: unknown[]) => {
    await getDatabase().appMeta.put({ key: LEGACY_TODOS_KEY, value: todos, updatedAt: 'x' });
};
const oldLeft = async (): Promise<string[]> => ((await getDatabase().appMeta.get(LEGACY_TODOS_KEY))?.value as Array<{ id: string }> ?? []).map(t => t.id);
const creates = async () => (await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.PlannedworkCreate).toArray());

const pull = (over: Partial<SyncPullResponse> = {}): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', ...over,
} as SyncPullResponse);

const serverRowFor = (oldId: string): PlannedWorkDto => ({
    id: legacyTodoTaskId(oldId), farmId: FARM, title: `काम ${oldId}`, scope: 'Farm', plannedDate: null, looseWhen: null, plannedTime: null, assigneeUserId: null,
    crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', source: 'Planning', sourceKind: 'Typed',
    recordedOn: '2026-11-08', linkedDailyLogIds: [], createdByUserId: ME, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z', plots: [],
} as PlannedWorkDto);

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.plannedWork.clear(), db.mutationQueue.clear(), db.appMeta.clear(), db.plots.clear()]);
    await db.plots.put({ id: PLOT, farmId: FARM, payload: { id: PLOT, farmId: FARM, name: 'ऊस 1' }, modifiedAtUtc: 'x' } as never);
    await db.plots.put({ id: FOREIGN_PLOT, farmId: OTHER_FARM, payload: { id: FOREIGN_PLOT, farmId: OTHER_FARM, name: 'दुसऱ्याचा' }, modifiedAtUtc: 'x' } as never);
});

describe('the one-time upload of the old local to-dos', () => {
    it('queues each OPEN old to-do once, as his own typed reminder, with an id derived from the old one', async () => {
        await seedOld([old('a'), old('b', { dueDate: '2026-11-12' })]);

        const result = await uploadLegacyTodos({ farmId: FARM });

        expect(result).toMatchObject({ queued: 2, acknowledged: 0, waiting: 2 });
        const queued = await creates();
        expect(queued.map(q => q.clientRequestId).sort()).toEqual([legacyTodoTaskId('a'), legacyTodoTaskId('b')].map(id => `plannedwork.create:${id}`).sort());
        const b = queued.find(q => (q.payload as { plannedWorkId: string }).plannedWorkId === legacyTodoTaskId('b'))!.payload as Record<string, unknown>;
        expect(b).toMatchObject({ farmId: FARM, title: 'काम b', plannedDate: '2026-11-12', sourceKind: 'Typed', scope: 'Farm' });
        expect(b.assigneeUserId).toBeUndefined();
        expect(b.recordedOn).toBeUndefined(); // the server's own day: an old to-do may be weeks old
        expect(await oldLeft()).toEqual(['a', 'b']); // the old copy stays until the server acknowledges
    });

    it('run twice is ONE create per old to-do', async () => {
        await seedOld([old('a'), old('b')]);
        await uploadLegacyTodos({ farmId: FARM });
        const again = await uploadLegacyTodos({ farmId: FARM });

        expect(again.queued).toBe(0);
        expect(await creates()).toHaveLength(2);
    });

    it('two runs at the same time queue one create each', async () => {
        await seedOld([old('a'), old('b'), old('c')]);
        await Promise.all([uploadLegacyTodos({ farmId: FARM }), uploadLegacyTodos({ farmId: FARM }), uploadLegacyTodos({ farmId: FARM })]);
        expect(await creates()).toHaveLength(3);
    });

    it('done and cancelled to-dos (and schedule work) are NOT uploaded', async () => {
        await seedOld([old('open'), old('done', { status: 'done' }), old('cancelled', { status: 'cancelled' }), old('sched', { sourceType: 'schedule' })]);
        await uploadLegacyTodos({ farmId: FARM });

        expect((await creates()).map(q => (q.payload as { plannedWorkId: string }).plannedWorkId)).toEqual([legacyTodoTaskId('open')]);
        expect(await oldLeft()).toEqual(['open', 'done', 'cancelled', 'sched']); // nothing is deleted
    });

    it('a whole-farm to-do is scope Farm; a plot of this farm is that plot; a plot of another farm (or unknown) is "not fixed"', async () => {
        await seedOld([
            old('farm'), old('mine', { plotId: PLOT, cropId: 'cane' }), old('theirs', { plotId: FOREIGN_PLOT }), old('unknown', { plotId: 'unknown_plot' }),
        ]);
        await uploadLegacyTodos({ farmId: FARM });

        const by = Object.fromEntries((await creates()).map(q => [(q.payload as { title: string }).title, q.payload as Record<string, unknown>]));
        expect(by['काम farm']).toMatchObject({ scope: 'Farm', plotIds: [] });
        expect(by['काम mine']).toMatchObject({ scope: 'Plot', plotIds: [PLOT] });
        expect(by['काम theirs']).toMatchObject({ scope: 'Unspecified' });
        expect(by['काम unknown']).toMatchObject({ scope: 'Unspecified' });
    });

    it('the old copy leaves item by item as the server acknowledges each - and only that item', async () => {
        await seedOld([old('a'), old('b'), old('done', { status: 'done' })]);
        await uploadLegacyTodos({ farmId: FARM });

        // the pull brings the server's row for "a" only
        await reconcileSyncPull(pull({ plannedWork: [serverRowFor('a')], accessScopes: [{ farmId: FARM, ownRecordsOnly: false, seeMoney: false, seeWages: false }] as never }));
        const result = await uploadLegacyTodos({ farmId: FARM });

        expect(result).toMatchObject({ acknowledged: 1, waiting: 1, queued: 0 });
        expect(await oldLeft()).toEqual(['b', 'done']);
        expect(await legacyUploadIsDone(FARM)).toBe(false);
    });

    it('once every open old to-do is acknowledged the farm is done and a later run does nothing', async () => {
        await seedOld([old('a'), old('done', { status: 'done' })]);
        await uploadLegacyTodos({ farmId: FARM });
        await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.PlannedworkCreate).modify({ status: 'APPLIED' });

        const result = await uploadLegacyTodos({ farmId: FARM });
        expect(result).toMatchObject({ acknowledged: 1, waiting: 0 });
        expect(await legacyUploadIsDone(FARM)).toBe(true);
        expect(await oldLeft()).toEqual(['done']);

        expect((await uploadLegacyTodos({ farmId: FARM })).queued).toBe(0);
    });

    it('a refused upload stays visible on this phone with its words; the old to-do is kept; nothing is deleted; it is not queued again', async () => {
        await seedOld([old('a')]);
        await uploadLegacyTodos({ farmId: FARM });
        await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.PlannedworkCreate)
            .modify({ status: 'REJECTED_USER_REVIEW', lastError: 'ShramSafal.PlannedWorkInvalid' });

        const again = await uploadLegacyTodos({ farmId: FARM });

        expect(again).toMatchObject({ queued: 0, waiting: 1 });
        expect(await oldLeft()).toEqual(['a']);
        expect(await creates()).toHaveLength(1);
        const [shown] = await getLocalPlannedWork(FARM);
        expect(shown).toMatchObject({ id: legacyTodoTaskId('a'), title: 'काम a', refused: true });
        expect(await legacyUploadIsDone(FARM)).toBe(false);
    });

    it('an empty or missing old list is done at once and queues nothing', async () => {
        expect(await uploadLegacyTodos({ farmId: FARM })).toEqual({ queued: 0, acknowledged: 0, waiting: 0 });
        expect(await legacyUploadIsDone(FARM)).toBe(true);
        expect(await creates()).toHaveLength(0);
    });
});
