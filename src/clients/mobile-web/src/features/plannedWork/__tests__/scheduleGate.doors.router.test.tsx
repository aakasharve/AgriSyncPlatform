// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 3 phone half, Task 6; D-83 = 1 "records always open";
 * Review Focus 8; open point 9 (a)(b); P10, P11) - THE RECORD DOORS OPEN WITH NO CARD IN FRONT OF THEM.
 *
 * With the planning state of every plot saying NeedsSchedule (the worst case) and a checked schedule on the crop, through the REAL
 * `AppRouter` (real work home with the mic, real plan page, real "काम झालं"):
 *   - the log page and the mic open with no ask;
 *   - the list of work handed out, and "काम झालं" (which opens the normal recording), carry no ask - before or after the tap;
 *   - the control: the ask DOES stand in front of the new-planning form once a plot is chosen (so the state really is readable here);
 *   - a source scan: nothing that is a record door - the log, the mic, हजेरी, खरेदी / cost, मंजुरी - imports the ask, the gate hook or the
 *     planning-state reader (D-83); only new planning and the शेड्यूल page do. तुलना is not wired (open point 9 (a)).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';

configure({ asyncUtilTimeout: 6000 });

const h = vi.hoisted(() => ({
    farm: { farmId: '55555555-5555-4555-8555-555555555551', role: 'Worker' as string, authorities: undefined as undefined | Array<{ name: string; expiresAtUtc: string | null }> },
    userId: '11111111-1111-4111-8111-111111111111',
    status: 'idle' as string,
    setLogScope: vi.fn(),
    setMode: vi.fn(),
    setMainView: vi.fn(),
    route: 'main',
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
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr' }),
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
            const [mainView, setMainViewState] = react.useState<string>('log');
            const setMainView = (view: string) => { h.setMainView(view); setMainViewState(view); };
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
            mockHistory: [], realHistory: [],
            handleUpdateCrops: vi.fn(), handleAddPerson: vi.fn(), handleDeletePerson: vi.fn(),
            setLedgerDefaults: vi.fn(), ledgerDefaults: {}, userResources: [], setUserResources: vi.fn(),
            plannedTasks: [], handleSaveTask: vi.fn(), handleUpdateTask: vi.fn(),
            showTaskCreationSheet: false, setShowTaskCreationSheet: vi.fn(),
        }),
        useAppVoiceState: () => ({
            status: h.status, setStatus: vi.fn(), mode: 'voice', setMode: h.setMode,
            recordingSegment: null, setRecordingSegment: vi.fn(), handleAudioReady: vi.fn(), handleTextReady: vi.fn(),
            error: null, errorTranscript: null, draftLog: null, setDraftLog: vi.fn(), provenance: null,
            voiceStreamingPhase: null, liveCaption: null,
        }),
        useAppCommandsState: () => ({ handleManualSubmit: vi.fn(), handleUpdateNote: vi.fn() }),
        useAppWeatherState: () => ({ weatherData: undefined, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: vi.fn() }),
        useAppTrustState: () => ({ handleVerifyLog: vi.fn() }),
        useAppUiRuntime: () => ({ handleReset: vi.fn(), lastSavedLogSummary: [], lastSavedLogIds: [] }),
        useAppViewHelpers: () => ({ getTodayCounts: vi.fn(), getContextColorIndicator: () => null }),
    };
});
vi.mock('../../../core/navigation/hooks/useAppRouterDerivations', () => ({
    useAppRouterDerivations: () => ({
        ownerDisplayName: 'Owner', operatorNameById: new Map(), todayDateKey: '2026-11-09', yesterdayDate: '2026-11-08', todayLogs: [],
        todayDayState: { closurePercent: 0, isClosed: false, hasStarted: false, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        yesterdayDayState: { closurePercent: 0, isClosed: false, hasStarted: false, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0, scopeLabel: '' }, yesterdayCost: 0, getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
    }),
}));
vi.mock('../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({
        currentFarmId: h.farm.farmId,
        currentFarm: { ...h.farm },
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
import { setScheduleTemplatesFromReferenceData } from '../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE } from '../../scheduler/schedulePage/__tests__/scheduleFixtures';

const FARM = '55555555-5555-4555-8555-555555555551';
const OWNER = '22222222-2222-4222-8222-222222222222';
const WORKER = '11111111-1111-4111-8111-111111111111';
const P1 = '44444444-4444-4444-8444-444444444441';
const P2 = '44444444-4444-4444-8444-444444444442';
const T1 = '33333333-3333-4333-8333-333333333331';

const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const CANE_SCHEDULE = { ...SERVER_TEMPLATE, id: '10000000-0000-4000-8000-0000000000c1', name: 'ऊस विद्यापीठ शेड्यूल', cropType: 'Sugarcane', versionHash: 'h', ownerType: 'INSTITUTION', check: checkedBy, hasStoredDays: true };

const needs = (plotId: string) => ({ plotId, cropCycleId: null, inTrial: false, followsAllowed: false, canFollowSomething: true, trialStage: null, needsSchedule: true });
const task = (over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id: T1, farmId: FARM, title: 'युरिया टाकणे', scope: 'MultiPlot', plannedDate: '2026-11-10', looseWhen: null, plannedTime: null,
    assigneeUserId: WORKER, crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null,
    status: 'Accepted', source: 'Planning', sourceKind: 'PlanForm', recordedOn: '2026-11-08', linkedDailyLogIds: [],
    createdByUserId: OWNER, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z',
    plots: [{ plotId: P1, status: 'Pending', linkedDailyLogIds: [] }, { plotId: P2, status: 'Pending', linkedDailyLogIds: [] }],
    ...over,
});
/** A real pull: the planned work AND the server's planning state - every plot of the farm needs a schedule. */
const pull = (): SyncPullResponse => ({
    serverTimeUtc: '2026-11-09T07:00:00.000Z', nextCursorUtc: '2026-11-09T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', plannedWork: [task()], plotPlanningState: [needs(P1), needs(P2)],
} as unknown as SyncPullResponse);
const seat = (role: string, userId: string, authorities?: string[]) => {
    h.farm = { farmId: FARM, role, authorities: authorities?.map(name => ({ name, expiresAtUtc: null })) };
    h.userId = userId;
};
const anyAsk = () => document.querySelectorAll('[data-testid^="schedule-ask"]');
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
const open = async () => {
    let utils!: ReturnType<typeof render>;
    await act(async () => { utils = render(<AppRouter />); });
    return utils;
};

beforeEach(async () => {
    vi.clearAllMocks();
    h.status = 'idle';
    h.route = 'main';
    seat('Worker', WORKER, []);
    setScheduleTemplatesFromReferenceData([CANE_SCHEDULE]);
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
    // the catalog the pull would set is kept (the real pull of this test carries no templates)
    await reconcileSyncPull(pull());
    setScheduleTemplatesFromReferenceData([CANE_SCHEDULE]);
});
afterEach(cleanup);

describe('the record doors open with no ask (D-83 = 1)', () => {
    it('The_log_page_and_the_mic_open_with_no_card: every plot needs a schedule, the home is the home', async () => {
        for (const [role, userId, authorities] of [['PrimaryOwner', OWNER, undefined], ['Worker', WORKER, []]] as Array<[string, string, string[] | undefined]>) {
            seat(role, userId, authorities);
            const { unmount } = await open();
            expect(await screen.findByTestId('work-home')).toBeInTheDocument(); // the work home (the log page) is up
            const mic = await screen.findByTestId('home-tell'); // and its mic button
            await settle();
            expect(anyAsk()).toHaveLength(0);
            await act(async () => { fireEvent.click(mic); }); // the mic opens the recording
            await settle();
            expect(anyAsk()).toHaveLength(0);
            unmount();
        }
    });

    it('Handed_out_work_and_"काम झालं"_carry_no_ask: the list, the card, the tap and the recording it opens', async () => {
        h.route = 'plan-work';
        seat('Worker', WORKER, []);
        await open();
        const done = await screen.findByTestId(`plan-done-${T1}`);
        expect(done).toHaveTextContent('काम झालं');
        await settle();
        expect(anyAsk()).toHaveLength(0);
        await act(async () => { fireEvent.click(done); });
        expect(h.setLogScope).toHaveBeenCalledTimes(1); // the normal recording opened on the task's plots
        await settle();
        expect(anyAsk()).toHaveLength(0);
    });

    it('The_planner\'s_list_of_handed_out_work_carries_no_ask: only the form can ask, and only once a plot is chosen', async () => {
        h.route = 'plan-work';
        seat('PrimaryOwner', OWNER, undefined);
        await open();
        await screen.findByTestId(`plan-${T1}`);
        await settle();
        expect(anyAsk()).toHaveLength(0); // the form is open, no place chosen, the list is full: nothing asks
        // the control: choose a plot that needs a schedule, and the ask stands in front of the form
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(await screen.findByTestId(`flow-plot-${P1}`));
        const ask = await screen.findByTestId('schedule-ask');
        expect(ask).toHaveAttribute('data-where', 'planning');
        expect(screen.getByTestId('plan-form').compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
        expect(screen.getByTestId('plan-list').querySelector('[data-testid^="schedule-ask"]')).toBeNull();
        expect(screen.getByTestId(`plan-${T1}`).querySelector('[data-testid^="schedule-ask"]')).toBeNull();
        await waitFor(() => expect(screen.getByTestId('plan-submit')).toBeDisabled());
    });
});

describe('source scan: no record door imports the ask or the planning-state reader (D-83)', () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const SRC = join(HERE, '..', '..', '..');
    const walk = (dir: string, out: string[] = []): string[] => {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) {
                if (name === '__tests__' || name === 'node_modules') continue;
                walk(full, out);
            } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
        }
        return out;
    };
    const rel = (file: string) => relative(SRC, file).split(sep).join('/');
    const GATE_MODULES = /(?:from\s+|import\s*\(\s*)['"][^'"]*\/(ScheduleAsk|useScheduleGate|planningStateStore|planningStateDtos)['"]/;
    // The ONLY places that may read the planning state or draw the ask: new planning, the शेड्यूल page and what feeds them.
    const ALLOWED = new Set([
        'pages/SchedulerPage.tsx',
        'features/plannedWork/components/PlanWorkPage.tsx',
        'features/scheduler/schedulePage/ScheduleAsk.tsx',
        'features/scheduler/schedulePage/useScheduleGate.ts',
        'features/scheduler/schedulePage/TrialStages.tsx',
        'features/scheduler/schedulePage/PlotScheduleHome.tsx',
        'features/sync/pull/reconcilers/planningStateReconciler.ts',
        'infrastructure/storage/planningStateStore.ts',
    ]);

    it('The_scan_catches_a_static_and_a_dynamic_import', () => {
        expect(GATE_MODULES.test("import { ScheduleAsk } from '../x/ScheduleAsk';")).toBe(true);
        expect(GATE_MODULES.test("const m = await import('../x/useScheduleGate');")).toBe(true);
        expect(GATE_MODULES.test("import { y } from '../x/Other';")).toBe(false);
    });

    it('Only_planning_and_the_schedule_page_import_the_gate: every other importer fails this test', () => {
        const importers = walk(SRC).filter(f => GATE_MODULES.test(readFileSync(f, 'utf8'))).map(rel).sort();
        expect(importers.filter(f => !ALLOWED.has(f))).toEqual([]);
        // and the two pages that may ask really do (the scan reads the right thing)
        expect(importers).toContain('pages/SchedulerPage.tsx');
        expect(importers).toContain('features/plannedWork/components/PlanWorkPage.tsx');
    });

    it('The_record_doors_never_name_the_gate: log, mic, attendance, cost, approval, तुलना hold none of its words', () => {
        const DOORS = ['features/logs', 'features/voice', 'features/labour', 'features/finance', 'features/approval', 'features/attention', 'features/compare', 'application', 'core/navigation'];
        const WORDS = /needsSchedule|plotPlanningState|useScheduleGate|ScheduleAsk|schedule-ask|PLOT_PLANNING_STATE_META_KEY/;
        const hits = DOORS.flatMap(dir => {
            try { return walk(join(SRC, dir)); } catch { return []; }
        }).filter(f => WORDS.test(readFileSync(f, 'utf8'))).map(rel);
        expect(hits).toEqual([]);
    });
});
