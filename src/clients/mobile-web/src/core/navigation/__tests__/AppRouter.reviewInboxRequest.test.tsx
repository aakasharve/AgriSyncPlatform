// spec: owner-oversight-loop (finding F2)
// @vitest-environment jsdom
//
// The far end of the drawer's `approval` row.
//
// `WaitingDrawer` renders "६ कामे तपासायची आहेत" with a chevron; `AppHeader`
// turns a tap on it into `requestOpenReviewInbox()`. That is only half a
// destination — this file pins the other half: `AppRouter` really does hear
// the request and really does open `ReviewInboxSheet`, the app's existing
// batch approve/dispute surface.
//
//   the_review_inbox_opens_when_the_waiting_drawer_requests_it
//
// AppRouter cannot be mounted without the whole `AppFeatureProviders` tree,
// so its nine context hooks, its derivations hook, its UI-pref hook and its
// four render modules are stubbed down to the minimum this one wiring
// question needs. `renderGlobalSheets` is stubbed to expose ONLY
// `ctx.showReviewInbox` — the exact boolean that drives the real
// `ReviewInboxSheet`'s `isOpen` prop in `globalSheets.tsx` — so the assertion
// is about the state this hop must set, not about the sheet's internals
// (covered by its own suite).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act } from '@testing-library/react';

import type { AppRouterContext } from '../routeContext';
import { requestOpenReviewInbox } from '../../../features/oversight/oversightNavigationEvents';

vi.mock('../../../shared/hooks/useUiPref', () => ({
    // Past the welcome + permissions gates, straight to the router body.
    useUiPref: () => [true, vi.fn()] as const,
}));

vi.mock('../../../app/context/AppFeatureContexts', () => ({
    useAppNavigationState: () => ({
        currentRoute: 'main', setCurrentRoute: vi.fn(),
        mainView: 'log', setMainView: vi.fn(),
        logIntent: null, setLogIntent: vi.fn(), lastLabourLogIds: [],
    }),
    useAppLogState: () => ({
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: vi.fn(), currentLogContext: null,
        hasActiveLogContext: false, isContextReady: false,
    }),
    useAppDataState: () => ({
        isDemoMode: false, setIsDemoMode: vi.fn(),
        farmerProfile: { operators: [], activeOperatorId: '' }, setFarmerProfile: vi.fn(),
        crops: [], mockHistory: [], realHistory: [],
        handleUpdateCrops: vi.fn(), handleAddPerson: vi.fn(), handleDeletePerson: vi.fn(),
        setLedgerDefaults: vi.fn(), ledgerDefaults: {},
        userResources: [], setUserResources: vi.fn(),
        plannedTasks: [], handleSaveTask: vi.fn(), handleUpdateTask: vi.fn(),
        showTaskCreationSheet: false, setShowTaskCreationSheet: vi.fn(),
    }),
    useAppVoiceState: () => ({
        status: 'idle', setStatus: vi.fn(), mode: 'voice', setMode: vi.fn(),
        recordingSegment: null, setRecordingSegment: vi.fn(),
        handleAudioReady: vi.fn(), handleTextReady: vi.fn(),
        error: null, errorTranscript: null,
        draftLog: null, setDraftLog: vi.fn(), provenance: null,
        voiceStreamingPhase: null, liveCaption: null,
    }),
    useAppCommandsState: () => ({ handleManualSubmit: vi.fn(), handleUpdateNote: vi.fn() }),
    useAppWeatherState: () => ({
        weatherData: undefined, weatherStatus: 'idle',
        boundaryUnset: false, refetchWeather: vi.fn(),
    }),
    useAppTrustState: () => ({ handleVerifyLog: vi.fn() }),
    useAppUiRuntime: () => ({ handleReset: vi.fn(), lastSavedLogSummary: [], lastSavedLogIds: [] }),
    useAppViewHelpers: () => ({ getTodayCounts: vi.fn(), getContextColorIndicator: vi.fn() }),
}));

vi.mock('../hooks/useAppRouterDerivations', () => ({
    useAppRouterDerivations: () => ({
        ownerDisplayName: 'Owner',
        operatorNameById: new Map(),
        todayDateKey: '2026-08-24',
        yesterdayDate: '2026-08-23',
        todayLogs: [],
        todayDayState: { closurePercent: 0, isClosed: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        yesterdayDayState: { closurePercent: 0, isClosed: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        costSnapshot: { today: 0, week: 0, cropSoFar: 0, perAcreRunning: 0, spendVelocityWeek: 0, unverifiedToday: 0, unverifiedTotal: 0 },
        yesterdayCost: 0,
        selectedScopeCropIds: [],
        selectedScopePlotIds: [],
        getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
    }),
}));

vi.mock('../simpleRoutes', () => ({ SIMPLE_ROUTE_RENDERERS: [] }));
vi.mock('../mainView', () => ({
    renderReflectView: () => null,
    renderCompareView: () => null,
    renderLogView: () => null,
}));
vi.mock('../MainViewTransition', () => ({
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../globalSheets', () => ({
    // Exposes ONLY the boolean that drives the real `ReviewInboxSheet`'s
    // `isOpen` prop in the unmocked module.
    renderGlobalSheets: (ctx: AppRouterContext) =>
        ctx.showReviewInbox ? <div data-testid="review-inbox-open" /> : null,
}));

import AppRouter from '../AppRouter';

describe('AppRouter — the waiting drawer\'s approval row lands here (F2)', () => {
    it('the_review_inbox_opens_when_the_waiting_drawer_requests_it', async () => {
        await act(async () => {
            render(<AppRouter />);
        });

        expect(screen.queryByTestId('review-inbox-open')).not.toBeInTheDocument();

        await act(async () => {
            requestOpenReviewInbox();
        });

        expect(screen.getByTestId('review-inbox-open')).toBeInTheDocument();
    });
});
