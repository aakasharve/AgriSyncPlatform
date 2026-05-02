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

import { OnboardingPermissionsPage, RouteLoader } from './lazyComponents';
import { AppRouterContext } from './routeContext';
import { SIMPLE_ROUTE_RENDERERS } from './simpleRoutes';
import { renderReflectView, renderCompareView, renderLogView } from './mainView';
import { renderGlobalSheets } from './globalSheets';
import { useUiPref } from '../../shared/hooks/useUiPref';
import { useAppRouterDerivations } from './hooks/useAppRouterDerivations';
import { useNudgeRouteEffect } from './hooks/useNudgeRouteEffect';

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
    const { getTodayCounts, getContextColorIndicator } = useAppViewHelpers();

    const { currentRoute, setCurrentRoute, mainView, setMainView } = navigation;
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
    } = voice;

    const weatherData = weather.weatherData;
    const handleManualSubmit = commands.handleManualSubmit;
    const handleUpdateNote = commands.handleUpdateNote;
    const handleVerifyLog = trust.handleVerifyLog;
    const history = isDemoMode ? mockHistory : realHistory;

    // DFES Phase 0: Review Inbox / QuickLog / Reflect-focus / close-day modals.
    const [showReviewInbox, setShowReviewInbox] = React.useState(false);
    const [showQuickLog, setShowQuickLog] = React.useState(false);
    const [reflectFocusRequest, setReflectFocusRequest] = React.useState<{ logId: string; date: string; plotId?: string } | null>(null);
    const [showCloseDaySummary, setShowCloseDaySummary] = React.useState(false);
    const [showCloseYesterdaySummary, setShowCloseYesterdaySummary] = React.useState(false);

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
            dayOutcome: log.dayOutcome,
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
        setShowCloseDaySummary,
        setShowCloseYesterdaySummary,
        setShowReviewInbox,
        todayUnverifiedCount: derivations.todayDayState.unverifiedCount,
    });

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
        currentRoute, setCurrentRoute, mainView, setMainView,
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
        weatherData,
        handleManualSubmit, handleUpdateNote, handleVerifyLog,
        handleReset, lastSavedLogSummary, lastSavedLogIds,
        getTodayCounts, getContextColorIndicator,
        showReviewInbox, setShowReviewInbox,
        showQuickLog, setShowQuickLog,
        reflectFocusRequest, setReflectFocusRequest,
        showCloseDaySummary, setShowCloseDaySummary,
        showCloseYesterdaySummary, setShowCloseYesterdaySummary,
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

                {renderReflectView(ctx)}
                {renderCompareView(ctx)}
                {renderLogView(ctx)}

                {renderGlobalSheets(ctx)}
            </div>
        </React.Suspense>
    );
};

export default AppRouter;
