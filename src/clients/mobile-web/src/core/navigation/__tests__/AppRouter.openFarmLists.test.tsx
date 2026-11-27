// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 - every reader takes the OPEN farm's lists from the one seam (`useAppData` -> the app's data state), never a
 * second read of the phone's whole store: the router hands `data.crops`, `data.history` and the farm's people on to Home (the log
 * view), आढावा (reflect), तुलना (compare), and every simple route - शेड्यूल, लक्ष द्या, सेट-अप केंद्र - as they are. Here the data
 * state holds farm B's lists (the FIX-1 drive: owner of B, 1 plot); each reader is handed exactly those.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AppRouterContext } from '../routeContext';

const B_CROPS = [{ id: 'crop_tomato', name: 'टोमॅटो', plots: [{ id: 'b1', name: 'B1' }] }];
const B_LOGS = [{ id: 'lb', date: '2026-11-27', context: { selection: [] }, meta: { farmId: 'farm-b' } }];
const B_PEOPLE = [{ id: 'u-me', name: 'मी' }, { id: 'u-worker-b', name: 'ब कामगार' }];
const ALL_PEOPLE = [...B_PEOPLE, { id: 'u-worker-a', name: 'अ कामगार' }];

const h = vi.hoisted(() => ({
    simple: [] as AppRouterContext[],
    views: { log: [] as AppRouterContext[], reflect: [] as AppRouterContext[], compare: [] as AppRouterContext[] },
}));

vi.mock('../../../shared/utils/haptics', () => ({ hapticFeedback: { light: vi.fn(), medium: vi.fn(), heavy: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../shared/hooks/useUiPref', () => ({ useUiPref: () => [true, vi.fn()] as const }));
vi.mock('../../../app/context/AppFeatureContexts', () => ({
    useAppNavigationState: () => ({
        currentRoute: 'main', setCurrentRoute: vi.fn(), mainView: 'log', setMainView: vi.fn(),
        logIntent: null, setLogIntent: vi.fn(), lastLabourLogIds: [], goBackOr: vi.fn(),
    }),
    useAppLogState: () => ({
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: vi.fn(), currentLogContext: null, hasActiveLogContext: false, isContextReady: false,
    }),
    useAppDataState: () => ({
        isDemoMode: false, setIsDemoMode: vi.fn(),
        farmerProfile: { operators: ALL_PEOPLE, activeOperatorId: 'u-me' }, setFarmerProfile: vi.fn(),
        crops: B_CROPS, history: B_LOGS, mockHistory: B_LOGS, realHistory: B_LOGS, farmPeople: B_PEOPLE,
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
    useAppViewHelpers: () => ({ getTodayCounts: vi.fn(), getContextColorIndicator: vi.fn() }),
}));
vi.mock('../hooks/useAppRouterDerivations', () => ({
    useAppRouterDerivations: () => ({
        ownerDisplayName: 'मी', operatorNameById: new Map(), todayDateKey: '2026-11-27', yesterdayDate: '2026-11-26', todayLogs: [],
        todayDayState: {}, yesterdayDayState: {}, costSnapshot: {}, yesterdayCost: 0, getLogContextSnapshot: () => ({}),
    }),
}));
vi.mock('../../session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-b', currentFarm: { farmId: 'farm-b', role: 'PrimaryOwner' } }),
}));
vi.mock('../simpleRoutes', () => ({
    SIMPLE_ROUTE_RENDERERS: [],
    SimpleRoutes: ({ ctx }: { ctx: AppRouterContext }) => { h.simple.push(ctx); return null; },
}));
vi.mock('../mainView', () => ({
    renderReflectView: (ctx: AppRouterContext) => { h.views.reflect.push(ctx); return null; },
    renderCompareView: (ctx: AppRouterContext) => { h.views.compare.push(ctx); return null; },
    renderLogView: (ctx: AppRouterContext) => { h.views.log.push(ctx); return null; },
}));
vi.mock('../MainViewTransition', () => ({ default: (props: { children: React.ReactNode }) => <div>{props.children}</div> }));
vi.mock('../globalSheets', () => ({ renderGlobalSheets: () => null }));

import AppRouter from '../AppRouter';

afterEach(() => { cleanup(); h.simple.length = 0; h.views.log.length = 0; h.views.reflect.length = 0; h.views.compare.length = 0; });

describe('the router hands every reader the open farm\'s lists', () => {
    it('Home, आढावा, तुलना and every simple route (शेड्यूल, लक्ष द्या, सेट-अप केंद्र) get farm B\'s crops, entries and people', () => {
        render(<AppRouter />);
        const handed = [h.simple.at(-1), h.views.log.at(-1), h.views.reflect.at(-1), h.views.compare.at(-1)];
        for (const ctx of handed) {
            expect(ctx?.crops).toBe(B_CROPS);
            expect(ctx?.history).toBe(B_LOGS);
            expect(ctx?.farmPeople).toBe(B_PEOPLE);
        }
    });
});
