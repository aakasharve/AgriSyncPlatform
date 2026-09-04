import React from 'react';
import {
    AgriLogResponse, DailyLog,
} from '../../types';
import {
    useAppCommandsState,
    useAppDataState,
    useAppLogState,
    useAppNavigationState,
    useAppTrustState,
    useAppUiRuntime,
    useAppViewHelpers,
    useAppVoiceState,
    useAppWeatherState,
} from '../../app/context/AppFeatureContexts';

import { OnboardingPermissionsPage, WelcomeScreen, RouteLoader } from './lazyComponents';
import { AppRouterContext } from './routeContext';
import { SIMPLE_ROUTE_RENDERERS } from './simpleRoutes';
import { renderReflectView, renderCompareView, renderLogView } from './mainView';
import { renderGlobalSheets } from './globalSheets';
import MainViewTransition from './MainViewTransition';
import { useUiPref } from '../../shared/hooks/useUiPref';
import { useFarmContext } from '../session/FarmContext';
import { useAppRouterDerivations } from './hooks/useAppRouterDerivations';
import { useNudgeRouteEffect } from './hooks/useNudgeRouteEffect';
import { useLabourLogArrivalScroll } from './hooks/useLabourLogArrivalScroll';
// spec: owner-oversight-loop (§P-I) — the SAME predicate `AppContent.tsx`
// hands the tap path as `disabled`. Never re-write the expression here.
import { isRecordingPathBusy } from '../../shared/utils/recordingPathBusy';
// Finding F2 — the waiting drawer's `approval` row's destination arrives
// here as a window event; see that module's header for why.
import { OPEN_REVIEW_INBOX_EVENT } from '../../features/oversight/oversightNavigationEvents';
import { useOpenSurfaceRequest } from '../../features/oversight/useOpenSurfaceRequest';

// Sub-plan 04 Task 8 — Routes-as-data decomposition.
// AppRouter is a thin orchestrator that wires hooks, builds an
// AppRouterContext snapshot, and delegates rendering to:
//   ./simpleRoutes        (every settings/finance/admin page)
//   ./mainView            (log / reflect / compare main views)
//   ./globalSheets        (modals + bottom sheets that float over routes)
// Memo derivations live in ./hooks/useAppRouterDerivations.
// URL nudge handling lives in ./hooks/useNudgeRouteEffect.

const AppRouter: React.FC = () => {
    const navigation = useAppNavigationState();
    const context = useAppLogState();
    const data = useAppDataState();
    const voice = useAppVoiceState();
    const commands = useAppCommandsState();
    const weather = useAppWeatherState();
    const trust = useAppTrustState();
    const { handleReset, lastSavedLogSummary, lastSavedLogIds } = useAppUiRuntime();

    const [permissionsGranted, setPermissionsGranted] = useUiPref<boolean>(
        'shramsafal_permissions_granted',
        typeof window === 'undefined',
    );
    // First-run welcome, shown once after login and before the consent screen.
    const [welcomeSeen, setWelcomeSeen] = useUiPref<boolean>(
        'shramsafal_welcome_seen',
        typeof window === 'undefined',
    );
    const { getTodayCounts, getContextColorIndicator } = useAppViewHelpers();
    // Session's active farm — threaded into ctx so the hook-free route render
    // functions (mainView) can reach it. See AppRouterContext.activeFarmId.
    const { currentFarmId } = useFarmContext();

    const { currentRoute, setCurrentRoute, mainView, setMainView, logIntent, setLogIntent, lastLabourLogIds } = navigation;
    const { logScope, setLogScope, currentLogContext, hasActiveLogContext, isContextReady } = context;
    const {
        isDemoMode, setIsDemoMode,
        farmerProfile, setFarmerProfile,
        crops, mockHistory, realHistory,
        handleUpdateCrops, handleAddPerson, handleDeletePerson,
        setLedgerDefaults, ledgerDefaults,
        userResources, setUserResources,
        plannedTasks, handleSaveTask, handleUpdateTask,
        showTaskCreationSheet, setShowTaskCreationSheet,
    } = data;
    const {
        status, setStatus, mode, setMode,
        recordingSegment, setRecordingSegment,
        handleAudioReady, handleTextReady,
        error, errorTranscript,
        draftLog, setDraftLog, provenance,
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2.
        voiceStreamingPhase, liveCaption,
        continuityLevel, savedPendingCaptureId,
    } = voice;

    const weatherData = weather.weatherData;
    const weatherStatus = weather.weatherStatus;
    const boundaryUnset = weather.boundaryUnset;
    const refetchWeather = weather.refetchWeather;
    const handleManualSubmit = commands.handleManualSubmit;
    const handleUpdateNote = commands.handleUpdateNote;
    const handleVerifyLog = trust.handleVerifyLog;
    const history = isDemoMode ? mockHistory : realHistory;

    // DFES Phase 0: Review Inbox / QuickLog / Reflect-focus modals.
    //
    // FINDING F3 — `showCloseDaySummary` / `showCloseYesterdaySummary` used
    // to live here too. Commit `0e4ad118` deleted their only readers from
    // `mainView.tsx` (spec §4.2 moved the Daily Closure card and the
    // yesterday-not-closed block into the waiting drawer), leaving two
    // booleans that three live code paths still WROTE and nothing rendered.
    // They are gone rather than re-read: the drawer is the destination now,
    // and a flag no component reads is a promise the UI cannot keep.
    const [showReviewInbox, setShowReviewInbox] = React.useState(false);
    const [showQuickLog, setShowQuickLog] = React.useState(false);
    // wave-3.10, founder decision 8 — the optional reason chips after he declares a
    // no-work day. Lifted here alongside showQuickLog because the two hand off to
    // each other and both live in renderGlobalSheets.
    const [showNoWorkReason, setShowNoWorkReason] = React.useState(false);
    const [reflectFocusRequest, setReflectFocusRequest] = React.useState<{ logId: string; date: string; plotId?: string } | null>(null);

    // Convert a DailyLog to an editable AgriLogResponse (manual ledger edit flow).
    const handleEditLog = (log: DailyLog) => {
        setMainView('log');
        const ctxSel = log.context.selection[0];
        setLogScope({
            selectedCropIds: [ctxSel.cropId],
            selectedPlotIds: ctxSel.selectedPlotIds,
            mode: 'single',
            applyPolicy: 'broadcast',
        });
        setMode('manual');
        setStatus('idle');

        const agriLogFormat: AgriLogResponse = {
            // task-0b — `log.dayOutcome` is `DayOutcome | null`; the editable
            // draft's shape (`AgriLogResponse.dayOutcome`) is unchanged and
            // still required, so this falls back exactly as this edit-draft
            // conversion already did for every pulled log before task-0b.
            dayOutcome: log.dayOutcome ?? 'WORK_RECORDED',
            cropActivities: log.cropActivities || [],
            irrigation: log.irrigation || [],
            labour: log.labour || [],
            inputs: log.inputs || [],
            machinery: log.machinery || [],
            activityExpenses: log.activityExpenses || [],
            disturbance: log.disturbance,
            questionsForUser: [],
            summary: '',
            missingSegments: [],
            originalLogId: log.id,
        };
        setDraftLog(agriLogFormat);
    };

    const selectedScopeCropIds = React.useMemo(
        () => (logScope.selectedCropIds || [])
            .filter(cropId => cropId && cropId !== 'FARM_GLOBAL'),
        [logScope.selectedCropIds],
    );
    const selectedScopePlotIds = React.useMemo(
        () => (logScope.selectedPlotIds || []).filter(Boolean),
        [logScope.selectedPlotIds],
    );

    const derivations = useAppRouterDerivations({
        farmerProfile,
        crops,
        history,
        plannedTasks,
        selectedCropIds: selectedScopeCropIds,
        selectedPlotIds: selectedScopePlotIds,
    });

    useNudgeRouteEffect({
        setCurrentRoute,
        setMainView,
    });

    // FINDING F2 — the waiting drawer's `approval` row opens THIS router's
    // `ReviewInboxSheet` (mounted in `globalSheets.tsx`). The row lives in
    // `AppHeader`, which renders as a sibling of `<AppFeatureProviders>` in
    // `AppContent.tsx` and has no prop path to `setShowReviewInbox` — so the
    // hop arrives as a window event. See
    // `features/oversight/oversightNavigationEvents.ts` for why, and for the
    // effect-ordering check.
    useOpenSurfaceRequest(OPEN_REVIEW_INBOX_EVENT, () => setShowReviewInbox(true));

    // spec: 2026-07-13-labour-attendance-approval-design (Task 3.6) —
    // arriving at the log page with logIntent === 'labour' auto-scrolls the
    // labour banner + crop/plot picker into view. See
    // ./hooks/useLabourLogArrivalScroll.ts for the full rationale.
    // NOTE: this hook call must stay ABOVE every conditional return below —
    // React hooks must run unconditionally on every render.
    useLabourLogArrivalScroll({ currentRoute, mainView, logIntent });

    // Labour V2 R1 Task 3.4a — the labour auto-submit that lived here was
    // DELETED. A labour parse now lands on features/labour/components/
    // AttendanceResult.tsx and is saved ONLY by the farmer pressing बरोबर
    // (trust rule 5; useVoiceRecorder.ts's "never skip to auto-save" holds
    // on this door again). The 2026-08-31 ruling it implemented is
    // superseded by the founder's 2026-09-01 final direction §7 / D1–D3.

    if (!welcomeSeen) {
        return (
            <React.Suspense fallback={<RouteLoader />}>
                <WelcomeScreen onContinue={() => setWelcomeSeen(true)} />
            </React.Suspense>
        );
    }

    if (!permissionsGranted) {
        return (
            <React.Suspense fallback={<RouteLoader />}>
                <OnboardingPermissionsPage onComplete={() => setPermissionsGranted(true)} />
            </React.Suspense>
        );
    }

    // Snapshot ctx every route render-function consumes. Keeps the route
    // modules free of hook calls (which would violate rules-of-hooks if
    // invoked conditionally).
    const ctx: AppRouterContext = {
        activeFarmId: currentFarmId,
        currentRoute, setCurrentRoute, mainView, setMainView,
        logIntent, setLogIntent, lastLabourLogIds,
        logScope, setLogScope, currentLogContext, hasActiveLogContext, isContextReady,
        isDemoMode, setIsDemoMode,
        farmerProfile, setFarmerProfile,
        crops, handleUpdateCrops, handleAddPerson, handleDeletePerson,
        setLedgerDefaults, ledgerDefaults,
        userResources, setUserResources,
        plannedTasks, handleSaveTask, handleUpdateTask,
        showTaskCreationSheet, setShowTaskCreationSheet,
        history, mockHistory,
        status, setStatus, mode, setMode,
        recordingSegment, setRecordingSegment,
        handleAudioReady, handleTextReady,
        error, errorTranscript,
        draftLog, setDraftLog, provenance,
        voiceStreamingPhase, liveCaption,
        continuityLevel, savedPendingCaptureId,
        weatherData,
        weatherStatus,
        boundaryUnset,
        refetchWeather,
        handleManualSubmit, handleUpdateNote, handleVerifyLog,
        handleReset, lastSavedLogSummary, lastSavedLogIds,
        getTodayCounts, getContextColorIndicator,
        showReviewInbox, setShowReviewInbox,
        showQuickLog, setShowQuickLog,
        showNoWorkReason, setShowNoWorkReason,
        reflectFocusRequest, setReflectFocusRequest,
        ownerDisplayName: derivations.ownerDisplayName,
        operatorNameById: derivations.operatorNameById,
        todayDateKey: derivations.todayDateKey,
        yesterdayDate: derivations.yesterdayDate,
        todayLogs: derivations.todayLogs,
        todayDayState: derivations.todayDayState,
        yesterdayDayState: derivations.yesterdayDayState,
        costSnapshot: derivations.costSnapshot,
        yesterdayCost: derivations.yesterdayCost,
        handleEditLog,
        getLogContextSnapshot: derivations.getLogContextSnapshot,
    };

    return (
        <React.Suspense fallback={<RouteLoader />}>
            <div className="relative w-full">
                {SIMPLE_ROUTE_RENDERERS.map((render, idx) => (
                    <React.Fragment key={idx}>{render(ctx)}</React.Fragment>
                ))}

                {/* Task 14, change 5 — the slide transition + swipe every
                    other route already has, extended to Log/Reflect/Compare.
                    `disabled` (spec §P-I): `renderLogView` returns null the
                    moment `mainView !== 'log'`, so an unguarded swipe unmounts
                    the live recorder. `status` here is the SAME `voice.status`
                    `AppContent.tsx` reads for the tap path's `disabled`, put
                    through the SAME predicate. */}
                <MainViewTransition
                    view={mainView}
                    onChangeView={setMainView}
                    disabled={isRecordingPathBusy(status)}
                >
                    {renderReflectView(ctx)}
                    {renderCompareView(ctx)}
                    {renderLogView(ctx)}
                </MainViewTransition>

                {renderGlobalSheets(ctx)}
            </div>
        </React.Suspense>
    );
};

export default AppRouter;
