// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2 Task 1; founder D-24, D-26, D-79, P5) - the plan door on the work home and
 * the route behind it, through the REAL `AppRouter` (real `renderLogView`, real `LogEntryFlow`, real `WorkHome`, real `SimpleRoutes`, real
 * plan page; only the contexts the router reads and the mic hardware are stubbed):
 *   - the primary owner and a holder of AssignWork (or PlanWork) see "कामांची जबाबदारी सोपवा / कामांचे नियोजन करा" with "N कामे चालू";
 *   - a plain worker - and a सहमालक or मुकादम the server gave nothing, and a seat whose authorities the phone does not know - sees
 *     "तुमच्यावर सोपवलेली कामे" with his own count (D-26: the label grants nothing; unknown fails closed);
 *   - the door opens the route 'plan-work' from both, and the page that opens is the planner's or the assignee's by the same answer;
 *   - English mode shows English only.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../../../infrastructure/api/plannedWorkDtos';

const h = vi.hoisted(() => ({
    farm: { farmId: 'farm-1', role: 'PrimaryOwner' as string, authorities: undefined as undefined | Array<{ name: string; expiresAtUtc: string | null }> },
    userId: '22222222-2222-4222-8222-222222222222',
    language: 'mr' as 'mr' | 'en',
    route: 'main',
}));

vi.mock('../../../../../shared/utils/haptics', () => ({ hapticFeedback: { light: vi.fn(), medium: vi.fn(), heavy: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../../shared/hooks/useUiPref', () => ({ useUiPref: () => [true, vi.fn()] as const }));
vi.mock('../../../../../features/voice/components/AudioRecorder', () => ({ default: () => <div data-stub="audio" /> }));
vi.mock('../../../../../features/voice/components/AudioRecorderStreaming', () => ({ default: () => <div data-stub="audio-streaming" /> }));
vi.mock('../../../../../features/voice/components/LiveCaption', () => ({ default: () => null }));
vi.mock('../../../../appUpdate/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
vi.mock('../../../../logs/components/LedgerRecognitionPanel', () => ({ LedgerRecognitionPanel: () => null }));
vi.mock('../../../../logs/components/voiceResult/VoiceResultContainer', () => ({ VoiceResultContainer: () => null }));
vi.mock('../../../../plannedWork/components/PlanMic', () => ({ PlanMic: () => <button type="button" data-testid="plan-mic">mic</button> }));
vi.mock('../../../../plannedWork/data/plannedWorkAssignees', () => ({
    loadAssignees: async () => ({
        assignees: [{ userId: '11111111-1111-4111-8111-111111111112', displayName: 'शंकर', role: 'Mukadam', plotScope: 'AllPlots', plotIds: [] }],
        source: 'server', receivedAtUtc: 'x',
    }),
}));
vi.mock('../../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: h.language }),
}));
vi.mock('../../../../../app/featureFlags', () => ({
    FEATURE_FLAGS: { dailyLoop: false, voiceContinuity: false, taskCloseConfirm: false, understandingMeter: false },
    IS_E2E_HARNESS_ENABLED: false,
    isE2EHarnessEnabled: () => false,
    isFarmGeographyV2Enabled: () => false,
    isWeatherBackendFetchEnabled: () => false,
    isVoiceDoomLoopDetectorEnabled: () => true,
}));
vi.mock('../../../../../app/context/AppFeatureContexts', async () => {
    const react = await import('react');
    return {
        // A real, stateful route: the door's tap really moves the router.
        useAppNavigationState: () => {
            const [currentRoute, setCurrentRoute] = react.useState<string>(h.route);
            return {
                currentRoute, setCurrentRoute, mainView: 'log', setMainView: vi.fn(), logIntent: null, setLogIntent: vi.fn(),
                lastLabourLogIds: [], goBackOr: (to: string) => setCurrentRoute(to), openPlace: vi.fn(), placeResetKey: 0,
                logHomePending: false, consumeLogHome: vi.fn(),
            };
        },
        useAppLogState: () => ({
            logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
            setLogScope: vi.fn(), currentLogContext: null, hasActiveLogContext: false, isContextReady: false,
        }),
        useAppDataState: () => ({
            isDemoMode: false, setIsDemoMode: vi.fn(),
            farmerProfile: { operators: [], activeOperatorId: '' }, setFarmerProfile: vi.fn(),
            crops: [{ id: 'cane', name: 'ऊस', iconName: 'Sugarcane', color: 'emerald', plots: [{ id: '44444444-4444-4444-8444-444444444441', name: 'ऊस 1' }] }],
            mockHistory: [], realHistory: [],
            handleUpdateCrops: vi.fn(), handleAddPerson: vi.fn(), handleDeletePerson: vi.fn(),
            setLedgerDefaults: vi.fn(), ledgerDefaults: {}, userResources: [], setUserResources: vi.fn(),
            plannedTasks: [], handleSaveTask: vi.fn(), handleUpdateTask: vi.fn(),
            showTaskCreationSheet: false, setShowTaskCreationSheet: vi.fn(),
        }),
        useAppVoiceState: () => ({
            status: 'idle', setStatus: vi.fn(), mode: 'voice', setMode: vi.fn(),
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
vi.mock('../../../../../core/navigation/hooks/useAppRouterDerivations', () => ({
    useAppRouterDerivations: () => ({
        ownerDisplayName: 'Owner', operatorNameById: new Map(), todayDateKey: '2026-11-08', yesterdayDate: '2026-11-07', todayLogs: [],
        todayDayState: { closurePercent: 0, isClosed: false, hasStarted: false, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        yesterdayDayState: { closurePercent: 0, isClosed: false, hasStarted: false, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0, scopeLabel: '' }, yesterdayCost: 0, getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
    }),
}));
vi.mock('../../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({
        currentFarmId: 'farm-1',
        currentFarm: { ...h.farm, farmId: 'farm-1' },
        meContext: { me: { userId: h.userId } },
    }),
    useOptionalFarmContext: () => null,
}));
vi.mock('../../../../../core/navigation/MainViewTransition', () => ({ default: (p: { children: React.ReactNode }) => <div>{p.children}</div> }));
vi.mock('../../../../../core/navigation/globalSheets', () => ({ renderGlobalSheets: () => null }));
vi.mock('../../../../../core/speak/SpeakHost', () => ({ SpeakHost: () => null }));

import AppRouter from '../../../../../core/navigation/AppRouter';
import { WorkHome } from '../WorkHome';
import { reconcileSyncPull } from '../../../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';

const OWNER = '22222222-2222-4222-8222-222222222222';
const SANTOSH = '33333333-3333-4333-8333-333333333399';
const WORKER = '11111111-1111-4111-8111-111111111111';
const task = (id: string, over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id, farmId: 'farm-1', title: 'फवारणी', scope: 'Farm', plannedDate: '2026-11-10', looseWhen: null, plannedTime: null,
    assigneeUserId: WORKER, crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null,
    status: 'Accepted', source: 'Planning', sourceKind: 'PlanForm', recordedOn: '2026-11-08', linkedDailyLogIds: [],
    createdByUserId: OWNER, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z', plots: [],
    ...over,
});
const id = (n: number) => `33333333-3333-4333-8333-33333333330${n}`;
const pull = (plannedWork: PlannedWorkDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', plannedWork,
} as unknown as SyncPullResponse);

const seat = (role: string, authorities?: string[], userId = OWNER) => {
    h.farm = { farmId: 'farm-1', role, authorities: authorities?.map(name => ({ name, expiresAtUtc: null })) };
    h.userId = userId;
};

beforeEach(async () => {
    h.route = 'main';
    h.language = 'mr';
    seat('PrimaryOwner');
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
    // what the server let this phone see: 2 open tasks (one for the worker), 1 done, 1 cancelled, 1 reminder of the owner's
    await reconcileSyncPull(pull([
        task(id(1)),
        task(id(2), { assigneeUserId: SANTOSH, status: 'Assigned' }),
        task(id(3), { status: 'Done' }),
        task(id(4), { status: 'Cancelled' }),
        task(id(5), { assigneeUserId: null, status: 'Open', createdByUserId: OWNER }),
        task(id(6), { farmId: 'other-farm' }),
    ]));
});
afterEach(cleanup);

const openHome = async () => { await act(async () => { render(<AppRouter />); }); return screen.findByTestId('home-plan'); };

describe('the door by seat (D-26: the server\'s authorities, never a label)', () => {
    it('the primary owner: the plan door with the count of open work (not done, not cancelled, this farm only)', async () => {
        const door = await openHome();
        expect(door).toHaveAttribute('data-kind', 'plan');
        expect(within(door).getByTestId('home-plan-title')).toHaveTextContent('कामांची जबाबदारी सोपवा / कामांचे नियोजन करा');
        await waitFor(() => expect(within(door).getByTestId('home-plan-count')).toHaveAttribute('data-count', '3'));
        expect(within(door).getByTestId('home-plan-count')).toHaveTextContent('3 कामे चालू');
    });

    it('a मुकादम holding AssignWork, and one holding only PlanWork: the plan door', async () => {
        for (const authorities of [['AssignWork'], ['PlanWork']]) {
            seat('Mukadam', authorities, WORKER);
            const { unmount } = render(<AppRouter />);
            expect(await screen.findByTestId('home-plan')).toHaveAttribute('data-kind', 'plan');
            unmount();
        }
    });

    it('a plain worker: "तुमच्यावर सोपवलेली कामे" and his own count (his, open, not a reminder)', async () => {
        seat('Worker', [], WORKER);
        const door = await openHome();
        expect(door).toHaveAttribute('data-kind', 'mine');
        expect(within(door).getByTestId('home-plan-title')).toHaveTextContent('तुमच्यावर सोपवलेली कामे');
        await waitFor(() => expect(within(door).getByTestId('home-plan-count')).toHaveAttribute('data-count', '1'));
        expect(within(door).getByTestId('home-plan-count')).toHaveTextContent('1 कामे चालू');
        expect(door.textContent).not.toContain('नियोजन करा');
    });

    it('a सहमालक or मुकादम the server gave nothing, and a seat whose authorities the phone does not know: only his own work', async () => {
        for (const [role, authorities] of [['SecondaryOwner', []], ['Mukadam', ['TakeAttendance']], ['Mukadam', undefined], ['SecondaryOwner', undefined]] as Array<[string, string[] | undefined]>) {
            seat(role, authorities, WORKER);
            const { unmount } = render(<AppRouter />);
            expect(await screen.findByTestId('home-plan')).toHaveAttribute('data-kind', 'mine');
            unmount();
        }
    });
});

describe('the route opens from both, through the real router', () => {
    it('the owner taps the door: the planner\'s page (form, mic, list of every open work)', async () => {
        const door = await openHome();
        await act(async () => { fireEvent.click(door); });
        const page = await screen.findByTestId('plan-work');
        expect(page).toHaveAttribute('data-can-plan', 'yes');
        expect(screen.getByTestId('plan-title')).toHaveTextContent('कामाचे नियोजन');
        expect(screen.getByTestId('plan-form')).toBeInTheDocument();
        expect(screen.getByTestId('plan-mic')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId(`plan-${id(2)}`)).toBeInTheDocument());
        // the home is gone behind it
        expect(screen.queryByTestId('work-home')).toBeNull();
    });

    it('a मुकादम with AssignWork taps the door: the same page, and he may choose another person', async () => {
        seat('Mukadam', ['AssignWork'], WORKER);
        const door = await openHome();
        await act(async () => { fireEvent.click(door); });
        expect(await screen.findByTestId('plan-work')).toHaveAttribute('data-can-plan', 'yes');
        await waitFor(() => expect(screen.getByTestId('plan-assign-11111111-1111-4111-8111-111111111112')).toBeInTheDocument());
    });

    it('a मुकादम with PlanWork only: the page and form, but only "स्वतः" and "फक्त आठवण" to choose', async () => {
        seat('Mukadam', ['PlanWork'], WORKER);
        const door = await openHome();
        await act(async () => { fireEvent.click(door); });
        expect(await screen.findByTestId('plan-work')).toHaveAttribute('data-can-plan', 'yes');
        const chips = await screen.findByTestId('plan-assignees');
        expect(Array.from(chips.querySelectorAll('button')).map(b => b.textContent)).toEqual(['स्वतः', 'फक्त आठवण (कोणालाही नाही)']);
    });

    it('a plain worker taps the door: no form, only the work handed to him, with "ठीक आहे, करतो"', async () => {
        seat('Worker', [], WORKER);
        // his task, seen already, so that the accept button is the thing on the card
        await reconcileSyncPull(pull([task(id(1), { status: 'Seen' })]));
        const door = await openHome();
        await act(async () => { fireEvent.click(door); });
        const page = await screen.findByTestId('plan-work');
        expect(page).toHaveAttribute('data-can-plan', 'no');
        expect(screen.getByTestId('plan-title')).toHaveTextContent('तुमच्यावर सोपवलेली कामे');
        expect(screen.queryByTestId('plan-form')).toBeNull();
        expect(await screen.findByTestId(`plan-accept-${id(1)}`)).toHaveTextContent('ठीक आहे, करतो');
        expect(screen.queryByTestId(`plan-${id(2)}`)).toBeNull();
    });

    it('the page\'s back goes to the home again', async () => {
        const door = await openHome();
        await act(async () => { fireEvent.click(door); });
        await screen.findByTestId('plan-work');
        await act(async () => { fireEvent.click(screen.getByTestId('plan-back')); });
        expect(await screen.findByTestId('home-plan')).toBeInTheDocument();
    });
});

describe('English mode: English only', () => {
    it('the door for a planner and for a worker', async () => {
        h.language = 'en';
        const planner = await openHome();
        expect(within(planner).getByTestId('home-plan-title')).toHaveTextContent('Hand over work / Plan the work');
        expect(planner.textContent).not.toMatch(/[ऀ-ॿ]/);
        cleanup();
        seat('Worker', [], WORKER);
        const mine = await openHome();
        expect(within(mine).getByTestId('home-plan-title')).toHaveTextContent('Work handed to you');
        await waitFor(() => expect(within(mine).getByTestId('home-plan-count')).toHaveTextContent('1 works open'));
        expect(mine.textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});

describe('WorkHome alone', () => {
    it('draws no plan door without one (no farm yet), and the door calls its own onOpen', () => {
        const { rerender } = render(<WorkHome onTell={vi.fn()} />);
        expect(screen.queryByTestId('home-plan')).toBeNull();
        const onOpen = vi.fn();
        rerender(<WorkHome onTell={vi.fn()} planDoor={{ kind: 'plan', farmId: 'farm-1', userId: OWNER, onOpen }} />);
        fireEvent.click(screen.getByTestId('home-plan'));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});
