// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Task 3; founder D-1, D-29, D-78 = 1, P3, P10) - ONE list, on the three screens, through
 * the router's own route renderers (`renderReflectView`, `renderAttentionRoute`, `renderPlanWorkRoute`: what `AppRouter` calls for each route) fed by
 * the real `useOneTaskList` over a fake-indexeddb phone database:
 *   - the same reminder is on करायची कामे, on लक्ष द्या (when late) and on the plan list - once each - and an undated one is on none of the late
 *     lists and never counted late;
 *   - "झाले" on any of them is a `plannedwork.complete` with NO log (D-1) and clears the reminder from all three at once;
 *   - one tap removes a reminder made from what he said (a cancel, never a delete);
 *   - another farm's tasks never appear; the reminder made from the log he just saved shows at once on all three, as "kept on the phone".
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AppRouterContext } from '../../../core/navigation/routeContext';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import type { DailyLog, PlannedTask } from '../../../types';

configure({ asyncUtilTimeout: 6000 });

const h = vi.hoisted(() => ({ farmId: '55555555-5555-4555-8555-555555555551', today: '2026-11-08' }));

// Stable values, as the real provider hands out: a fresh object on every render would loop every effect that depends on it.
vi.mock('../../../core/session/FarmContext', () => {
    const farm = { currentFarmId: '55555555-5555-4555-8555-555555555551', currentFarmName: 'शेत', currentFarm: { farmId: '55555555-5555-4555-8555-555555555551', role: 'Mukadam' }, meContext: { me: { userId: '22222222-2222-4222-8222-222222222222' } } };
    return { useFarmContext: () => farm, useOptionalFarmContext: () => farm };
});
vi.mock('../../../core/domain/services/DateKeyService', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../core/domain/services/DateKeyService')>()),
    getDateKey: () => h.today,
}));
vi.mock('../../../shared/hooks/useUiPref', () => ({ useUiPref: () => [true, vi.fn()] as const }));
vi.mock('../components/PlanMic', () => ({ PlanMic: () => null }));
vi.mock('../data/plannedWorkAssignees', () => ({ loadAssignees: async () => ({ assignees: [], source: 'server', receivedAtUtc: 'x' }) }));
vi.mock('../../attention/hooks/useAttentionBoard', () => ({
    useAttentionBoard: () => ({ cards: [], asOf: null, isLoading: false, loadFailed: false, scheduledWork: null, refresh: vi.fn() }),
}));

import { renderAttentionRoute, renderPlanWorkRoute } from '../../../core/navigation/simpleRoutes';
import { TodoSection } from '../../reflect/overview/TodoSection';
import { buildTodoList, tickableIds, toggledTask } from '../../reflect/overview/todoModel';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { useOneTaskList } from '../data/useOneTaskList';
import { mirrorSpokenReminders } from '../data/spokenMirror';
import { spokenTaskId } from '../data/plannedWorkIds';
import { useAttentionModel } from '../../attention/hooks/useAttentionModel';

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const ME = '22222222-2222-4222-8222-222222222222';
const OWNER = '11111111-1111-4111-8111-111111111111';
const PLOT = '44444444-4444-4444-8444-444444444441';
const LATE = '33333333-3333-4333-8333-333333333331';
const UNDATED = '33333333-3333-4333-8333-333333333332';
const SPOKEN = '33333333-3333-4333-8333-333333333333';
const ELSEWHERE = '33333333-3333-4333-8333-333333333334';

const row = (id: string, over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id, farmId: FARM, title: 'ठिबकची नळी तपासायची', scope: 'Farm', plannedDate: null, looseWhen: null, plannedTime: null, assigneeUserId: null, crewText: null,
    expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', source: 'Planning', sourceKind: 'Typed', recordedOn: '2026-11-01',
    linkedDailyLogIds: [], createdByUserId: ME, createdAtUtc: '2026-11-01T06:00:00.000Z', modifiedAtUtc: '2026-11-01T06:00:00.000Z', plots: [], ...over,
} as PlannedWorkDto);

const pull = (plannedWork: PlannedWorkDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', plannedWork,
    accessScopes: [FARM, OTHER_FARM].map(farmId => ({ farmId, ownRecordsOnly: false, seeMoney: false, seeWages: false })),
} as unknown as SyncPullResponse);

const crops = [{ id: 'cane', name: 'ऊस', iconName: 'Sugarcane', color: 'emerald', plots: [{ id: PLOT, name: 'ऊस 1' }] }];

/**
 * करायची कामे as ReflectPage draws it: the SAME model (`buildTodoList` with `tickableIds`) and the SAME section (`TodoSection`), with the same
 * tick and removal doors (`onUpdateTask(toggledTask(...))` / `{ ...task, status: 'cancelled' }`). The page itself (history, calendar, voice) is not
 * what is under test and needs more of the app than a phone database; its wiring is `reflectViewWiring.test.tsx`.
 */
const TodoSurface: React.FC<{ tasks: PlannedTask[]; onUpdate: (id: string, updates: Partial<PlannedTask>) => void }> = ({ tasks, onUpdate }) => {
    const list = buildTodoList({ tasks, storeIds: tickableIds(tasks), crops: crops as never, scope: { viewCrops: [], viewPlots: {} }, wholeFarm: true, todayKey: h.today });
    return (
        <TodoSection
            list={list}
            onToggle={t => { if (t.canToggle) onUpdate(t.task.id, toggledTask(t.task)); }}
            onRemove={t => { if (t.canRemove) onUpdate(t.task.id, { ...t.task, status: 'cancelled' }); }}
        />
    );
};

/** The three screens, side by side, over ONE list (what the app's `useAppData` hands the router). */
const Screens: React.FC = () => {
    const one = useOneTaskList({ farmId: FARM, userId: ME, isDemoMode: false, knownPlotIds: new Set([PLOT]), demo: { tasks: [], save: vi.fn(), update: vi.fn() } });
    const attention = useAttentionModel(one.tasks, crops as never);
    const ctx = {
        currentRoute: 'main', mainView: 'reflect', activeFarmId: FARM, meUserId: ME, crops, history: [], todayLogs: [], operatorNameById: new Map(),
        getLogContextSnapshot: () => undefined, plannedTasks: one.tasks, handleUpdateTask: one.update, handleSaveTask: one.save,
        setShowTaskCreationSheet: vi.fn(), status: 'idle', draftLog: null, handleReset: vi.fn(), setLogScope: vi.fn(), setMode: vi.fn(), setMainView: vi.fn(),
        setStatus: vi.fn(), setDraftLog: vi.fn(), handleEditLog: vi.fn(), handleUpdateNote: vi.fn(), farmerProfile: { operators: [], activeOperatorId: undefined },
        setCurrentRoute: vi.fn(), goBackOr: vi.fn(), reflectFocusRequest: null, setReflectFocusRequest: vi.fn(), reflectFocusPlotId: null, setReflectFocusPlotId: vi.fn(),
        hiddenViews: [], farmRole: 'Mukadam', mayOpenPlanner: true, mayAssignWork: false, mayPlanWork: true, isPrimaryOwner: false, completingTask: null, setCompletingTask: vi.fn(),
    } as unknown as AppRouterContext;
    return (
        <div>
            <div data-testid="surface-todos"><TodoSurface tasks={one.tasks} onUpdate={ctx.handleUpdateTask} /></div>
            <div data-testid="surface-attention">{renderAttentionRoute({ ...ctx, currentRoute: 'attention' } as AppRouterContext)}</div>
            <div data-testid="surface-plan">{renderPlanWorkRoute({ ...ctx, currentRoute: 'plan-work' } as AppRouterContext)}</div>
            <p data-testid="attention-total">{attention.total}</p>
        </div>
    );
};

const queued = async (type: string) => getDatabase().mutationQueue.where('mutationType').equals(type).toArray();
const inTodos = (id: string) => within(screen.getByTestId('surface-todos')).queryAllByTestId(`todo-row-${id}`);
const inPlan = (id: string) => within(screen.getByTestId('surface-plan')).queryAllByTestId(`plan-${id}`);

beforeEach(async () => {
    vi.clearAllMocks();
    h.farmId = FARM; h.today = '2026-11-08';
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear(), getDatabase().plots.clear()]);
    await getDatabase().plots.put({ id: PLOT, farmId: FARM, payload: { id: PLOT, farmId: FARM, name: 'ऊस 1' }, modifiedAtUtc: 'x' } as never);
});
afterEach(cleanup);

const open = async (rows: PlannedWorkDto[]) => {
    await reconcileSyncPull(pull(rows));
    await act(async () => { render(<Screens />); });
    await act(async () => { window.dispatchEvent(new Event('agrisync:sync-reconciled')); });
};

describe('ONE list on three screens', () => {
    it('the same late reminder is once on करायची कामे, once on लक्ष द्या and once on the plan list; the undated one is on none of the late lists', async () => {
        await open([row(LATE, { plannedDate: '2026-11-05' }), row(UNDATED, { plannedDate: null }), row(ELSEWHERE, { farmId: OTHER_FARM, plannedDate: '2026-11-05' })]);

        await waitFor(() => expect(inTodos(LATE)).toHaveLength(1));
        expect(inPlan(LATE)).toHaveLength(1);
        expect(within(screen.getByTestId('surface-attention')).getAllByTestId(`attention-reminder-${LATE}`)).toHaveLength(1);

        // undated: on the to-do list and the plan list, never in the late group, never counted late
        expect(inTodos(UNDATED)).toHaveLength(1);
        expect(within(screen.getByTestId('surface-todos')).getByTestId('todo-group-nodate')).toContainElement(inTodos(UNDATED)[0]);
        expect(within(screen.getByTestId('surface-attention')).queryAllByTestId(`attention-reminder-${UNDATED}`)).toHaveLength(0);
        expect(screen.getByTestId('attention-total')).toHaveTextContent('1');
        expect(inPlan(UNDATED)[0]).toHaveAttribute('data-late', 'no');

        // another farm's task never appears on any of them
        expect(inTodos(ELSEWHERE)).toHaveLength(0);
        expect(inPlan(ELSEWHERE)).toHaveLength(0);
    });

    it('"झाले" on करायची कामे is a complete with NO log and clears the reminder from all three at once', async () => {
        await open([row(LATE, { plannedDate: '2026-11-05' })]);
        await waitFor(() => expect(inTodos(LATE)).toHaveLength(1));

        await act(async () => { fireEvent.click(screen.getByTestId(`todo-tick-${LATE}`)); });

        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(1));
        const [sent] = await queued(SyncMutationName.PlannedworkComplete);
        expect(sent.payload).toEqual({ plannedWorkId: LATE, farmId: FARM, plotIds: [], dailyLogIds: [], somethingLeft: false });
        // gone from the late groups and from the count; on the plan list it is closed, not open
        await waitFor(() => expect(within(screen.getByTestId('surface-attention')).queryAllByTestId(`attention-reminder-${LATE}`)).toHaveLength(0));
        expect(screen.getByTestId('attention-total')).toHaveTextContent('0');
        await waitFor(() => expect(within(screen.getByTestId('surface-todos')).getByTestId('todo-all-done')).toBeInTheDocument());
        // the plan list reads the store on its own change event: it follows, a moment later under load
        await waitFor(() => expect(within(screen.getByTestId('surface-plan')).queryByTestId(`plan-done-${LATE}`)).toBeNull());
    });

    it('"झाले" on लक्ष द्या clears the same reminder from करायची कामे and the plan list too', async () => {
        await open([row(LATE, { plannedDate: '2026-11-05' })]);
        const onAttention = await within(screen.getByTestId('surface-attention')).findByTestId(`attention-reminder-${LATE}`);
        await act(async () => { fireEvent.click(within(onAttention).getByTestId(`attention-done-${LATE}`)); });

        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(1));
        await waitFor(() => expect(screen.getByTestId('attention-total')).toHaveTextContent('0'));
        await waitFor(() => expect(within(screen.getByTestId('surface-todos')).getByTestId('todo-all-done')).toBeInTheDocument());
    });

    it('a finished reminder cannot be ticked back from a to-do list (the owner reopens, with a reason); work handed to someone else is not on it', async () => {
        await open([row(LATE, { status: 'Done', plannedDate: '2026-11-05' }), row(UNDATED, { assigneeUserId: OWNER, createdByUserId: ME, status: 'Assigned' })]);
        await waitFor(() => expect(within(screen.getByTestId('surface-todos')).getByTestId('todo-done-toggle')).toBeInTheDocument());
        await act(async () => { fireEvent.click(screen.getByTestId('todo-done-toggle')); });
        expect(inTodos(LATE)).toHaveLength(1);
        expect(screen.getByTestId(`todo-tick-${LATE}`)).toBeDisabled();
        expect(inTodos(UNDATED)).toHaveLength(0);
        expect(inPlan(UNDATED)).toHaveLength(1); // the plan list still has the work he handed to someone else
    });

    it('a reminder made from what he said shows "बोलण्यातून"; one tap removes it (a cancel, not a delete)', async () => {
        await open([row(SPOKEN, { sourceKind: 'Spoken', source: 'VoiceLog', plannedDate: '2026-11-09', title: 'पाईपलाईन दुरुस्त करायची', scope: 'Unspecified' })]);
        const line = await screen.findByTestId(`todo-row-${SPOKEN}`);
        expect(line).toHaveTextContent('बोलण्यातून');
        expect(within(screen.getByTestId('surface-plan')).getByTestId('plan-card-source')).toHaveTextContent('बोलण्यातून');

        await act(async () => { fireEvent.click(within(line).getByTestId(`todo-remove-${SPOKEN}`)); });

        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkCancel)).toHaveLength(1));
        expect((await queued(SyncMutationName.PlannedworkCancel))[0].payload).toMatchObject({ plannedWorkId: SPOKEN, farmId: FARM });
        expect(await getDatabase().plannedWork.get(SPOKEN)).toBeDefined(); // the row is still there: nothing is deleted
        expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(0);
    });

    it('the reminder made from the log he just saved is on all three at once, as "kept on the phone", with no second copy', async () => {
        await open([]);
        const log = {
            id: '66666666-6666-4666-8666-666666666661', date: '2026-11-08', meta: { createdAtISO: '2026-11-08T05:00:00.000Z', farmId: FARM },
            context: { selection: [{ cropId: 'cane', cropName: 'ऊस', selectedPlotIds: [PLOT], selectedPlotNames: ['ऊस 1'] }] },
            fullTranscript: 'आज फवारणी केली उद्या पाईपलाईन दुरुस्त करायची', cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], observations: [],
            plannedTasks: [{ id: 'x1', title: 'पाईपलाईन दुरुस्त करायची', dueHint: 'उद्या', status: 'pending', sourceType: 'ai_extracted', plotId: PLOT, priority: 'normal', createdAt: '2026-11-08T05:00:00.000Z' }],
        } as unknown as DailyLog;
        const id = spokenTaskId(log.id, 'x1');

        await act(async () => { await mirrorSpokenReminders([log], ME); });

        await waitFor(() => expect(inTodos(id)).toHaveLength(1));
        expect(inPlan(id)).toHaveLength(1);
        expect(within(screen.getByTestId(`plan-${id}`)).getByTestId('plan-kept')).toBeInTheDocument();
        expect(inTodos(id)[0]).toHaveTextContent('बोलण्यातून');
        expect(inTodos(id)[0]).toHaveTextContent('ऊस 1'); // the log's plot

        // the pull then brings the server's row, under the same id: still one
        await reconcileSyncPull(pull([row(id, { sourceKind: 'Spoken', source: 'VoiceLog', scope: 'Unspecified', sourcePlotId: PLOT, sourceDailyLogId: log.id, plannedDate: '2026-11-09', title: 'पाईपलाईन दुरुस्त करायची' })]));
        await act(async () => { window.dispatchEvent(new Event('agrisync:sync-reconciled')); });
        await waitFor(() => expect(within(screen.getByTestId('surface-plan')).queryAllByTestId('plan-kept')).toHaveLength(0));
        expect(inTodos(id)).toHaveLength(1);
        expect(inPlan(id)).toHaveLength(1);
    });
});
