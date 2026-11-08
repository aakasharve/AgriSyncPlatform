// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-3 Task 3; founder D-24d, D-30, D-1, P3, P10, P11) - the phone's data
 * layer for "काम झालं", through the real reconciler and the real mutation queue over a fake-indexeddb phone database:
 *   - the pull's `confirmationState` (task and plot) is kept as one of three words, and none when absent or unknown (an older server);
 *   - `complete`: ONE change per saved log (`plannedwork.complete:<id>:<first log id>`), the real payload, a re-tap is the same change,
 *     and a re-tap after he discarded the parked refusal revives that row; a reminder is done with no log (D-1);
 *   - `reopen`: the reason travels, the latest unsent one wins, one already sent is followed by a new one;
 *   - the store lays a queued complete / reopen over the server's row and labels it "फोनवर ठेवलं" (a queued fact is never drawn as saved);
 *   - a parked complete / reopen says its own words.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import { PlannedWorkCommands } from '../data/plannedWorkCommands';
import { getParkedPlannedWork, parkedWords } from '../data/plannedWorkParked';
import { getLocalPlannedWork } from '../data/plannedWorkStore';
import { plannedWorkWords } from '../plannedWorkWords';

const FARM = '55555555-5555-4555-8555-555555555551';
const RAJU = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333331';
const P1 = '44444444-4444-4444-8444-444444444441';
const P2 = '44444444-4444-4444-8444-444444444442';
const LOG1 = '66666666-6666-4666-8666-666666666661';
const LOG2 = '66666666-6666-4666-8666-666666666662';

const task = (over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id: T1, farmId: FARM, title: 'युरिया टाकणे', scope: 'MultiPlot', plannedDate: null, looseWhen: null, plannedTime: null,
    assigneeUserId: RAJU, crewText: null, expectedHeadcount: null, quantityText: '३ पोती', payMode: null, note: null,
    status: 'Accepted', source: 'Planning', sourceKind: 'PlanForm', recordedOn: '2026-11-08', linkedDailyLogIds: [],
    createdByUserId: ME, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z',
    plots: [{ plotId: P1, status: 'Pending', linkedDailyLogIds: [] }, { plotId: P2, status: 'Pending', linkedDailyLogIds: [] }],
    ...over,
});

const pull = (plannedWork: PlannedWorkDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', plannedWork,
} as unknown as SyncPullResponse);

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.plannedWork.clear(), db.mutationQueue.clear(), db.appMeta.clear()]);
});

const queued = async (type: string) => getDatabase().mutationQueue.where('mutationType').equals(type).toArray();

describe('the pull carries the owner\'s word, additive (P11)', () => {
    it('keeps Confirmed / Disputed / Waiting for the task and for each plot, and none when absent or unknown', async () => {
        await reconcileSyncPull(pull([task({
            status: 'Done', confirmationState: 'Waiting',
            plots: [
                { plotId: P1, status: 'Done', linkedDailyLogIds: [LOG1], confirmationState: 'Confirmed' },
                { plotId: P2, status: 'Done', linkedDailyLogIds: [LOG2], confirmationState: 'Disputed' },
            ],
        })]));
        const row = (await getDatabase().plannedWork.get(T1))!;
        expect(row.confirmationState).toBe('Waiting');
        expect(row.plots.map(p => p.confirmationState)).toEqual(['Confirmed', 'Disputed']);
        const local = (await getLocalPlannedWork(FARM))[0];
        expect(local.confirmationState).toBe('Waiting');
        expect(local.plots.map(p => [p.plotId, p.status, p.confirmationState])).toEqual([[P1, 'Done', 'Confirmed'], [P2, 'Done', 'Disputed']]);

        // An older server sends neither; a word this phone does not know is no word.
        await reconcileSyncPull(pull([task({ modifiedAtUtc: '2026-11-08T08:00:00.000Z' })]));
        const old = (await getDatabase().plannedWork.get(T1))!;
        expect(old.confirmationState ?? null).toBeNull();
        expect(old.plots.map(p => p.confirmationState ?? null)).toEqual([null, null]);
        await reconcileSyncPull(pull([task({ modifiedAtUtc: '2026-11-08T09:00:00.000Z', confirmationState: 'Rejected' })]));
        expect((await getDatabase().plannedWork.get(T1))!.confirmationState ?? null).toBeNull();
    });
});

describe('complete - one change per saved log', () => {
    it('queues the real payload under plannedwork.complete:<id>:<first log>, and a re-tap is the same change', async () => {
        const a = await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1, LOG2], somethingLeft: true });
        const b = await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1, LOG2], somethingLeft: true });
        expect(a).toBe(`plannedwork.complete:${T1}:${LOG1}`);
        expect(b).toBe(a);
        const rows = await queued(SyncMutationName.PlannedworkComplete);
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toEqual({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1, LOG2], somethingLeft: true });
        expect(Object.keys(rows[0].payload as object).sort()).toEqual(['dailyLogIds', 'farmId', 'plannedWorkId', 'plotIds', 'somethingLeft']);

        // A second save for the same task is a second change, under its own log.
        const later = await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P2], dailyLogIds: [LOG2], somethingLeft: false });
        expect(later).toBe(`plannedwork.complete:${T1}:${LOG2}`);
        expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(2);
    });

    it('a reminder is done with no log: the key has no log and the list is empty (D-1)', async () => {
        const key = await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [], dailyLogIds: [], somethingLeft: false });
        expect(key).toBe(`plannedwork.complete:${T1}`);
        expect((await queued(SyncMutationName.PlannedworkComplete))[0].payload).toMatchObject({ dailyLogIds: [], somethingLeft: false });
    });

    it('a re-tap after he discarded the parked refusal revives that same row', async () => {
        const key = await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1], somethingLeft: false });
        await getDatabase().mutationQueue.filter(r => r.clientRequestId === key).modify({ status: 'REJECTED_DROPPED' });
        const again = await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1], somethingLeft: false });
        expect(again).toBe(key);
        const rows = await queued(SyncMutationName.PlannedworkComplete);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('PENDING');
    });
});

describe('reopen - the owner\'s reason travels', () => {
    it('queues the trimmed reason; the latest unsent one wins; one already sent is followed by a new one', async () => {
        const first = await PlannedWorkCommands.reopen(T1, FARM, '  काम नीट नाही  ');
        expect(first).toBe(`plannedwork.reopen:${T1}`);
        expect((await queued(SyncMutationName.PlannedworkReopen))[0].payload).toEqual({ plannedWorkId: T1, farmId: FARM, reason: 'काम नीट नाही' });

        await PlannedWorkCommands.reopen(T1, FARM, 'दुसरं कारण');
        const rows = await queued(SyncMutationName.PlannedworkReopen);
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ reason: 'दुसरं कारण' });

        await getDatabase().mutationQueue.filter(r => r.clientRequestId === first).modify({ status: 'APPLIED' });
        const next = await PlannedWorkCommands.reopen(T1, FARM, 'पुन्हा');
        expect(next).toBe(`plannedwork.reopen:${T1}:2`);
        expect(await queued(SyncMutationName.PlannedworkReopen)).toHaveLength(2);
    });
});

describe('the store lays a queued step over the server\'s row, labelled', () => {
    it('a queued complete reads Done on the named plot, the task Done when nothing is left, and says "फोनवर ठेवलं"', async () => {
        await reconcileSyncPull(pull([task()]));

        await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1], somethingLeft: false });
        let item = (await getLocalPlannedWork(FARM))[0];
        expect(item.keptOnPhone).toBe(true);
        expect(item.pendingSteps).toEqual(['complete']);
        expect(item.plots.map(p => [p.plotId, p.status])).toEqual([[P1, 'Done'], [P2, 'Pending']]);
        expect(item.status).toBe('Accepted'); // the other plot is still to do: partly done
        expect(item.confirmationState).toBeNull(); // the owner's word is the server's, never made up here

        await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P2], dailyLogIds: [LOG2], somethingLeft: false });
        item = (await getLocalPlannedWork(FARM))[0];
        expect(item.plots.every(p => p.status === 'Done')).toBe(true);
        expect(item.status).toBe('Done');
        expect(item.pendingSteps).toEqual(['complete', 'complete']);
    });

    it('somethingLeft keeps the task pending on the phone too, and a reopen puts the plots back', async () => {
        await reconcileSyncPull(pull([task({ plots: [{ plotId: P1, status: 'Pending', linkedDailyLogIds: [] }], scope: 'Plot' })]));
        await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1], somethingLeft: true });
        expect((await getLocalPlannedWork(FARM))[0].status).toBe('Accepted');

        await getDatabase().mutationQueue.clear();
        await reconcileSyncPull(pull([task({
            status: 'Done', modifiedAtUtc: '2026-11-08T10:00:00.000Z', confirmationState: 'Confirmed',
            plots: [{ plotId: P1, status: 'Done', linkedDailyLogIds: [LOG1], confirmationState: 'Confirmed' }],
        })]));
        await PlannedWorkCommands.reopen(T1, FARM, 'काम नीट नाही');
        const item = (await getLocalPlannedWork(FARM))[0];
        expect(item.status).toBe('Accepted');
        expect(item.plots.map(p => [p.status, p.confirmationState])).toEqual([['Pending', null]]);
        expect(item.confirmationState).toBeNull();
        expect(item.keptOnPhone).toBe(true);
    });

    it('another farm\'s queued complete is never laid over this farm\'s task', async () => {
        await reconcileSyncPull(pull([task()]));
        await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: '55555555-5555-4555-8555-555555555552', plotIds: [P1], dailyLogIds: [LOG1], somethingLeft: false });
        const item = (await getLocalPlannedWork(FARM))[0];
        expect(item.keptOnPhone).toBe(false);
        expect(item.plots.every(p => p.status === 'Pending')).toBe(true);
    });
});

describe('a parked done step says its own words and never shows as done (P10)', () => {
    it('maps the new refusals; a parked complete leaves the task as the server last said', async () => {
        await reconcileSyncPull(pull([task()]));
        const words = plannedWorkWords('mr');
        const key = await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1], somethingLeft: false });
        await getDatabase().mutationQueue.filter(r => r.clientRequestId === key)
            .modify({ status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.PlannedWorkLog.InvalidCommand' });

        const parked = (await getParkedPlannedWork(FARM)).get(T1)!;
        expect(parked.verb).toBe('complete');
        expect(parkedWords(parked, words)).toBe(words.doneLogRefused);
        const item = (await getLocalPlannedWork(FARM))[0];
        expect(item.plots.every(p => p.status === 'Pending')).toBe(true);
        expect(item.keptOnPhone).toBe(false);

        expect(parkedWords({ verb: 'complete', errorCode: 'ShramSafal.PlannedWorkPlots.InvalidCommand', lastError: null }, words)).toBe(words.donePlotsRefused);
        expect(parkedWords({ verb: 'complete', errorCode: 'ShramSafal.Forbidden', lastError: null }, words)).toBe(words.noLongerYours);
        expect(parkedWords({ verb: 'reopen', errorCode: 'ShramSafal.Forbidden', lastError: null }, words)).toBe(words.reopenOwnerOnly);
        const en = plannedWorkWords('en');
        expect(parkedWords({ verb: 'reopen', errorCode: 'ShramSafal.Forbidden', lastError: null }, en)).toBe(en.reopenOwnerOnly);
    });
});

describe('L002 - a reminder done, reopened and done again sends again', () => {
    const doneAgain = () => PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [], dailyLogIds: [], somethingLeft: false });

    it('the first complete keeps its exact old key; a plain re-tap before anything was sent is the same change', async () => {
        const first = await doneAgain();
        expect(first).toBe(`plannedwork.complete:${T1}`);
        expect(await doneAgain()).toBe(first);
        expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(1);
    });

    it('done -> (sent) -> reopen -> done again queues a NEW outbox row, and the card says "फोनवर ठेवलं"', async () => {
        await reconcileSyncPull(pull([task({ assigneeUserId: null, status: 'Open', scope: 'Farm', plots: [], createdByUserId: ME })]));
        const first = await doneAgain();
        await getDatabase().mutationQueue.filter(r => r.clientRequestId === first).modify({ status: 'APPLIED' });
        // The server then did what he asked: done, and later the owner reopened it (the pull brings the reminder back as open).
        await reconcileSyncPull(pull([task({ assigneeUserId: null, status: 'Open', scope: 'Farm', plots: [], createdByUserId: ME, modifiedAtUtc: '2026-11-08T11:00:00.000Z' })]));

        const second = await doneAgain();
        expect(second).toBe(`plannedwork.complete:${T1}:2`);
        const rows = await queued(SyncMutationName.PlannedworkComplete);
        expect(rows.map(r => r.clientRequestId).sort()).toEqual([first, second].sort());
        expect(rows.find(r => r.clientRequestId === second)!.status).toBe('PENDING');
        const item = (await getLocalPlannedWork(FARM))[0];
        expect(item.keptOnPhone).toBe(true);
        expect(item.pendingSteps).toEqual(['complete']);

        // A third time, while the second is still waiting, is the second (not a third change); once that is sent a fourth is new again.
        expect(await doneAgain()).toBe(second);
        await getDatabase().mutationQueue.filter(r => r.clientRequestId === second).modify({ status: 'APPLIED' });
        expect(await doneAgain()).toBe(`plannedwork.complete:${T1}:3`);
    });

    it('a parked or discarded first complete is not "sent": a re-tap revives it (the old rule) instead of numbering on', async () => {
        const first = await doneAgain();
        await getDatabase().mutationQueue.filter(r => r.clientRequestId === first).modify({ status: 'REJECTED_DROPPED' });
        expect(await doneAgain()).toBe(first);
        expect((await queued(SyncMutationName.PlannedworkComplete))[0].status).toBe('PENDING');
    });

    it('handed-out work (the key carries the first log) is unchanged: a new recording is a new change', async () => {
        const a = await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1], somethingLeft: false });
        await getDatabase().mutationQueue.filter(r => r.clientRequestId === a).modify({ status: 'APPLIED' });
        const b = await PlannedWorkCommands.complete({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG2], somethingLeft: false });
        expect(a).toBe(`plannedwork.complete:${T1}:${LOG1}`);
        expect(b).toBe(`plannedwork.complete:${T1}:${LOG2}`);
    });
});
