// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-3 Task 3; founder D-24d, D-30, D-1, CTX-1, P10) - "काम झालं" through the
 * REAL `AppRouter` (real plan route, real `openLogFlow`, real `TaskDoneHost`, real card; only the contexts the router reads and the mic
 * hardware are stubbed):
 *   - the assignee's "काम झालं" opens the normal recording on the task's crop and plots and keeps the task with the router; the draft
 *     gets nothing from the plan (no quantity, crew, headcount or pay);
 *   - after the save, a task on several plots asks "कोणत्या प्लॉटवर झालं?" (the canonical selector, preselected) and
 *     "पूर्ण झालं / काही बाकी आहे", then ONE `plannedwork.complete` carries the saved log ids;
 *   - a personal reminder is done with no recording and no log (D-1), and still says "आठवण";
 *   - a recording already waiting is not touched; "आत्ता नाही" lets the task go;
 *   - the card says the owner's word as text, and "अर्धवट झालं" with a line per plot; the primary owner's reopen asks for a reason;
 *   - English mode shows English only.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';

// The whole router is drawn in these tests: under a loaded machine the default one second is too tight for a find.
configure({ asyncUtilTimeout: 6000 });

const h = vi.hoisted(() => ({
    farm: { farmId: '55555555-5555-4555-8555-555555555551', role: 'Worker' as string },
    userId: '11111111-1111-4111-8111-111111111111',
    language: 'mr' as 'mr' | 'en',
    status: 'idle' as string,
    saved: [] as string[],
    draft: null as unknown,
    setLogScope: vi.fn(),
    setMode: vi.fn(),
    setMainView: vi.fn(),
    setDraftLog: vi.fn(),
    handleReset: vi.fn(),
    route: 'plan-work',
    history: [] as unknown[],
    nav: null as null | { setMainView: (v: string) => void; setCurrentRoute: (r: string) => void },
}));

vi.mock('../../../shared/utils/haptics', () => ({ hapticFeedback: { light: vi.fn(), medium: vi.fn(), heavy: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../shared/hooks/useUiPref', () => ({ useUiPref: () => [true, vi.fn()] as const }));
vi.mock('../../../features/voice/components/AudioRecorder', () => ({ default: () => <div data-stub="audio" /> }));
vi.mock('../../../features/voice/components/AudioRecorderStreaming', () => ({ default: () => <div data-stub="audio-streaming" /> }));
vi.mock('../../../features/voice/components/LiveCaption', () => ({ default: () => null }));
vi.mock('../../appUpdate/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
vi.mock('../../logs/components/LedgerRecognitionPanel', () => ({ LedgerRecognitionPanel: () => null }));
vi.mock('../../logs/components/voiceResult/VoiceResultContainer', () => ({ VoiceResultContainer: () => null }));
vi.mock('../components/PlanMic', () => ({ PlanMic: () => <button type="button" data-testid="plan-mic">mic</button> }));
vi.mock('../data/plannedWorkAssignees', () => ({ loadAssignees: async () => ({ assignees: [], source: 'server', receivedAtUtc: 'x' }) }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: h.language }),
}));
vi.mock('../../../app/featureFlags', () => ({
    FEATURE_FLAGS: { dailyLoop: false, voiceContinuity: false, taskCloseConfirm: false, understandingMeter: false },
    IS_E2E_HARNESS_ENABLED: false,
    isE2EHarnessEnabled: () => false,
    isFarmGeographyV2Enabled: () => false,
    isWeatherBackendFetchEnabled: () => false,
    isVoiceDoomLoopDetectorEnabled: () => true,
}));
vi.mock('../../../app/context/AppFeatureContexts', async () => {
    const react = await import('react');
    return {
        useAppNavigationState: () => {
            const [currentRoute, setCurrentRoute] = react.useState<string>(h.route);
            // A real, stateful tab: the bottom bar's open (`setMainView`) moves it, as in the app.
            const [mainView, setMainViewState] = react.useState<string>('log');
            const setMainView = (view: string) => { h.setMainView(view); setMainViewState(view); };
            h.nav = { setMainView, setCurrentRoute };
            return {
                currentRoute, setCurrentRoute, mainView, setMainView, logIntent: null, setLogIntent: vi.fn(),
                lastLabourLogIds: [], goBackOr: (to: string) => setCurrentRoute(to), openPlace: vi.fn(), placeResetKey: 0,
                logHomePending: false, consumeLogHome: vi.fn(),
            };
        },
        useAppLogState: () => ({
            logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
            setLogScope: h.setLogScope, currentLogContext: null, hasActiveLogContext: false, isContextReady: false,
        }),
        useAppDataState: () => ({
            isDemoMode: false, setIsDemoMode: vi.fn(),
            farmerProfile: { operators: [], activeOperatorId: '' }, setFarmerProfile: vi.fn(),
            crops: [{
                id: 'cane', name: 'ऊस', iconName: 'Sugarcane', color: 'emerald',
                plots: [{ id: '44444444-4444-4444-8444-444444444441', name: 'ऊस 1' }, { id: '44444444-4444-4444-8444-444444444442', name: 'ऊस 2' }],
            }],
            mockHistory: [], realHistory: h.history,
            handleUpdateCrops: vi.fn(), handleAddPerson: vi.fn(), handleDeletePerson: vi.fn(),
            setLedgerDefaults: vi.fn(), ledgerDefaults: {}, userResources: [], setUserResources: vi.fn(),
            plannedTasks: [], handleSaveTask: vi.fn(), handleUpdateTask: vi.fn(),
            showTaskCreationSheet: false, setShowTaskCreationSheet: vi.fn(),
        }),
        useAppVoiceState: () => ({
            status: h.status, setStatus: vi.fn(), mode: 'voice', setMode: h.setMode,
            recordingSegment: null, setRecordingSegment: vi.fn(), handleAudioReady: vi.fn(), handleTextReady: vi.fn(),
            error: null, errorTranscript: null, draftLog: h.draft, setDraftLog: h.setDraftLog, provenance: null,
            voiceStreamingPhase: null, liveCaption: null,
        }),
        useAppCommandsState: () => ({ handleManualSubmit: vi.fn(), handleUpdateNote: vi.fn() }),
        useAppWeatherState: () => ({ weatherData: undefined, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: vi.fn() }),
        useAppTrustState: () => ({ handleVerifyLog: vi.fn() }),
        useAppUiRuntime: () => ({ handleReset: h.handleReset, lastSavedLogSummary: [], lastSavedLogIds: h.saved }),
        useAppViewHelpers: () => ({ getTodayCounts: vi.fn(), getContextColorIndicator: () => null }),
    };
});
vi.mock('../../../core/navigation/hooks/useAppRouterDerivations', () => ({
    useAppRouterDerivations: () => ({
        ownerDisplayName: 'Owner', operatorNameById: new Map(), todayDateKey: '2026-11-08', yesterdayDate: '2026-11-07', todayLogs: [],
        todayDayState: { closurePercent: 0, isClosed: false, hasStarted: false, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        yesterdayDayState: { closurePercent: 0, isClosed: false, hasStarted: false, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0, scopeLabel: '' }, yesterdayCost: 0, getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
    }),
}));
vi.mock('../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({
        currentFarmId: h.farm.farmId,
        currentFarm: { ...h.farm, authorities: undefined },
        meContext: { me: { userId: h.userId } },
    }),
    useOptionalFarmContext: () => null,
}));
vi.mock('../../../core/navigation/MainViewTransition', () => ({ default: (p: { children: React.ReactNode }) => <div>{p.children}</div> }));
vi.mock('../../../core/navigation/globalSheets', () => ({ renderGlobalSheets: () => null }));
vi.mock('../../../core/speak/SpeakHost', () => ({ SpeakHost: () => null }));

import AppRouter from '../../../core/navigation/AppRouter';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

const FARM = '55555555-5555-4555-8555-555555555551';
const OWNER = '22222222-2222-4222-8222-222222222222';
const WORKER = '11111111-1111-4111-8111-111111111111';
const P1 = '44444444-4444-4444-8444-444444444441';
const P2 = '44444444-4444-4444-8444-444444444442';
const LOG1 = '66666666-6666-4666-8666-666666666661';
const LOG2 = '66666666-6666-4666-8666-666666666662';
const T1 = '33333333-3333-4333-8333-333333333331';
const T2 = '33333333-3333-4333-8333-333333333332';

const task = (id: string, over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id, farmId: FARM, title: 'युरिया टाकणे', scope: 'MultiPlot', plannedDate: '2026-11-10', looseWhen: null, plannedTime: null,
    assigneeUserId: WORKER, crewText: 'रोकडेची टीम', expectedHeadcount: 10, quantityText: '३ पोती', payMode: 'Daily', note: null,
    status: 'Accepted', source: 'Planning', sourceKind: 'PlanForm', recordedOn: '2026-11-08', linkedDailyLogIds: [],
    createdByUserId: OWNER, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z',
    plots: [{ plotId: P1, status: 'Pending', linkedDailyLogIds: [] }, { plotId: P2, status: 'Pending', linkedDailyLogIds: [] }],
    ...over,
});
const pull = (plannedWork: PlannedWorkDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', plannedWork,
} as unknown as SyncPullResponse);

// A log made after the door was tapped (`createdAtISO` in the future of the click) unless told otherwise.
const NEW = () => new Date(Date.now() + 60_000).toISOString();
const OLD = () => new Date(Date.now() - 86_400_000).toISOString();
const log = (id: string, plotId: string, created: () => string = NEW) => ({ id, meta: { createdAtISO: created() }, context: { selection: [{ cropId: 'cane', cropName: 'ऊस', selectedPlotIds: [plotId], selectedPlotNames: [] }] } });
const queued = async (type: string) => getDatabase().mutationQueue.where('mutationType').equals(type).toArray();
const seat = (role: string, userId: string) => { h.farm = { farmId: FARM, role }; h.userId = userId; };

beforeEach(async () => {
    vi.clearAllMocks();
    h.language = 'mr'; h.status = 'idle'; h.saved = []; h.draft = null; h.route = 'plan-work';
    h.history = [log(LOG1, P1), log(LOG2, P2)];
    seat('Worker', WORKER);
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
});
afterEach(cleanup);

const openPlan = async (tasks: PlannedWorkDto[]) => {
    await reconcileSyncPull(pull(tasks));
    let utils!: ReturnType<typeof render>;
    await act(async () => { utils = render(<AppRouter />); });
    await screen.findByTestId('plan-work');
    // A pull that finished tells the page to read the list again (the same event the real reconciler sends); a test that does not wait
    // for the first read to land is otherwise at the mercy of the phone database being re-opened under it by the previous test.
    await act(async () => { window.dispatchEvent(new Event('agrisync:sync-reconciled')); });
    return utils;
};

describe('"काम झालं" opens the normal recording on the task, through the real router', () => {
    it('opens the recording on the task\'s crop and BOTH plots, keeps the task, and puts nothing from the plan into the draft', async () => {
        await openPlan([task(T1)]);
        const button = await screen.findByTestId(`plan-done-${T1}`);
        expect(button).toHaveTextContent('काम झालं');

        await act(async () => { fireEvent.click(button); });

        // The task's plots are the recording's plots - the log flow's own scope, nothing else.
        expect(h.setLogScope).toHaveBeenCalledTimes(1);
        expect(h.setLogScope).toHaveBeenCalledWith({ selectedCropIds: ['cane'], selectedPlotIds: [P1, P2], mode: 'multi', applyPolicy: 'broadcast' });
        expect(h.setMode).toHaveBeenCalledWith('voice');
        expect(h.setMainView).toHaveBeenCalledWith('log');
        // The draft is untouched: no quantity ("३ पोती"), crew ("रोकडेची टीम"), headcount (10) or pay (Daily) comes from the plan.
        expect(h.setDraftLog).not.toHaveBeenCalled();
        expect(JSON.stringify(h.setLogScope.mock.calls)).not.toMatch(/पोती|रोकडे|Daily|10/);
        // The plan page was a route over the home tabs: it is gone, the recording's home is back.
        await waitFor(() => expect(screen.queryByTestId('plan-work')).toBeNull());
        // Nothing is sent until the recording is saved.
        expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(0);
    });

    it('after the save: "कोणत्या प्लॉटवर झालं?" with the task\'s plots, then one complete with the saved log ids', async () => {
        const { rerender } = await openPlan([task(T1)]);
        await act(async () => { fireEvent.click(await screen.findByTestId(`plan-done-${T1}`)); });
        await waitFor(() => expect(screen.queryByTestId('plan-work')).toBeNull());
        expect(screen.queryByTestId('task-done-sheet')).toBeNull(); // not before the save

        // He recorded urea on ऊस 1 only; the recording saved.
        h.status = 'success'; h.saved = [LOG1];
        await act(async () => { rerender(<AppRouter />); });

        const sheet = await screen.findByTestId('task-done-sheet');
        expect(within(sheet).getByTestId('task-done-plots')).toHaveTextContent('कोणत्या प्लॉटवर झालं?');
        expect(within(sheet).getByTestId('task-done-all')).toHaveTextContent('पूर्ण झालं');
        expect(within(sheet).getByTestId('task-done-left')).toHaveTextContent('काही बाकी आहे');
        // The selector offers only the plots the saved log is on (the canonical CropSelector, preselected).
        expect(sheet.textContent).toContain('ऊस 1');

        await act(async () => { fireEvent.click(within(sheet).getByTestId('task-done-all')); });

        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(1));
        const [row] = await queued(SyncMutationName.PlannedworkComplete);
        expect(row.payload).toEqual({ plannedWorkId: T1, farmId: FARM, plotIds: [P1], dailyLogIds: [LOG1], somethingLeft: false });
        expect(row.clientRequestId).toBe(`plannedwork.complete:${T1}:${LOG1}`);
        // One complete per save: the sheet is gone and a re-render sends nothing more.
        await waitFor(() => expect(screen.queryByTestId('task-done-sheet')).toBeNull());
        await act(async () => { rerender(<AppRouter />); });
        expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(1);
    });

    it('"काही बाकी आहे" sends somethingLeft with both plots and both logs', async () => {
        const { rerender } = await openPlan([task(T1)]);
        await act(async () => { fireEvent.click(await screen.findByTestId(`plan-done-${T1}`)); });
        h.status = 'success'; h.saved = [LOG1, LOG2];
        await act(async () => { rerender(<AppRouter />); });
        await act(async () => { fireEvent.click(await screen.findByTestId('task-done-left')); });
        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(1));
        const [row] = await queued(SyncMutationName.PlannedworkComplete);
        expect(row.payload).toMatchObject({ plotIds: [P1, P2], dailyLogIds: [LOG1, LOG2], somethingLeft: true });
    });

    it('"आत्ता नाही" lets the task go: the sheet closes and nothing is sent', async () => {
        const { rerender } = await openPlan([task(T2, { title: 'फवारणी' })]);
        await act(async () => { fireEvent.click(await screen.findByTestId(`plan-done-${T2}`)); });
        h.status = 'success'; h.saved = [LOG2];
        await act(async () => { rerender(<AppRouter />); });
        await act(async () => { fireEvent.click(await screen.findByTestId('task-done-notnow')); });
        await waitFor(() => expect(screen.queryByTestId('task-done-sheet')).toBeNull());
        expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(0);
    });

    it('a recording already waiting is not touched: no scope change, no task attached, and he is told to finish it first', async () => {
        h.status = 'confirming';
        const { rerender } = await openPlan([task(T1)]);
        await act(async () => { fireEvent.click(await screen.findByTestId(`plan-done-${T1}`)); });

        expect(h.setLogScope).not.toHaveBeenCalled();
        expect(await screen.findByTestId('plan-banner')).toHaveTextContent('आधी चालू असलेली नोंद पूर्ण करा');

        // The waiting recording is saved later: it is NOT this task's, so no question is asked about it.
        h.status = 'success'; h.saved = [LOG1];
        await act(async () => { rerender(<AppRouter />); });
        expect(screen.queryByTestId('task-done-sheet')).toBeNull();
    });

    it('a save that ends with the status idle (confirm the draft) asks the same question; a recorder still busy asks nothing yet', async () => {
        const { rerender } = await openPlan([task(T1, { scope: 'Plot', plots: [{ plotId: P1, status: 'Pending', linkedDailyLogIds: [] }] })]);
        await act(async () => { fireEvent.click(await screen.findByTestId(`plan-done-${T1}`)); });
        h.status = 'recording'; h.saved = [LOG1];
        await act(async () => { rerender(<AppRouter />); });
        expect(screen.queryByTestId('task-done-sheet')).toBeNull();
        h.status = 'idle';
        await act(async () => { rerender(<AppRouter />); });
        expect(await screen.findByTestId('task-done-sheet')).toBeInTheDocument();
    });

    it('a single-plot task asks no plot question, only "पूर्ण झालं / काही बाकी आहे"', async () => {
        const { rerender } = await openPlan([task(T1, { scope: 'Plot', plots: [{ plotId: P1, status: 'Pending', linkedDailyLogIds: [] }] })]);
        await act(async () => { fireEvent.click(await screen.findByTestId(`plan-done-${T1}`)); });
        expect(h.setLogScope).toHaveBeenCalledWith({ selectedCropIds: ['cane'], selectedPlotIds: [P1], mode: 'single', applyPolicy: 'broadcast' });
        h.status = 'success'; h.saved = [LOG1];
        await act(async () => { rerender(<AppRouter />); });
        const sheet = await screen.findByTestId('task-done-sheet');
        expect(within(sheet).queryByTestId('task-done-plots')).toBeNull();
        await act(async () => { fireEvent.click(within(sheet).getByTestId('task-done-all')); });
        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(1));
        expect((await queued(SyncMutationName.PlannedworkComplete))[0].payload).toMatchObject({ plotIds: [P1], dailyLogIds: [LOG1] });
    });
});

describe('the task reference dies with its visit (L001): the sheet is asked only for a recording started FROM the door and saved in the same visit', () => {
    const OLD_LOG = '66666666-6666-4666-8666-666666666669';
    const startAtDoor = async () => {
        const utils = await openPlan([task(T1, { scope: 'Plot', plots: [{ plotId: P1, status: 'Pending', linkedDailyLogIds: [] }] })]);
        await act(async () => { fireEvent.click(await screen.findByTestId(`plan-done-${T1}`)); });
        await waitFor(() => expect(screen.queryByTestId('plan-work')).toBeNull());
        return utils;
    };
    const saveOrdinaryLog = async (rerender: (ui: React.ReactElement) => void, id = LOG1) => {
        h.status = 'success'; h.saved = [id];
        await act(async () => { rerender(<AppRouter />); });
    };

    it('(a) back out through the bottom bar, record an ordinary log on the same plot: no sheet', async () => {
        const { rerender } = await startAtDoor();
        await act(async () => { h.nav!.setMainView('reflect'); });
        await act(async () => { h.nav!.setMainView('log'); });
        await saveOrdinaryLog(rerender);
        expect(screen.queryByTestId('task-done-sheet')).toBeNull();
    });

    it('(b) switch farm after the door, then save: no sheet', async () => {
        const { rerender } = await startAtDoor();
        h.farm = { farmId: '55555555-5555-4555-8555-555555555599', role: 'Worker' };
        await act(async () => { rerender(<AppRouter />); });
        await saveOrdinaryLog(rerender);
        expect(screen.queryByTestId('task-done-sheet')).toBeNull();
    });

    it('(c) the same visit: door, record, save: the sheet (the case that must keep working)', async () => {
        const { rerender } = await startAtDoor();
        await saveOrdinaryLog(rerender);
        expect(await screen.findByTestId('task-done-sheet')).toBeInTheDocument();
    });

    it('(d) leaving the home tabs for another screen, or a different person signing in, ends the visit', async () => {
        let utils = await startAtDoor();
        await act(async () => { h.nav!.setCurrentRoute('settings'); });
        await act(async () => { h.nav!.setCurrentRoute('main'); });
        await saveOrdinaryLog(utils.rerender);
        expect(screen.queryByTestId('task-done-sheet')).toBeNull();

        cleanup();
        h.status = 'idle'; h.saved = []; h.route = 'plan-work';
        utils = await startAtDoor();
        h.userId = OWNER;
        await act(async () => { utils.rerender(<AppRouter />); });
        await saveOrdinaryLog(utils.rerender);
        expect(screen.queryByTestId('task-done-sheet')).toBeNull();
    });

    it('(e) a change saved to an OLDER entry (a "बदला" correction) is not the recording made for the task; a new one later still is', async () => {
        h.history = [log(LOG1, P1), log(OLD_LOG, P1, OLD)];
        const { rerender } = await startAtDoor();
        await saveOrdinaryLog(rerender, OLD_LOG);
        expect(screen.queryByTestId('task-done-sheet')).toBeNull();
        await saveOrdinaryLog(rerender, LOG1);
        expect(await screen.findByTestId('task-done-sheet')).toBeInTheDocument();
    });
});

describe('a personal reminder is done with no log (D-1)', () => {
    it('"काम झालं" on his own reminder sends one complete with no log and opens no recording; the card still says "आठवण"', async () => {
        seat('PrimaryOwner', OWNER);
        await openPlan([task(T1, { assigneeUserId: null, status: 'Open', createdByUserId: OWNER, scope: 'Farm', plots: [], crewText: null, expectedHeadcount: null, quantityText: null, payMode: null })]);
        const card = await screen.findByTestId(`plan-${T1}`);
        expect(card).toHaveAttribute('data-reminder', 'yes');
        expect(within(card).getByTestId('plan-card-reminder')).toHaveTextContent('आठवण');

        await act(async () => { fireEvent.click(within(card).getByTestId(`plan-done-${T1}`)); });

        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(1));
        const [row] = await queued(SyncMutationName.PlannedworkComplete);
        expect(row.payload).toEqual({ plannedWorkId: T1, farmId: FARM, plotIds: [], dailyLogIds: [], somethingLeft: false });
        expect(h.setLogScope).not.toHaveBeenCalled();
        expect(h.setMode).not.toHaveBeenCalled();
        // The card says it is kept on the phone and still says "आठवण", never "सोपवलं".
        await waitFor(() => expect(screen.getByTestId(`plan-${T1}`)).toHaveTextContent('फोनवर ठेवलं'));
        expect(screen.getByTestId(`plan-${T1}`).textContent).not.toContain('सोपवलं');
    });

    it('someone else\'s reminder, work handed to another person and done work show no "काम झालं"', async () => {
        seat('PrimaryOwner', OWNER);
        await openPlan([
            task(T1, { assigneeUserId: WORKER }), // handed to the worker: not his to say
            task(T2, { assigneeUserId: null, status: 'Open', createdByUserId: WORKER, scope: 'Farm', plots: [] }), // a reminder of the worker's
        ]);
        await screen.findByTestId(`plan-${T1}`);
        expect(screen.queryByTestId(`plan-done-${T1}`)).toBeNull();
        expect(screen.queryByTestId(`plan-done-${T2}`)).toBeNull();
    });
});

describe('the card: the owner\'s word as text, the half-done lines, and the reopen', () => {
    const done = (word: 'Waiting' | 'Confirmed' | 'Disputed', over: Partial<PlannedWorkDto> = {}) => task(T1, {
        status: 'Done', confirmationState: word, linkedDailyLogIds: [LOG1, LOG2], doneAtUtc: '2026-11-08T08:00:00.000Z', doneByUserId: WORKER,
        plots: [
            { plotId: P1, status: 'Done', linkedDailyLogIds: [LOG1], confirmationState: word },
            { plotId: P2, status: 'Done', linkedDailyLogIds: [LOG2], confirmationState: word },
        ], ...over,
    });

    it('says "झालं · मंजुरी बाकी" / "झालं · मंजूर" / "झालं · शंका — मालकाशी बोला" and draws no approve control', async () => {
        seat('PrimaryOwner', OWNER);
        for (const [word, text] of [['Waiting', 'झालं · मंजुरी बाकी'], ['Confirmed', 'झालं · मंजूर'], ['Disputed', 'झालं · शंका — मालकाशी बोला']] as const) {
            await getDatabase().plannedWork.clear();
            const { unmount } = await openPlan([done(word)]);
            const card = await screen.findByTestId(`plan-${T1}`);
            expect(within(card).getByTestId('plan-card-confirmation')).toHaveTextContent(text);
            expect(within(card).getByTestId('plan-card-done')).toHaveAttribute('data-state', word);
            // Text only (the approval door is lane L8c-5): no approve button, and the card is no link.
            expect(within(card).queryByRole('link')).toBeNull();
            expect(within(card).queryByText(/^मंजूर करा$|^मंजूर$/, { selector: 'button' })).toBeNull();
            unmount();
        }
    });

    it('a task done on one plot of two says "अर्धवट झालं" with a line per plot', async () => {
        seat('PrimaryOwner', OWNER);
        await openPlan([task(T1, {
            confirmationState: 'Waiting', linkedDailyLogIds: [LOG1],
            plots: [{ plotId: P1, status: 'Done', linkedDailyLogIds: [LOG1], confirmationState: 'Waiting' }, { plotId: P2, status: 'Pending', linkedDailyLogIds: [] }],
        })]);
        const card = await screen.findByTestId(`plan-${T1}`);
        expect(within(card).getByTestId('plan-card-confirmation')).toHaveTextContent('अर्धवट झालं · मंजुरी बाकी');
        expect(within(card).getByTestId('plan-card-plot-lines')).toHaveTextContent('ऊस 1 — झालं · ऊस 2 — बाकी');
        expect(within(card).getByTestId('plan-card-done')).toHaveAttribute('data-partly', 'yes');
    });

    it('the primary owner\'s reopen asks for a reason first, then queues one reopen with it; a worker has no reopen', async () => {
        seat('PrimaryOwner', OWNER);
        await openPlan([done('Disputed')]);
        const reopen = await screen.findByTestId(`plan-reopen-${T1}`);
        await act(async () => { fireEvent.click(reopen); });
        await act(async () => { fireEvent.click(screen.getByTestId(`plan-reopen-send-${T1}`)); });
        expect(await screen.findByTestId(`plan-reopen-need-${T1}`)).toHaveTextContent('कारण लिहा');
        expect(await queued(SyncMutationName.PlannedworkReopen)).toHaveLength(0);

        await act(async () => { fireEvent.change(screen.getByTestId(`plan-reopen-reason-${T1}`), { target: { value: '  काम नीट नाही  ' } }); });
        await act(async () => { fireEvent.click(screen.getByTestId(`plan-reopen-send-${T1}`)); });
        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkReopen)).toHaveLength(1));
        expect((await queued(SyncMutationName.PlannedworkReopen))[0].payload).toEqual({ plannedWorkId: T1, farmId: FARM, reason: 'काम नीट नाही' });
        await waitFor(() => expect(screen.getByTestId(`plan-${T1}`)).toHaveTextContent('फोनवर ठेवलं'));

        cleanup();
        seat('Worker', WORKER);
        await openPlan([done('Disputed')]);
        await screen.findByTestId(`plan-${T1}`);
        expect(screen.queryByTestId(`plan-reopen-${T1}`)).toBeNull();
    });
});

describe('English mode: English only', () => {
    it('the button, the card words and the sheet', async () => {
        h.language = 'en';
        const { rerender } = await openPlan([task(T1)]);
        const button = await screen.findByTestId(`plan-done-${T1}`);
        expect(button).toHaveTextContent('Work done');
        await act(async () => { fireEvent.click(button); });
        h.status = 'success'; h.saved = [LOG1, LOG2];
        await act(async () => { rerender(<AppRouter />); });
        const sheet = await screen.findByTestId('task-done-sheet');
        expect(sheet).toHaveTextContent('On which plot was it done?');
        expect(sheet).toHaveTextContent('All done');
        expect(sheet).toHaveTextContent('Some is left');
        // The sheet's own words are English only (the shared crop -> plot selector keeps its own stepper labels, as in the plan form).
        const own = ['task-done-all', 'task-done-left', 'task-done-notnow'].map(id => within(sheet).getByTestId(id).textContent ?? '');
        expect(within(sheet).getByTestId('task-done-plots').querySelector('h4')?.textContent).toBe('On which plot was it done?');
        expect(own.join(' ')).not.toMatch(/[ऀ-ॿ]/);
    });

    it('the owner\'s words on a done card', async () => {
        h.language = 'en';
        seat('PrimaryOwner', OWNER);
        await openPlan([task(T1, {
            status: 'Done', confirmationState: 'Waiting',
            plots: [{ plotId: P1, status: 'Done', linkedDailyLogIds: [LOG1] }, { plotId: P2, status: 'Done', linkedDailyLogIds: [LOG2] }],
        })]);
        const card = await screen.findByTestId(`plan-${T1}`);
        expect(within(card).getByTestId('plan-card-confirmation')).toHaveTextContent('Done · Approval pending');
        expect(within(card).getByTestId('plan-card-confirmation').textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(within(card).getByTestId(`plan-reopen-${T1}`)).toHaveTextContent('Open it again');
    });
});
