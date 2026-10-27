// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-3 = H05 = P-1 = MU-21)
 *
 * Founder, 2026-10-25 (PENDING-DECISIONS, answered): "Workers do not see तुलना." Pinned on every door:
 *   - the rule itself (`hiddenMainViewsFor`): Worker → तुलना hidden; owner / mukadam / unknown → nothing hidden;
 *   - the page switcher (`OversightNavCards`): no तुलना card for a worker, the other two share the row;
 *   - the swipe (`MainViewTransition`): never lands on तुलना, and does not start from it;
 *   - the router (`AppRouter`): hands the hidden list to the swipe and to every route, and sends a worker
 *     who is somehow on तुलना back to आजची कामे;
 *   - the tab render (`renderCompareView`): draws nothing for a worker.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppRouterContext } from '../routeContext';
import type { PageView } from '../../../types';

const h = vi.hoisted(() => ({
    role: 'Worker' as string | undefined,
    mainView: 'compare' as string,
    setMainView: vi.fn(),
    transitionProps: [] as Array<{ hiddenViews?: readonly string[] }>,
    ctxs: [] as AppRouterContext[],
}));

vi.mock('../../../shared/utils/haptics', () => ({ hapticFeedback: { light: vi.fn(), medium: vi.fn(), heavy: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../shared/hooks/useUiPref', () => ({ useUiPref: () => [true, vi.fn()] as const }));
vi.mock('../../../app/context/AppFeatureContexts', () => ({
    useAppNavigationState: () => ({
        currentRoute: 'main', setCurrentRoute: vi.fn(),
        mainView: h.mainView, setMainView: h.setMainView,
        logIntent: null, setLogIntent: vi.fn(), lastLabourLogIds: [], goBackOr: vi.fn(),
    }),
    useAppLogState: () => ({
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: vi.fn(), currentLogContext: null, hasActiveLogContext: false, isContextReady: false,
    }),
    useAppDataState: () => ({
        isDemoMode: false, setIsDemoMode: vi.fn(),
        farmerProfile: { operators: [], activeOperatorId: '' }, setFarmerProfile: vi.fn(),
        crops: [], mockHistory: [], realHistory: [],
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
        ownerDisplayName: 'Owner', operatorNameById: new Map(), todayDateKey: '2026-10-26', yesterdayDate: '2026-10-25', todayLogs: [],
        todayDayState: {}, yesterdayDayState: {}, costSnapshot: {}, yesterdayCost: 0, getLogContextSnapshot: () => ({}),
    }),
}));
vi.mock('../../session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-1', currentFarm: h.role ? { farmId: 'farm-1', role: h.role } : null }),
}));
// The router renders every simple route through `SimpleRoutes` (the nav lane's place reset); the stub
// captures the ctx each route is handed, exactly as the renderer list did.
vi.mock('../simpleRoutes', () => ({
    SIMPLE_ROUTE_RENDERERS: [(ctx: AppRouterContext) => { h.ctxs.push(ctx); return null; }],
    SimpleRoutes: ({ ctx }: { ctx: AppRouterContext }) => { h.ctxs.push(ctx); return null; },
}));
vi.mock('../mainView', () => ({ renderReflectView: () => null, renderCompareView: () => null, renderLogView: () => null }));
vi.mock('../MainViewTransition', () => ({
    default: (props: { hiddenViews?: readonly string[]; children: React.ReactNode }) => { h.transitionProps.push(props); return <div>{props.children}</div>; },
}));
vi.mock('../globalSheets', () => ({ renderGlobalSheets: () => null }));

import { hiddenMainViewsFor } from '../hiddenViews';
import AppRouter from '../AppRouter';
import OversightNavCards from '../../../features/oversight/components/OversightNavCards';
import { compareTabProps } from '../compareTab';
const RealTransition = (await vi.importActual<typeof import('../MainViewTransition')>('../MainViewTransition')).default;

afterEach(() => {
    cleanup();
    h.setMainView.mockClear();
    h.transitionProps.length = 0;
    h.ctxs.length = 0;
});

const swipe = (el: HTMLElement, fromX: number, toX: number) => {
    fireEvent.touchStart(el, { touches: [{ clientX: fromX, clientY: 400 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: toX, clientY: 400 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: toX, clientY: 400 }] });
};

describe('the rule: who may not open तुलना', () => {
    it('a worker: तुलना hidden; owner, partner, mukadam or an unknown role: nothing hidden', () => {
        expect(hiddenMainViewsFor('Worker')).toEqual(['compare']);
        for (const role of ['PrimaryOwner', 'SecondaryOwner', 'Mukadam', undefined, null]) {
            expect(hiddenMainViewsFor(role)).toEqual([]);
        }
    });
});

describe('the page switcher', () => {
    it('a worker sees आजची कामे and पूर्ण शेतीचा आढावा only — no तुलना card', () => {
        render(<OversightNavCards language="mr" view="log" onChange={vi.fn()} hiddenViews={hiddenMainViewsFor('Worker')} />);
        expect(screen.getByTestId('oversight-nav-card-log')).toBeInTheDocument();
        expect(screen.getByTestId('oversight-nav-card-reflect')).toBeInTheDocument();
        expect(screen.queryByTestId('oversight-nav-card-compare')).toBeNull();
        expect(screen.getByTestId('oversight-nav-cards').className).toContain('grid-cols-2');
    });

    it('an owner still sees all three', () => {
        render(<OversightNavCards language="mr" view="log" onChange={vi.fn()} hiddenViews={hiddenMainViewsFor('PrimaryOwner')} />);
        expect(screen.getByTestId('oversight-nav-card-compare')).toBeInTheDocument();
    });
});

describe('the swipe between tabs', () => {
    const worker = hiddenMainViewsFor('Worker');

    it('a worker swiping on from पूर्ण शेतीचा आढावा does not land on तुलना', () => {
        const onChangeView = vi.fn();
        render(<RealTransition view="reflect" onChangeView={onChangeView} disabled={false} hiddenViews={worker}><div /></RealTransition>);
        swipe(screen.getByTestId('main-view-transition'), 300, 180);
        expect(onChangeView).not.toHaveBeenCalled();
    });

    it('a worker still swipes between the two tabs he has', () => {
        const onChangeView = vi.fn();
        render(<RealTransition view="log" onChangeView={onChangeView} disabled={false} hiddenViews={worker}><div /></RealTransition>);
        swipe(screen.getByTestId('main-view-transition'), 300, 180);
        expect(onChangeView).toHaveBeenCalledExactlyOnceWith('reflect');
    });

    it('a swipe never starts from a hidden tab', () => {
        const onChangeView = vi.fn();
        render(<RealTransition view="compare" onChangeView={onChangeView} disabled={false} hiddenViews={worker}><div /></RealTransition>);
        swipe(screen.getByTestId('main-view-transition'), 180, 300);
        expect(onChangeView).not.toHaveBeenCalled();
    });

    it('an owner swipes from पूर्ण शेतीचा आढावा on to तुलना as before', () => {
        const onChangeView = vi.fn();
        render(<RealTransition view="reflect" onChangeView={onChangeView} disabled={false} hiddenViews={[]}><div /></RealTransition>);
        swipe(screen.getByTestId('main-view-transition'), 300, 180);
        expect(onChangeView).toHaveBeenCalledExactlyOnceWith('compare');
    });
});

describe('the router', () => {
    it('a worker: the swipe and every route get "तुलना hidden", and a worker on तुलना is sent back to आजची कामे', async () => {
        h.role = 'Worker';
        h.mainView = 'compare';
        await act(async () => { render(<AppRouter />); });
        expect(h.transitionProps.at(-1)?.hiddenViews).toEqual(['compare']);
        expect(h.ctxs.at(-1)?.hiddenViews).toEqual(['compare']);
        expect(h.setMainView).toHaveBeenCalledWith('log');
    });

    it('an owner: nothing hidden, nothing redirected', async () => {
        h.role = 'PrimaryOwner';
        h.mainView = 'compare';
        await act(async () => { render(<AppRouter />); });
        expect(h.transitionProps.at(-1)?.hiddenViews).toEqual([]);
        expect(h.setMainView).not.toHaveBeenCalled();
    });
});

describe('the तुलना tab render (what renderCompareView hands ComparePage)', () => {
    const ctx = (hiddenViews: readonly PageView[] | undefined, mainView = 'compare') => ({
        currentRoute: 'main', mainView, hiddenViews, crops: [], history: [],
        status: 'idle', draftLog: null, handleReset: vi.fn(),
        setLogScope: vi.fn(), setMode: vi.fn(), setMainView: vi.fn(), setCurrentRoute: vi.fn(),
    }) as unknown as AppRouterContext;

    it('draws nothing for a worker, and nothing when another tab is on', () => {
        expect(compareTabProps(ctx(['compare']))).toBeNull();
        expect(compareTabProps(ctx([], 'log'))).toBeNull();
    });

    it('for an owner: no back of its own; "झालं, सांगा" opens the log flow for that plot; शेड्यूल opens the schedule', () => {
        const c = ctx(undefined);
        const props = compareTabProps(c);
        expect(props).not.toBeNull();
        expect(props).not.toHaveProperty('onBack');
        props!.onTellPlot('grape', 'g1');
        expect(c.setLogScope).toHaveBeenCalledWith({ selectedCropIds: ['grape'], selectedPlotIds: ['g1'], mode: 'single', applyPolicy: 'broadcast' });
        expect(c.setMode).toHaveBeenCalledWith('voice');
        expect(c.setMainView).toHaveBeenCalledWith('log');
        props!.onOpenSchedule();
        expect(c.setCurrentRoute).toHaveBeenCalledWith('schedule');
    });

    it('"झालं, सांगा" with a draft waiting for plot A does NOT move it to plot B — the waiting draft is shown', () => {
        // a parsed draft waits at status 'idle' with `draftLog` set (`useVoiceRecorder`)
        const c = { ...ctx(undefined), status: 'idle', draftLog: { summary: 'plot A' } } as unknown as AppRouterContext;
        compareTabProps(c)!.onTellPlot('grape', 'g2');
        expect(c.setLogScope).not.toHaveBeenCalled();
        expect(c.handleReset).not.toHaveBeenCalled();
        expect(c.setMainView).toHaveBeenCalledWith('log');
    });

    it('"झालं, सांगा" right after a save opens a FRESH recorder for that plot, not the old saved screen', () => {
        const c = { ...ctx(undefined), status: 'success' } as unknown as AppRouterContext;
        compareTabProps(c)!.onTellPlot('grape', 'g1');
        expect(c.handleReset).toHaveBeenCalledTimes(1);
        expect(c.setLogScope).toHaveBeenCalledWith({ selectedCropIds: ['grape'], selectedPlotIds: ['g1'], mode: 'single', applyPolicy: 'broadcast' });
        expect(c.setMode).toHaveBeenCalledWith('voice');
        expect(c.setMainView).toHaveBeenCalledWith('log');
    });
});
