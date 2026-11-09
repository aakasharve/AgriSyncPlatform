// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Task 3; founder D-1, D-29, D-78 = 1, P3, P10) - ONE list through the REAL `AppRouter`
 * (real plan route, real लक्ष द्या route, real cards; only the contexts the router reads and the mic hardware are stubbed, and the app's
 * data layer is the real `useOneTaskList`):
 *   - a reminder made from what he said shows on the plan list with "बोलण्यातून", its plot and its day, and ONE tap removes it (a cancel);
 *   - the same late reminder is on the लक्ष द्या route once, "झाले" there is a complete with no log, and an undated one is never listed late;
 *   - another farm's reminder is on neither.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';

configure({ asyncUtilTimeout: 6000 });

const PLOTS = new Set(['44444444-4444-4444-8444-444444444441', '44444444-4444-4444-8444-444444444442']);
const h = vi.hoisted(() => ({
    farm: { farmId: '55555555-5555-4555-8555-555555555551', role: 'Worker' as string },
    userId: '11111111-1111-4111-8111-111111111111',
    language: 'mr' as 'mr' | 'en',
    route: 'plan-work',
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
vi.mock('../../attention/hooks/useAttentionBoard', () => ({
    useAttentionBoard: () => ({ cards: [], asOf: null, isLoading: false, loadFailed: false, scheduledWork: null, refresh: vi.fn() }),
}));
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
    const { useOneTaskList } = await import('../data/useOneTaskList');
    const demo = { tasks: [], save: () => {}, update: () => {} };
    return {
        useAppNavigationState: () => {
            const [currentRoute, setCurrentRoute] = react.useState<string>(h.route);
            const [mainView, setMainView] = react.useState<string>('log');
            return {
                currentRoute, setCurrentRoute, mainView, setMainView, logIntent: null, setLogIntent: vi.fn(),
                lastLabourLogIds: [], goBackOr: (to: string) => setCurrentRoute(to), openPlace: vi.fn(), placeResetKey: 0,
                logHomePending: false, consumeLogHome: vi.fn(),
            };
        },
        useAppLogState: () => ({
            logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
            setLogScope: vi.fn(), currentLogContext: null, hasActiveLogContext: false, isContextReady: false,
        }),
        useAppDataState: () => {
            // Lane L8c-4: the ONE list - the real hook the app's data layer uses, over the phone database.
            const one = useOneTaskList({ farmId: h.farm.farmId, userId: h.userId, isDemoMode: false, knownPlotIds: PLOTS, demo });
            return {
                isDemoMode: false, setIsDemoMode: vi.fn(),
                farmerProfile: { operators: [], activeOperatorId: '' }, setFarmerProfile: vi.fn(),
                crops: [{
                    id: 'cane', name: 'ऊस', iconName: 'Sugarcane', color: 'emerald',
                    plots: [{ id: '44444444-4444-4444-8444-444444444441', name: 'ऊस 1' }, { id: '44444444-4444-4444-8444-444444444442', name: 'ऊस 2' }],
                }],
                mockHistory: [], realHistory: [],
                handleUpdateCrops: vi.fn(), handleAddPerson: vi.fn(), handleDeletePerson: vi.fn(),
                setLedgerDefaults: vi.fn(), ledgerDefaults: {}, userResources: [], setUserResources: vi.fn(),
                plannedTasks: one.tasks, handleSaveTask: one.save, handleUpdateTask: one.update,
                showTaskCreationSheet: false, setShowTaskCreationSheet: vi.fn(),
            };
        },
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
vi.mock('../../../core/navigation/hooks/useAppRouterDerivations', () => ({
    useAppRouterDerivations: () => ({
        ownerDisplayName: 'Owner', operatorNameById: new Map(), todayDateKey: '2026-11-08', yesterdayDate: '2026-11-07', todayLogs: [],
        todayDayState: { closurePercent: 0, isClosed: false, hasStarted: false, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        yesterdayDayState: { closurePercent: 0, isClosed: false, hasStarted: false, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0, scopeLabel: '' }, yesterdayCost: 0, getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
    }),
}));
vi.mock('../../../core/session/FarmContext', () => {
    const farm = {
        currentFarmId: '55555555-5555-4555-8555-555555555551', currentFarm: { farmId: '55555555-5555-4555-8555-555555555551', role: 'PrimaryOwner', authorities: undefined },
        meContext: { me: { userId: '11111111-1111-4111-8111-111111111111' } },
    };
    return { useFarmContext: () => farm, useOptionalFarmContext: () => farm };
});
vi.mock('../../../core/navigation/MainViewTransition', () => ({ default: (p: { children: React.ReactNode }) => <div>{p.children}</div> }));
vi.mock('../../../core/navigation/globalSheets', () => ({ renderGlobalSheets: () => null }));
vi.mock('../../../core/speak/SpeakHost', () => ({ SpeakHost: () => null }));

import AppRouter from '../../../core/navigation/AppRouter';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const ME = '11111111-1111-4111-8111-111111111111';
const P1 = '44444444-4444-4444-8444-444444444441';
const SPOKEN = '33333333-3333-4333-8333-333333333331';
const LATE = '33333333-3333-4333-8333-333333333332';
const UNDATED = '33333333-3333-4333-8333-333333333333';
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
const queued = async (type: string) => getDatabase().mutationQueue.where('mutationType').equals(type).toArray();

beforeEach(async () => {
    vi.clearAllMocks();
    h.language = 'mr';
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
});
afterEach(cleanup);

const openAt = async (route: string, rows: PlannedWorkDto[]) => {
    h.route = route;
    await reconcileSyncPull(pull(rows));
    await act(async () => { render(<AppRouter />); });
    await act(async () => { window.dispatchEvent(new Event('agrisync:sync-reconciled')); });
};

describe('ONE list through the real AppRouter', () => {
    it('a reminder made from what he said: "बोलण्यातून", its plot, its day - and ONE tap removes it', async () => {
        await openAt('plan-work', [row(SPOKEN, {
            sourceKind: 'Spoken', source: 'VoiceLog', scope: 'Unspecified', sourcePlotId: P1, sourceDailyLogId: '66666666-6666-4666-8666-666666666661',
            plannedDate: '2026-11-09', recordedOn: '2026-11-08', title: 'पाईपलाईन दुरुस्त करायची',
        })]);

        const card = await screen.findByTestId(`plan-${SPOKEN}`);
        expect(within(card).getByTestId('plan-card-source')).toHaveTextContent(/^बोलण्यातून · ऊस 1 · (?!\d{4}-\d{2}-\d{2})/);
        expect(within(card).getByTestId('plan-card-who')).toHaveTextContent('फक्त आठवण'); // his own, handed to nobody

        await act(async () => { fireEvent.click(within(card).getByTestId(`plan-remove-${SPOKEN}`)); });

        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkCancel)).toHaveLength(1));
        expect((await queued(SyncMutationName.PlannedworkCancel))[0].payload).toMatchObject({ plannedWorkId: SPOKEN, farmId: FARM });
        expect(await getDatabase().plannedWork.get(SPOKEN)).toBeDefined(); // cancelled, never deleted
    });

    it('the same late reminder is once on लक्ष द्या, "झाले" there is a complete with NO log, and the undated one is never listed late', async () => {
        await openAt('attention', [
            row(LATE, { plannedDate: '2026-11-01', title: 'देरीचं काम' }),
            row(UNDATED, { plannedDate: null, title: 'बिन तारखेचं' }),
            row(ELSEWHERE, { farmId: OTHER_FARM, plannedDate: '2026-11-01', title: 'दुसऱ्या शेताचं' }),
        ]);

        const late = await screen.findByTestId(`attention-reminder-${LATE}`);
        expect(screen.getAllByTestId(`attention-reminder-${LATE}`)).toHaveLength(1);
        expect(screen.queryByTestId(`attention-reminder-${UNDATED}`)).toBeNull();
        expect(screen.queryByTestId(`attention-reminder-${ELSEWHERE}`)).toBeNull();

        await act(async () => { fireEvent.click(within(late).getByTestId(`attention-done-${LATE}`)); });

        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkComplete)).toHaveLength(1));
        expect((await queued(SyncMutationName.PlannedworkComplete))[0].payload)
            .toEqual({ plannedWorkId: LATE, farmId: FARM, plotIds: [], dailyLogIds: [], somethingLeft: false });
        await waitFor(() => expect(screen.queryByTestId(`attention-reminder-${LATE}`)).toBeNull());
    });
});
