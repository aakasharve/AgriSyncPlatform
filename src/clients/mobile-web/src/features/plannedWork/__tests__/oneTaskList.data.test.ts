// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Tasks 2-3; founder D-1, D-29, D-31, D-78 = 1, P3, P10) - the ONE list, through the
 * real `reconcileSyncPull`, the real mutation queue and the real store over a fake-indexeddb phone database:
 *   - the mirror: a log saved with a planned item shows that reminder AT ONCE, in the store, under the id the server will give it
 *     (`spokenTaskId`), as "फोनवर ठेवलं"; writing it again changes nothing; the pull's row (same id) REPLACES it - never two;
 *   - a full pull does not take a mirror away while its log is still on the phone (P10), and takes it away when the log was applied and the
 *     server made none;
 *   - the same task is on every list once (the adapter), another farm's tasks never are, a refused create is not work;
 *   - undated and loose work is never late (no due date reaches any list), a dated one past its day is.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import type { DailyLog } from '../../../types';
import { getLocalPlannedWork } from '../data/plannedWorkStore';
import { mirrorSpokenReminders } from '../data/spokenMirror';
import { spokenTaskId } from '../data/plannedWorkIds';
import { isOnMyList, plannedWorkAsTasks } from '../data/plannedWorkAsTasks';
import { buildTodoList, tickableIds } from '../../reflect/overview/todoModel';
import { PlannedWorkCommands } from '../data/plannedWorkCommands';

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const ME = '22222222-2222-4222-8222-222222222222';
const OWNER = '11111111-1111-4111-8111-111111111111';
const PLOT = '44444444-4444-4444-8444-444444444441';
const LOG = '66666666-6666-4666-8666-666666666661';
const DAY = '2026-11-08';

const logWith = (plannedTasks: unknown[], over: Partial<DailyLog> = {}): DailyLog => ({
    id: LOG,
    date: DAY,
    context: { selection: [{ cropId: 'cane', cropName: 'ऊस', selectedPlotIds: [PLOT], selectedPlotNames: ['ऊस 1'] }] },
    meta: { createdAtISO: '2026-11-08T05:00:00.000Z', farmId: FARM },
    fullTranscript: 'आज फवारणी केली उद्या पाईपलाईन दुरुस्त करायची',
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], observations: [],
    plannedTasks,
    ...over,
} as unknown as DailyLog);

const item = (id: string, title: string, over: Record<string, unknown> = {}) => ({
    id, title, status: 'pending', priority: 'normal', sourceType: 'ai_extracted', plotId: PLOT, cropId: 'cane', createdAt: '2026-11-08T05:00:00.000Z', ...over,
});

const serverTask = (over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id: spokenTaskId(LOG, 't1'), farmId: FARM, title: 'पाईपलाईन दुरुस्त करायची', scope: 'Unspecified', plannedDate: '2026-11-09', looseWhen: null, plannedTime: null,
    assigneeUserId: null, crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', source: 'VoiceLog',
    sourceKind: 'Spoken', sourceDailyLogId: LOG, sourcePlotId: PLOT, recordedOn: DAY, linkedDailyLogIds: [], createdByUserId: ME,
    createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z', plots: [],
    ...over,
} as PlannedWorkDto);

const pull = (over: Partial<SyncPullResponse> = {}): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h',
    ...over,
} as SyncPullResponse);
const scopes = (...farmIds: string[]) => farmIds.map(farmId => ({ farmId, ownRecordsOnly: false, seeMoney: false, seeWages: false }));

const queueLogCreate = async (status: 'PENDING' | 'APPLIED') => {
    const db = getDatabase();
    await db.mutationQueue.add({
        deviceId: 'd', clientRequestId: `create_daily_log:${LOG}`, mutationType: SyncMutationName.CreateDailyLog, payload: { dailyLogId: LOG, farmId: FARM },
        status, createdAt: '2026-11-08T05:00:00.000Z', retryCount: 0, clientCommandId: `create_daily_log:${LOG}`,
    } as never);
};

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.plannedWork.clear(), db.mutationQueue.clear(), db.appMeta.clear(), db.plots.clear()]);
    await db.plots.put({ id: PLOT, payload: { id: PLOT, farmId: FARM, name: 'ऊस 1' }, modifiedAtUtc: '2026-10-01T00:00:00.000Z' } as never);
});

describe('the mirror - a spoken reminder shows at once, under the id the server will give it', () => {
    it('is in the store as "kept on the phone", with the server\'s id, spoken, dated by its clear cue and carrying no words of the log', async () => {
        const written = await mirrorSpokenReminders([logWith([item('t1', 'पाईपलाईन दुरुस्त करायची', { dueHint: 'उद्या', sourceText: 'उद्या पाईपलाईन', systemInterpretation: 'pipeline' })])], ME);
        expect(written).toBe(1);

        const items = await getLocalPlannedWork(FARM);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: spokenTaskId(LOG, 't1'), title: 'पाईपलाईन दुरुस्त करायची', plannedDate: '2026-11-09', sourceKind: 'Spoken', status: 'Open',
            assigneeUserId: null, scope: 'Unspecified', keptOnPhone: true, sourcePlotId: PLOT, sourceDailyLogId: LOG, refused: false,
        });
        const stored = JSON.stringify(await getDatabase().plannedWork.toArray());
        expect(stored).not.toContain('आज फवारणी');
        expect(stored).not.toContain('pipeline');
    });

    it('a day with no clear cue stays undated (never today), and a typed reminder of a manual save is "typed", not spoken', async () => {
        await mirrorSpokenReminders([logWith([item('t1', 'a', { dueHint: 'नंतर' })])], ME);
        expect((await getLocalPlannedWork(FARM))[0].plannedDate).toBeNull();

        await resetDatabase();
        const db = getDatabase();
        await db.plots.put({ id: PLOT, payload: { id: PLOT, farmId: FARM, name: 'ऊस 1' }, modifiedAtUtc: 'x' } as never);
        await mirrorSpokenReminders([logWith([item('x1', 'ठिबक तपासा', { sourceType: 'observation_derived', dueDate: DAY })], { fullTranscript: undefined })], ME);
        const [typed] = await getLocalPlannedWork(FARM);
        expect(typed.sourceKind).toBe('Typed');
        expect(typed.plannedDate).toBeNull();
    });

    it('writing it again changes nothing, and never overwrites what is there (the server\'s row, a cancelled task)', async () => {
        const log = logWith([item('t1', 'पाईपलाईन दुरुस्त करायची')]);
        await mirrorSpokenReminders([log], ME);
        expect(await mirrorSpokenReminders([log], ME)).toBe(0);
        expect(await getDatabase().plannedWork.count()).toBe(1);

        // the server's row (he cancelled it elsewhere) is not replaced by a fresh mirror
        await getDatabase().plannedWork.put({ ...(await getDatabase().plannedWork.toArray())[0], mirror: undefined, status: 'Cancelled' });
        expect(await mirrorSpokenReminders([log], ME)).toBe(0);
        expect((await getDatabase().plannedWork.toArray())[0].status).toBe('Cancelled');
    });

    it('a log whose farm is not known, or with no planned item, writes nothing', async () => {
        expect(await mirrorSpokenReminders([logWith([])], ME)).toBe(0);
        expect(await mirrorSpokenReminders([logWith([item('t1', 'a')], { context: { selection: [{ cropId: 'c', cropName: 'c', selectedPlotIds: ['not-a-synced-plot'], selectedPlotNames: [] }] } } as never)], ME)).toBe(0);
    });

    it('the pull\'s row (same id) REPLACES the mirror - one item, no longer "kept on the phone", never two', async () => {
        await mirrorSpokenReminders([logWith([item('t1', 'पाईपलाईन दुरुस्त करायची', { dueHint: 'उद्या' })])], ME);
        await queueLogCreate('APPLIED');

        await reconcileSyncPull(pull({ plannedWork: [serverTask()], accessScopes: scopes(FARM) as never }));

        const items = await getLocalPlannedWork(FARM);
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe(spokenTaskId(LOG, 't1'));
        expect(items[0].keptOnPhone).toBe(false);
        expect(items[0].source).toBe('server');
        expect(items[0].scope).toBe('Unspecified');
    });

    it('a FULL pull does not take the mirror while its log is still on the phone, and does once the log was applied and the server made none', async () => {
        await mirrorSpokenReminders([logWith([item('t1', 'पाईपलाईन दुरुस्त करायची')])], ME);
        await queueLogCreate('PENDING');
        const fullPull = () => reconcileSyncPull(pull({ plannedWork: [], accessScopes: scopes(FARM) as never }), { fullPull: true });

        await fullPull();
        expect((await getLocalPlannedWork(FARM)).map(t => t.id)).toEqual([spokenTaskId(LOG, 't1')]);

        await getDatabase().mutationQueue.clear();
        await queueLogCreate('APPLIED');
        await fullPull();
        expect(await getLocalPlannedWork(FARM)).toEqual([]);
    });
});

describe('one list - the same task once, on every surface that reads tasks', () => {
    const mine = (over: Partial<PlannedWorkDto> = {}) => serverTask({ createdByUserId: ME, ...over });
    const itemsOf = async (rows: PlannedWorkDto[]) => {
        await reconcileSyncPull(pull({ plannedWork: rows, accessScopes: scopes(FARM, OTHER_FARM) as never }));
        return getLocalPlannedWork(FARM);
    };

    it('his reminders and work handed to him are on his list; work handed to someone else is the plan list\'s; a refused create is not work', async () => {
        const items = await itemsOf([
            mine({ id: '77777777-7777-4777-8777-777777777771' }),
            mine({ id: '77777777-7777-4777-8777-777777777772', assigneeUserId: ME, createdByUserId: OWNER, status: 'Assigned' }),
            mine({ id: '77777777-7777-4777-8777-777777777773', assigneeUserId: OWNER, createdByUserId: ME, status: 'Assigned' }),
            mine({ id: '77777777-7777-4777-8777-777777777774', createdByUserId: OWNER }), // another person's reminder, seen by the owner
        ]);
        const onList = items.filter(t => isOnMyList(t, ME)).map(t => t.id);
        expect(onList).toContain('77777777-7777-4777-8777-777777777771');
        expect(onList).toContain('77777777-7777-4777-8777-777777777772');
        expect(onList).not.toContain('77777777-7777-4777-8777-777777777773');
        // another person's reminder (the owner sees what his people said) is on the owner's list too
        expect(onList).toContain('77777777-7777-4777-8777-777777777774');

        const refused = { ...items[0], refused: true };
        expect(isOnMyList(refused, ME)).toBe(false);
    });

    it('another farm\'s tasks never appear', async () => {
        await itemsOf([mine({ id: '77777777-7777-4777-8777-777777777771' }), mine({ id: '77777777-7777-4777-8777-777777777775', farmId: OTHER_FARM })]);
        const here = plannedWorkAsTasks(await getLocalPlannedWork(FARM), ME);
        expect(here.map(t => t.id)).toEqual(['77777777-7777-4777-8777-777777777771']);
        expect((await getLocalPlannedWork(OTHER_FARM)).map(t => t.id)).toEqual(['77777777-7777-4777-8777-777777777775']);
    });

    it('undated and loose work is never late; a dated one past its day is - on the list the other screens count', async () => {
        const rows = await itemsOf([
            mine({ id: '77777777-7777-4777-8777-777777777771', plannedDate: null }),
            mine({ id: '77777777-7777-4777-8777-777777777772', plannedDate: null, looseWhen: 'Week' }),
            mine({ id: '77777777-7777-4777-8777-777777777773', plannedDate: '2026-11-01' }),
            mine({ id: '77777777-7777-4777-8777-777777777774', plannedDate: '2026-11-09' }),
        ]);
        const tasks = plannedWorkAsTasks(rows, ME);
        expect(tasks.find(t => t.id.endsWith('771'))!.dueDate).toBeUndefined();
        expect(tasks.find(t => t.id.endsWith('772'))!.dueDate).toBeUndefined();

        const list = buildTodoList({ tasks, storeIds: tickableIds(tasks), crops: [], scope: { viewCrops: [], viewPlots: {} }, wholeFarm: true, todayKey: DAY });
        expect(list.late.map(i => i.id)).toEqual(['77777777-7777-4777-8777-777777777773']);
        expect(list.noDate.map(i => i.id).sort()).toEqual(['77777777-7777-4777-8777-777777777771', '77777777-7777-4777-8777-777777777772']);
        expect(list.later.map(i => i.id)).toEqual(['77777777-7777-4777-8777-777777777774']);
    });

    it('a spoken reminder reads "बोलण्यातून", shows the log\'s plot, and a place he did not say is no "पूर्ण शेत"', async () => {
        const rows = await itemsOf([mine({ scope: 'Unspecified', sourcePlotId: null })]);
        const [task] = plannedWorkAsTasks(rows, ME);
        expect(task.sourceType).toBe('ai_extracted');
        const list = buildTodoList({ tasks: [task], storeIds: tickableIds([task]), crops: [], scope: { viewCrops: [], viewPlots: {} }, wholeFarm: true, todayKey: DAY });
        const row = [...list.late, ...list.today, ...list.later, ...list.noDate][0];
        expect(row.fromLabel).toBe('बोलण्यातून');
        expect(row.place).toBeUndefined();
    });

    it('"झाले" is offered only on his own open reminder (no log), never on work handed to him or on a finished one', async () => {
        const rows = await itemsOf([
            mine({ id: '77777777-7777-4777-8777-777777777771' }),
            mine({ id: '77777777-7777-4777-8777-777777777772', assigneeUserId: ME, createdByUserId: OWNER, status: 'Assigned' }),
            mine({ id: '77777777-7777-4777-8777-777777777773', status: 'Done' }),
            mine({ id: '77777777-7777-4777-8777-777777777774', createdByUserId: OWNER }),
        ]);
        const tasks = plannedWorkAsTasks(rows, ME);
        expect([...tickableIds(tasks)]).toEqual(['77777777-7777-4777-8777-777777777771']);
    });

    it('a "झाले" queued on this phone shows at once on the same list (the queued complete is laid over the server\'s row)', async () => {
        const id = '77777777-7777-4777-8777-777777777771';
        await itemsOf([mine({ id })]);
        await PlannedWorkCommands.complete({ plannedWorkId: id, farmId: FARM, plotIds: [], dailyLogIds: [], somethingLeft: false });
        const tasks = plannedWorkAsTasks(await getLocalPlannedWork(FARM), ME);
        expect(tasks.find(t => t.id === id)!.status).toBe('done');
    });
});
