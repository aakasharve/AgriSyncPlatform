// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1 fix round 1, review L001 and L002; founder D-26, D-79).
 *
 * L001 - the phone keeps only what the server's CURRENT scope lets this person read (the MU-3 / MU-4 precedent). The pull's
 * `accessScopes` entry carries `seeAllTasks` (computed with the clock, so an expired grant arrives as false); the phone mirrors
 * `PlannedWorkVisibility.VisiblePlots` for REMOVAL only, one case per row of PlannedWorkVisibilityTests.cs.
 * L002 - queued steps with the SAME createdAt lay over in the outbox's own order.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { PlannedWorkRow } from '../../../infrastructure/storage/plannedWorkRow';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import { reconcilePlannedWork } from '../../sync/pull/reconcilers/plannedWorkReconciler';
import { getLocalPlannedWork } from '../data/plannedWorkStore';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const ME = '22222222-2222-4222-8222-222222222222';
const RAJU = '11111111-1111-4111-8111-111111111111';
const PLOT_A = '44444444-4444-4444-8444-444444444441';
const PLOT_B = '44444444-4444-4444-8444-444444444442';
const T = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;

const row = (over: Partial<PlannedWorkRow> & { id: string }): PlannedWorkRow => ({
    farmId: FARM, title: 'काम', scope: 'Plot', plannedDate: null, looseWhen: null, plannedTime: null, assigneeUserId: null,
    crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', source: 'Planning',
    sourceKind: 'PlanForm', sourceDailyLogId: null, sourceLogTaskId: null, sourcePlotId: null, recordedOn: '2026-11-08',
    linkedDailyLogIds: [], createdByUserId: RAJU, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z',
    seenAtUtc: null, acceptedAtUtc: null, doneAtUtc: null, doneByUserId: null, cancelledAtUtc: null, cancelledByUserId: null,
    cancelReason: null, plots: [{ plotId: PLOT_A, status: 'Pending', doneAtUtc: null, doneByUserId: null, linkedDailyLogIds: [] }],
    ...over,
});

const scope = (over: Record<string, unknown> = {}) => ({
    farmId: FARM, ownRecordsOnly: false, seeMoney: false, seeWages: false, seeAttendance: false, seeTests: false,
    seeCompliance: false, seeFarmOverview: true, plotScope: 'AllPlots', seeAllTasks: false, ...over,
});

const pull = (...scopes: unknown[]) => ({ accessScopes: scopes } as unknown as SyncPullResponse);

async function hold(...rows: PlannedWorkRow[]) {
    await getDatabase().plannedWork.bulkPut(rows);
}
const ids = async () => (await getDatabase().plannedWork.toArray()).map(r => r.id).sort();
const run = (payload: SyncPullResponse, userId: string | null = ME, pendingIds?: Set<string>) =>
    getDatabase().transaction('rw', [getDatabase().plannedWork, getDatabase().mutationQueue], () =>
        reconcilePlannedWork(getDatabase(), payload, { userId, pendingPlannedWorkIds: pendingIds }));

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.plannedWork.clear(), db.mutationQueue.clear()]);
});

describe('L001 - the phone keeps only what the current scope lets him read', () => {
    it('lost SeeAllTasks: others\' tasks go, his own and the ones given to him stay', async () => {
        await hold(
            row({ id: T(1), createdByUserId: ME }),
            row({ id: T(2), createdByUserId: RAJU, assigneeUserId: ME, status: 'Assigned' }),
            row({ id: T(3), createdByUserId: RAJU, assigneeUserId: RAJU, status: 'Assigned' }),
        );
        await run(pull(scope({ seeAllTasks: false })));
        expect(await ids()).toEqual([T(1), T(2)]);
    });

    it('still holds SeeAllTasks on every plot: nothing is removed', async () => {
        await hold(row({ id: T(1) }), row({ id: T(2), scope: 'Farm', plots: [] }));
        await run(pull(scope({ seeAllTasks: true })));
        expect(await ids()).toEqual([T(1), T(2)]);
    });

    it('an expired grant arrives as seeAllTasks false and removes the same way', async () => {
        await hold(row({ id: T(1), createdByUserId: RAJU }));
        await run(pull(scope({ seeAllTasks: false })));
        expect(await ids()).toEqual([]);
    });

    it('chosen plots narrowed: plot rows are trimmed, and a task with none left is dropped', async () => {
        await hold(
            row({ id: T(1), scope: 'MultiPlot', plots: [PLOT_A, PLOT_B].map(plotId => ({ plotId, status: 'Pending' as const, doneAtUtc: null, doneByUserId: null, linkedDailyLogIds: [] })) }),
            row({ id: T(2), plots: [{ plotId: PLOT_A, status: 'Pending', doneAtUtc: null, doneByUserId: null, linkedDailyLogIds: [] }] }),
        );
        await run(pull(scope({ seeAllTasks: true, plotScope: 'ChosenPlots', plotIds: [PLOT_B] })));
        const left = await getDatabase().plannedWork.toArray();
        expect(left.map(r => r.id)).toEqual([T(1)]);
        expect(left[0].plots.map(p => p.plotId)).toEqual([PLOT_B]);
    });

    it('a Farm / Unspecified task on a chosen-plots SeeAllTasks seat goes unless he made it or has it', async () => {
        await hold(
            row({ id: T(1), scope: 'Farm', plots: [] }),
            row({ id: T(2), scope: 'Unspecified', plots: [], createdByUserId: ME }),
            row({ id: T(3), scope: 'Farm', plots: [], assigneeUserId: ME, status: 'Assigned' }),
        );
        await run(pull(scope({ seeAllTasks: true, plotScope: 'ChosenPlots', plotIds: [PLOT_A] })));
        expect(await ids()).toEqual([T(2), T(3)]);
    });

    it('an assignee on chosen plots keeps his plots\' rows and loses a task not on his plots', async () => {
        await hold(
            row({ id: T(1), assigneeUserId: ME, status: 'Assigned', plots: [{ plotId: PLOT_B, status: 'Pending', doneAtUtc: null, doneByUserId: null, linkedDailyLogIds: [] }] }),
            row({ id: T(2), assigneeUserId: ME, status: 'Assigned' }),
        );
        await run(pull(scope({ seeAllTasks: false, plotScope: 'ChosenPlots', plotIds: [PLOT_A] })));
        expect(await ids()).toEqual([T(2)]);
    });

    it('a row with a queued change is kept (P10)', async () => {
        await hold(row({ id: T(1), createdByUserId: RAJU }), row({ id: T(2), createdByUserId: RAJU }));
        await run(pull(scope({ seeAllTasks: false })), ME, new Set([T(1)]));
        expect(await ids()).toEqual([T(1)]);
    });

    it('a row with a live mutation in the outbox is found by the orchestrator\'s own lookup', async () => {
        await hold(row({ id: T(1), createdByUserId: RAJU }));
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'plannedwork.accept:x', clientCommandId: 'x', mutationType: SyncMutationName.PlannedworkAccept,
            payload: { plannedWorkId: T(1), farmId: FARM }, status: 'PENDING', retryCount: 0, createdAt: '2026-11-08T06:00:00.000Z', updatedAt: '2026-11-08T06:00:00.000Z',
        } as never);
        const { readPendingPlannedWorkIds } = await import('../../sync/pull/reconcilers/plannedWorkReconciler');
        expect(await readPendingPlannedWorkIds(getDatabase())).toEqual(new Set([T(1)]));
    });

    it('the field absent (an older server): nothing is removed', async () => {
        await hold(row({ id: T(1), createdByUserId: RAJU }));
        const old = { ...scope() } as Record<string, unknown>;
        delete old.seeAllTasks;
        await run(pull(old));
        expect(await ids()).toEqual([T(1)]);
    });

    it('an unknown signed-in person: nothing is removed', async () => {
        await hold(row({ id: T(1), createdByUserId: RAJU }));
        await run(pull(scope({ seeAllTasks: false })), null);
        expect(await ids()).toEqual([T(1)]);
    });

    it('another farm is untouched, and a farm the pull does not mention is untouched', async () => {
        await hold(row({ id: T(1), createdByUserId: RAJU }), row({ id: T(2), farmId: OTHER_FARM, createdByUserId: RAJU }));
        await run(pull(scope({ seeAllTasks: false })));
        expect(await ids()).toEqual([T(2)]);
    });
});

describe('L002 - steps queued in the same millisecond lay over in the outbox\'s own order', () => {
    it('an edit queued before a cancel with the same createdAt ends Cancelled', async () => {
        const FARM_ID = FARM;
        await hold(row({ id: T(1), farmId: FARM_ID, assigneeUserId: RAJU, status: 'Assigned' }));
        const at = '2026-11-08T07:00:00.000Z';
        const base = { deviceId: 'd', status: 'PENDING', retryCount: 0, createdAt: at, updatedAt: at };
        // Inserted edit first, cancel second; alphabetically (the index order) cancel comes BEFORE edit.
        await getDatabase().mutationQueue.add({ ...base, clientRequestId: 'plannedwork.edit:1', clientCommandId: '1', mutationType: SyncMutationName.PlannedworkEdit,
            payload: { plannedWorkId: T(1), farmId: FARM_ID, title: 'नवं', scope: 'Plot', plotIds: [PLOT_A] } } as never);
        await getDatabase().mutationQueue.add({ ...base, clientRequestId: 'plannedwork.cancel:1', clientCommandId: '2', mutationType: SyncMutationName.PlannedworkCancel,
            payload: { plannedWorkId: T(1), farmId: FARM_ID } } as never);

        const [item] = await getLocalPlannedWork(FARM_ID);
        expect(item.pendingSteps).toEqual(['edit', 'cancel']);
        expect(item.status).toBe('Cancelled');
    });
});
