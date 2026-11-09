// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 fix round 1, review L001; founder D-78 = 1, P10) - the mirror of a spoken reminder
 * survives until the server's row arrives, on the PRODUCTION path.
 *
 * `rememberLogTasks` (what the four save paths call) mirrors the reminder with no maker on the row. The pull's scope sweep removes a row that
 * the signed-in person did not make when his scope has no `seeAllTasks` - so a pull that started before the server committed the log (the log's
 * create already applied, the server row not in that answer yet) used to take his own spoken reminder away, and it flickered back later.
 * Mechanism (a): the sweep never removes a row marked `mirror`. By definition it is his own spoken reminder; the pull's `bulkPut` of the server's
 * row (same id) replaces it and drops the flag, and a FULL pull still removes a stale mirror once its log is no longer on the phone.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import type { DailyLog } from '../../../types';
import { rememberLogTasks } from '../../../app/helpers/rememberLogTasks';
import { reconcilePlannedWork } from '../../sync/pull/reconcilers/plannedWorkReconciler';
import { getLocalPlannedWork } from '../data/plannedWorkStore';
import { plannedWorkAsTasks } from '../data/plannedWorkAsTasks';
import { spokenTaskId } from '../data/plannedWorkIds';

const FARM = '55555555-5555-4555-8555-555555555551';
const ME = '22222222-2222-4222-8222-222222222222';
const PLOT = '44444444-4444-4444-8444-444444444441';
const LOG = '66666666-6666-4666-8666-666666666661';
const ID = spokenTaskId(LOG, 'x1');

const log = {
    id: LOG, date: '2026-11-08', meta: { createdAtISO: '2026-11-08T05:00:00.000Z', farmId: FARM },
    context: { selection: [{ cropId: 'cane', cropName: 'ऊस', selectedPlotIds: [PLOT], selectedPlotNames: ['ऊस 1'] }] },
    fullTranscript: 'आज फवारणी केली उद्या पाईपलाईन दुरुस्त करायची', cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], observations: [],
    plannedTasks: [{ id: 'x1', title: 'पाईपलाईन दुरुस्त करायची', dueHint: 'उद्या', status: 'pending', sourceType: 'ai_extracted', plotId: PLOT, priority: 'normal', createdAt: '2026-11-08T05:00:00.000Z' }],
} as unknown as DailyLog;

// What the signed-in person's pull says: a real user, NO seeAllTasks (an ordinary worker or a seat without the grant).
const scope = { farmId: FARM, ownRecordsOnly: false, seeMoney: false, seeWages: false, seeAttendance: false, seeTests: false, seeCompliance: false, seeFarmOverview: true, plotScope: 'AllPlots', seeAllTasks: false };
const pull = (plannedWork: PlannedWorkDto[] = []) => ({ plannedWork, accessScopes: [scope] } as unknown as SyncPullResponse);
const run = (payload: SyncPullResponse, fullPull = false) =>
    getDatabase().transaction('rw', [getDatabase().plannedWork, getDatabase().mutationQueue], () =>
        reconcilePlannedWork(getDatabase(), payload, { userId: ME, fullPull }));

const serverRow = (): PlannedWorkDto => ({
    id: ID, farmId: FARM, title: 'पाईपलाईन दुरुस्त करायची', scope: 'Unspecified', plannedDate: '2026-11-09', looseWhen: null, plannedTime: null, assigneeUserId: null,
    crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', source: 'VoiceLog', sourceKind: 'Spoken',
    sourceDailyLogId: LOG, sourcePlotId: PLOT, recordedOn: '2026-11-08', linkedDailyLogIds: [], createdByUserId: ME,
    createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z', plots: [],
} as PlannedWorkDto);

const logCreate = (status: 'PENDING' | 'APPLIED') => getDatabase().mutationQueue.add({
    deviceId: 'd', clientRequestId: `create_daily_log:${LOG}`, mutationType: SyncMutationName.CreateDailyLog, payload: { dailyLogId: LOG, farmId: FARM },
    status, createdAt: '2026-11-08T05:00:00.000Z', retryCount: 0, clientCommandId: `create_daily_log:${LOG}`,
} as never);

/** The production call, as the four save paths make it; the mirror is written in the background, so wait for it. */
async function saveTheLog() {
    rememberLogTasks(false, vi.fn(), [log]);
    for (let i = 0; i < 100 && (await getDatabase().plannedWork.get(ID)) === undefined; i++) await new Promise(r => setTimeout(r, 10));
    expect(await getDatabase().plannedWork.get(ID)).toBeDefined();
}

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.plannedWork.clear(), db.mutationQueue.clear(), db.plots.clear()]);
    await db.plots.put({ id: PLOT, farmId: FARM, payload: { id: PLOT, farmId: FARM, name: 'ऊस 1' }, modifiedAtUtc: 'x' } as never);
});

describe('L001 - the mirror survives a pull that does not carry the server row yet', () => {
    it('(1) the log is applied, the pull (a real user, no seeAllTasks) lacks the row: the reminder is still in the store and on the one list', async () => {
        await saveTheLog();
        await logCreate('APPLIED');

        await run(pull([]));

        expect(await getDatabase().plannedWork.get(ID)).toBeDefined();
        const items = await getLocalPlannedWork(FARM);
        expect(items.map(t => t.id)).toEqual([ID]);
        expect(plannedWorkAsTasks(items, ME).map(t => t.id)).toEqual([ID]);
    });

    it('(2) the next pull CARRIES the server row (same id): exactly one row, and it is the server\'s (no mirror flag)', async () => {
        await saveTheLog();
        await logCreate('APPLIED');
        await run(pull([]));
        expect((await getDatabase().plannedWork.get(ID))?.mirror).toBe(true); // still the mirror after the early pull

        await run(pull([serverRow()]));

        const rows = await getDatabase().plannedWork.toArray();
        expect(rows.map(r => r.id)).toEqual([ID]);
        expect(rows[0].mirror).toBeUndefined();
        expect((await getLocalPlannedWork(FARM))[0].keptOnPhone).toBe(false);
    });

    it('(3) a FULL pull that finds the mirror absent from the server, its log no longer pending, still removes it (the existing rule holds)', async () => {
        await saveTheLog();
        await logCreate('APPLIED');

        await run(pull([]), true);

        expect(await getDatabase().plannedWork.get(ID)).toBeUndefined();
    });

    it('a server row that is NOT a mirror and not his is still removed by the sweep (the scope rule is not weakened)', async () => {
        await getDatabase().plannedWork.put({ ...serverRow(), id: '33333333-3333-4333-8333-333333333399', createdByUserId: '11111111-1111-4111-8111-111111111111' } as never);
        await run(pull([]));
        expect(await getDatabase().plannedWork.count()).toBe(0);
    });
});
