// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1 Task 7, founder D-24c, D-26, D-79) - the phone's data layer for
 * the task record, through the real `reconcileSyncPull` and the real mutation queue over a fake-indexeddb phone database:
 *   - reconciler: a row the server sent is kept (and replaced by id); a withdrawn id removes it; a full pull is the whole list;
 *     a farm he no longer reads takes its tasks with it; an older server (no key) changes nothing;
 *   - commands: the outbox key is `plannedwork.<verb>:<id>`; accept / cancel re-tap revives a REJECTED_DROPPED row through
 *     `replacePayload`; `seen` is never revived; the latest unsent edit wins;
 *   - store: a queued change is shown as "kept on the phone" until acknowledged; another farm's items are never returned.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import { PlannedWorkCommands } from '../data/plannedWorkCommands';
import { getLocalPlannedWork } from '../data/plannedWorkStore';
import { plannedWorkWords } from '../plannedWorkWords';

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const RAJU = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333331';
const T2 = '33333333-3333-4333-8333-333333333332';
const T3 = '33333333-3333-4333-8333-333333333333';
const PLOT = '44444444-4444-4444-8444-444444444441';

const task = (over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id: T1, farmId: FARM, title: 'द्राक्षाला फवारणी', scope: 'Plot', plannedDate: null, looseWhen: null, plannedTime: null,
    assigneeUserId: RAJU, crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null,
    status: 'Assigned', source: 'Planning', sourceKind: 'PlanForm', recordedOn: '2026-11-08', linkedDailyLogIds: [],
    createdByUserId: ME, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z',
    plots: [{ plotId: PLOT, status: 'Pending', linkedDailyLogIds: [] }],
    ...over,
});

const pull = (over: Partial<SyncPullResponse> = {}): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h',
    ...over,
} as SyncPullResponse);

const scopes = (...farmIds: string[]) => farmIds.map(farmId => ({ farmId, ownRecordsOnly: false, seeMoney: false, seeWages: false }));

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.plannedWork.clear(), db.mutationQueue.clear(), db.appMeta.clear()]);
});

describe('Task 7 - the reconciler keeps what the server sent', () => {
    it('upserts by id: a second row of the same task replaces the first', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task(), task({ id: T2, title: 'दुसरं' })] }));
        expect((await getDatabase().plannedWork.toArray()).map(r => r.id).sort()).toEqual([T1, T2]);

        await reconcileSyncPull(pull({ plannedWork: [task({ status: 'Accepted', acceptedAtUtc: '2026-11-08T08:00:00.000Z', modifiedAtUtc: '2026-11-08T08:00:00.000Z' })] }));
        const row = (await getDatabase().plannedWork.get(T1))!;
        expect(row.status).toBe('Accepted');
        expect(row.acceptedAtUtc).toBe('2026-11-08T08:00:00.000Z');
        expect(row.plots.map(p => p.plotId)).toEqual([PLOT]);
        expect(await getDatabase().plannedWork.count()).toBe(2);
    });

    it('a withdrawn id removes the task; nothing of it remains after the reconciler runs', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task(), task({ id: T2 })] }));

        await reconcileSyncPull(pull({ withdrawnRecords: [{ kind: 'PlannedWork', id: T1 }] }));

        expect((await getDatabase().plannedWork.toArray()).map(r => r.id)).toEqual([T2]);
    });

    it('a withdrawn id the server sent again in the same answer stays (he regained it)', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task()] }));
        await reconcileSyncPull(pull({ plannedWork: [task({ modifiedAtUtc: '2026-11-08T09:00:00.000Z' })], withdrawnRecords: [{ kind: 'PlannedWork', id: T1 }] }));
        expect(await getDatabase().plannedWork.get(T1)).toBeDefined();
    });

    it('a withdrawn kind it does not know is ignored safely; a withdrawn list of other kinds does not touch tasks', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task()] }));
        await reconcileSyncPull(pull({ withdrawnRecords: [{ kind: 'DailyLog', id: T1 }, { kind: 'SomethingNew' as never, id: T1 }] }));
        expect(await getDatabase().plannedWork.get(T1)).toBeDefined();
    });

    it('a full pull is the whole list: a server copy it no longer carries goes, on a farm the answer reads', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task(), task({ id: T2 })], accessScopes: scopes(FARM) as never }));

        await reconcileSyncPull(pull({ plannedWork: [task({ id: T2 })], accessScopes: scopes(FARM) as never }), { fullPull: true });

        expect((await getDatabase().plannedWork.toArray()).map(r => r.id)).toEqual([T2]);
    });

    it('an ordinary pull never removes a task it does not mention', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task(), task({ id: T2 })], accessScopes: scopes(FARM) as never }));
        await reconcileSyncPull(pull({ plannedWork: [task({ id: T2 })], accessScopes: scopes(FARM) as never }));
        expect(await getDatabase().plannedWork.count()).toBe(2);
    });

    it('a farm he no longer reads takes its tasks with it', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task(), task({ id: T3, farmId: OTHER_FARM })], accessScopes: scopes(FARM, OTHER_FARM) as never }));

        // Only on the server's explicit word (Removed), never because a farm is absent from the list.
        await reconcileSyncPull(pull({ accessScopes: scopes(FARM) as never }));
        expect(await getDatabase().plannedWork.count()).toBe(2);
        await reconcileSyncPull(pull({ accessScopes: [...scopes(FARM), { farmId: OTHER_FARM, status: 'Removed', ownRecordsOnly: false, seeMoney: false, seeWages: false }] as never }));

        expect((await getDatabase().plannedWork.toArray()).map(r => r.id)).toEqual([T1]);
    });

    it('an older server (no plannedWork key, no scopes) changes nothing', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task()] }));
        await reconcileSyncPull(pull());
        await reconcileSyncPull(pull(), { fullPull: true });
        expect(await getDatabase().plannedWork.count()).toBe(1);
    });

    it('a row it cannot read is skipped, never thrown into the pull', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task({ status: 'Mystery' }), task({ id: T2, scope: 'Everywhere' }), task({ id: T3 })] }));
        expect((await getDatabase().plannedWork.toArray()).map(r => r.id)).toEqual([T3]);
    });
});

describe('Task 7 - the commands', () => {
    it('the outbox keys are plannedwork.<verb>:<id>', async () => {
        await PlannedWorkCommands.create({ plannedWorkId: T1, farmId: FARM, title: 'काम', scope: 'Plot', plotIds: [PLOT] });
        await PlannedWorkCommands.seen(T1, FARM);
        await PlannedWorkCommands.accept(T1, FARM);
        await PlannedWorkCommands.cancel(T1, FARM, 'पाऊस');
        await PlannedWorkCommands.edit({ plannedWorkId: T1, farmId: FARM, title: 'बदल', scope: 'Farm' });

        const rows = await getDatabase().mutationQueue.toArray();
        expect(rows.map(r => r.clientRequestId).sort()).toEqual([
            `plannedwork.accept:${T1}`, `plannedwork.cancel:${T1}`, `plannedwork.create:${T1}`, `plannedwork.edit:${T1}`, `plannedwork.seen:${T1}`,
        ]);
        expect(rows.map(r => r.mutationType).sort()).toEqual([
            SyncMutationName.PlannedworkAccept, SyncMutationName.PlannedworkCancel, SyncMutationName.PlannedworkCreate,
            SyncMutationName.PlannedworkEdit, SyncMutationName.PlannedworkSeen,
        ].sort());
    });

    it('the same tap twice is one queued change', async () => {
        await PlannedWorkCommands.accept(T1, FARM);
        await PlannedWorkCommands.accept(T1, FARM);
        await PlannedWorkCommands.create({ plannedWorkId: T2, farmId: FARM, title: 'काम', scope: 'Farm' });
        await PlannedWorkCommands.create({ plannedWorkId: T2, farmId: FARM, title: 'काम', scope: 'Farm' });
        expect(await getDatabase().mutationQueue.count()).toBe(2);
    });

    it('accept and cancel re-tap revives a REJECTED_DROPPED row through replacePayload; seen is never revived', async () => {
        await PlannedWorkCommands.accept(T1, FARM);
        await PlannedWorkCommands.cancel(T1, FARM);
        await PlannedWorkCommands.seen(T1, FARM);
        const db = getDatabase();
        for (const row of await db.mutationQueue.toArray()) {
            await db.mutationQueue.update(row.id!, { status: 'REJECTED_DROPPED' });
        }

        await PlannedWorkCommands.accept(T1, FARM);
        await PlannedWorkCommands.cancel(T1, FARM, 'दुसऱ्यांदा');
        await PlannedWorkCommands.seen(T1, FARM);

        const byKey = Object.fromEntries((await db.mutationQueue.toArray()).map(r => [r.clientRequestId, r]));
        expect(byKey[`plannedwork.accept:${T1}`].status).toBe('PENDING');
        expect(byKey[`plannedwork.cancel:${T1}`].status).toBe('PENDING');
        expect(byKey[`plannedwork.cancel:${T1}`].payload).toMatchObject({ reason: 'दुसऱ्यांदा' });
        expect(byKey[`plannedwork.seen:${T1}`].status).toBe('REJECTED_DROPPED');
        expect(await db.mutationQueue.count()).toBe(3);
    });

    it('the latest unsent edit replaces the earlier; an edit already sent is followed by a new one', async () => {
        await PlannedWorkCommands.edit({ plannedWorkId: T1, farmId: FARM, title: 'पहिलं', scope: 'Farm' });
        await PlannedWorkCommands.edit({ plannedWorkId: T1, farmId: FARM, title: 'दुसरं', scope: 'Farm' });
        const db = getDatabase();
        expect(await db.mutationQueue.count()).toBe(1);
        expect((await db.mutationQueue.toArray())[0].payload).toMatchObject({ title: 'दुसरं' });

        await db.mutationQueue.update((await db.mutationQueue.toArray())[0].id!, { status: 'APPLIED' });
        await PlannedWorkCommands.edit({ plannedWorkId: T1, farmId: FARM, title: 'तिसरं', scope: 'Farm' });
        const keys = (await db.mutationQueue.toArray()).map(r => r.clientRequestId).sort();
        expect(keys).toEqual([`plannedwork.edit:${T1}`, `plannedwork.edit:${T1}:2`]);
    });

    it('a payload the wire forbids is refused before it is queued (the headcount is a number of words, not a wage)', async () => {
        await expect(PlannedWorkCommands.create({
            plannedWorkId: T1, farmId: FARM, title: 'काम', scope: 'Farm', crewText: 'मुकादम', expectedHeadcount: 5,
        })).resolves.toBeTruthy(); // crew words are accepted by the wire; the SERVER refuses them without an assignee
        await expect(PlannedWorkCommands.create({
            plannedWorkId: T2, farmId: FARM, title: 'काम', scope: 'Farm', expectedHeadcount: 0,
        })).rejects.toThrow(/Payload validation failed/);
    });
});

describe('Task 7 - the local merged read', () => {
    it('shows a queued create as "kept on the phone" until the server acknowledges it', async () => {
        await PlannedWorkCommands.create({ plannedWorkId: T1, farmId: FARM, title: 'पाणी द्या', scope: 'Farm', assigneeUserId: RAJU });

        const queued = await getLocalPlannedWork(FARM);
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({ id: T1, title: 'पाणी द्या', source: 'queue', keptOnPhone: true, status: 'Assigned', pendingSteps: ['create'] });
        expect(plannedWorkWords('mr').keptOnPhone).toBe('फोनवर ठेवलं');

        // The server answers: the row it sent is the truth, and the request is APPLIED (no longer live intent).
        await reconcileSyncPull(pull({ plannedWork: [task({ title: 'पाणी द्या', scope: 'Farm', plots: [] })] }));
        const db = getDatabase();
        await db.mutationQueue.update((await db.mutationQueue.toArray())[0].id!, { status: 'APPLIED' });
        const acknowledged = await getLocalPlannedWork(FARM);
        expect(acknowledged).toHaveLength(1);
        expect(acknowledged[0]).toMatchObject({ id: T1, source: 'server', keptOnPhone: false, pendingSteps: [] });
    });

    it('a queued answer over a server row keeps the server row and says it is kept on the phone', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task()] }));
        await PlannedWorkCommands.accept(T1, FARM);

        const [item] = await getLocalPlannedWork(FARM);
        expect(item).toMatchObject({ id: T1, source: 'server', keptOnPhone: true, status: 'Accepted', pendingSteps: ['accept'] });
        expect((await getDatabase().plannedWork.get(T1))!.status).toBe('Assigned'); // the server row is untouched
    });

    it('a queued cancel and a queued edit are laid over the row, oldest first', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task()] }));
        await PlannedWorkCommands.edit({ plannedWorkId: T1, farmId: FARM, title: 'नवं नाव', scope: 'Plot', plotIds: [PLOT] });
        await PlannedWorkCommands.cancel(T1, FARM);

        const [item] = await getLocalPlannedWork(FARM);
        expect(item).toMatchObject({ title: 'नवं नाव', status: 'Cancelled', keptOnPhone: true, pendingSteps: ['edit', 'cancel'], assigneeUserId: null });
    });

    it('another farm\'s items are never returned, queued or from the server', async () => {
        await reconcileSyncPull(pull({ plannedWork: [task(), task({ id: T2, farmId: OTHER_FARM })] }));
        await PlannedWorkCommands.create({ plannedWorkId: T3, farmId: OTHER_FARM, title: 'दुसऱ्या शेतात', scope: 'Farm' });

        expect((await getLocalPlannedWork(FARM)).map(i => i.id)).toEqual([T1]);
        expect((await getLocalPlannedWork(OTHER_FARM)).map(i => i.id).sort()).toEqual([T2, T3]);
    });

    it('a parked refusal is not drawn as intent', async () => {
        await PlannedWorkCommands.create({ plannedWorkId: T1, farmId: FARM, title: 'काम', scope: 'Farm' });
        const db = getDatabase();
        await db.mutationQueue.update((await db.mutationQueue.toArray())[0].id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.Forbidden' });
        expect(await getLocalPlannedWork(FARM)).toEqual([]);
    });
});
