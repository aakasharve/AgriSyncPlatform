import React from 'react';
import {
    AgriLogResponse, DailyLog
} from '../../types';
import { getDateKey } from '../domain/services/DateKeyService';
import { computeDayState } from '../../shared/utils/dayState';
import { financeSelectors } from '../../features/finance/financeSelectors';
import {
    useAppCommandsState,
    useAppDataState,
    useAppLogState,
    useAppNavigationState,
    useAppTrustState,
    useAppUiRuntime,
    useAppViewHelpers,
    useAppVoiceState,
    useAppWeatherState
} from '../../app/context/AppFeatureContexts';

import { OnboardingPermissionsPage, RouteLoader } from './lazyComponents';
import { AppRouterContext } from './routeContext';
import { SIMPLE_ROUTE_RENDERERS } from './simpleRoutes';
import { renderReflectView, renderCompareView, renderLogView } from './mainView';
import { renderGlobalSheets } from './globalSheets';

// Sub-plan 04 Task 8 — Routes-as-data decomposition.
// AppRouter is now a thin orchestrator that:
//   1. Wires every hook + memo
//   2. Builds an AppRouterContext snapshot
//   3. Delegates rendering to ./simpleRoutes, ./mainView, ./globalSheets
//
// Helpers (formatLogTime, getPrimaryWorkDone, etc.) live in ./helpers.
// All React.lazy() page imports live in ./lazyComponents.
// The shape of AppRouterContext lives in ./routeContext.

const AppRouter: React.FC = () => {
    const navigation = useAppNavigationState();
    const context = useAppLogState();
    const data = useAppDataState();
    const voice = useAppVoiceState();
    const commands = useAppCommandsState();
    const weather = useAppWeatherState();
    const trust = useAppTrustState();
    const { handleReset, lastSavedLogSummary, lastSavedLogIds } = useAppUiRuntime();

    // permissions state
    const [permissionsGranted, setPermissionsGranted] = React.useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('shramsafal_permissions_granted') === 'true';
        }
        return true;
    });
    const {
        getTodayCounts,
        getContextColorIndicator
    } = useAppViewHelpers();

    const { currentRoute, setCurrentRoute, mainView, setMainView } = navigation;
    const { logScope, setLogScope, currentLogContext, hasActiveLogContext, isContextReady } = context;
    const {
        isDemoMode,
        setIsDemoMode,
        farmerProfile,
        setFarmerProfile,
        crops,
        mockHistory,
        realHistory,
        handleUpdateCrops,
        handleAddPerson,
        handleDeletePerson,
        setLedgerDefaults,
        ledgerDefaults,
        userResources,
        setUserResources,
        plannedTasks,
        handleSaveTask,
        handleUpdateTask,
        showTaskCreationSheet,
        setShowTaskCreationSheet
    } = data;
    const {
        status,
        setStatus,
        mode,
        setMode,
        recordingSegment,
        setRecordingSegment,
        handleAudioReady,
        handleTextReady,
        error,
        errorTranscript,
        draftLog,
        setDraftLog,
        provenance
    } = voice;

    const weatherData = weather.weatherData;
    const handleManualSubmit = commands.handleManualSubmit;
    const handleUpdateNote = commands.handleUpdateNote;
    const handleVerifyLog = trust.handleVerifyLog;
    const history = isDemoMode ? mockHistory : realHistory;

    // DFES Phase 0: Review Inbox State
    const [showReviewInbox, setShowReviewInbox] = React.useState(false);
    // DFES: QuickLogSheet State (INT-3)
    const [showQuickLog, setShowQuickLog] = React.useState(false);
    const [reflectFocusRequest, setReflectFocusRequest] = React.useState<{ logId: string; date: string; plotId?: string } | null>(null);
    const [showCloseDaySummary, setShowCloseDaySummary] = React.useState(false);
    const [showCloseYesterdaySummary, setShowCloseYesterdaySummary] = React.useState(false);

    // Helper: Open Log for Edit (Manual Ledger)
    const handleEditLog = (log: DailyLog) => {
        setMainView('log');
        const ctxSel = log.context.selection[0];
        setLogScope({
            selectedCropIds: [ctxSel.cropId],
            selectedPlotIds: ctxSel.selectedPlotIds,
            mode: 'single',
            applyPolicy: 'broadcast'
        });
        setMode('manual');
        setStatus('idle');

        // Convert DailyLog to AgriLogResponse (Partial adapter)
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
            // Important: Pass ID to indicate Edit Mode
            originalLogId: log.id
        };
        setDraftLog(agriLogFormat);
    };

    const ownerOperator = farmerProfile.operators.find(op => op.role === 'PRIMARY_OWNER');
    const ownerDisplayName = React.useMemo(() => {
        const ownerName = ownerOperator?.name?.trim();
        if (ownerName && ownerName.toLowerCase() !== 'owner') {
            return ownerName;
        }
        return farmerProfile.name || 'Owner';
    }, [ownerOperator, farmerProfile.name]);

    const operatorNameById = React.useMemo(() => {
        const map = new Map<string, string>();
        farmerProfile.operators.forEach(operator => {
            map.set(operator.id, operator.name);
        });
        return map;
    }, [farmerProfile.operators]);

    const todayDateKey = getDateKey();
    const yesterdayDate = React.useMemo(() => {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        return getDateKey(date);
    }, []);
    const selectedScopeCropIds = React.useMemo(
        () => (logScope.selectedCropIds || [])
            .filter(cropId => cropId && cropId !== 'FARM_GLOBAL'),
        [logScope.selectedCropIds]
    );
    const selectedScopePlotIds = React.useMemo(
        () => (logScope.selectedPlotIds || [])
            .filter(Boolean),
        [logScope.selectedPlotIds]
    );
    const scopeCropIds = selectedScopeCropIds.length > 0 ? selectedScopeCropIds : undefined;
    const scopePlotIds = selectedScopePlotIds.length > 0 ? selectedScopePlotIds : undefined;

    const todayLogs = React.useMemo(
        () => history
            .filter(log => (log.date.includes('T') ? log.date.split('T')[0] : log.date) === todayDateKey)
            .sort((a, b) => new Date(b.meta?.createdAtISO || b.date).getTime() - new Date(a.meta?.createdAtISO || a.date).getTime()),
        [history, todayDateKey]
    );

    const todayDayState = React.useMemo(() => computeDayState({
        logs: history,
        crops,
        tasks: plannedTasks,
        date: todayDateKey,
        selectedCropIds: scopeCropIds,
        selectedPlotIds: scopePlotIds
    }), [history, crops, plannedTasks, todayDateKey, scopeCropIds, scopePlotIds]);

    const yesterdayDayState = React.useMemo(() => computeDayState({
        logs: history,
        crops,
        tasks: plannedTasks,
        date: yesterdayDate,
        selectedCropIds: scopeCropIds,
        selectedPlotIds: scopePlotIds
    }), [history, crops, plannedTasks, yesterdayDate, scopeCropIds, scopePlotIds]);

    const baseFinanceFilters = React.useMemo(
        () => ({
            cropId: scopeCropIds?.[0],
            plotId: scopePlotIds?.[0]
        }),
        [scopeCropIds, scopePlotIds]
    );

    const costSnapshot = React.useMemo(() => {
        const today = financeSelectors.getTotalCost({
            ...baseFinanceFilters,
            fromDate: todayDateKey,
            toDate: todayDateKey
        });
        const cropSoFar = financeSelectors.getTotalCost(baseFinanceFilters);
        const unverifiedToday = financeSelectors
            .getBreakdown({
                ...baseFinanceFilters,
                fromDate: todayDateKey,
                toDate: todayDateKey
            })
            .lines.filter(line => line.trustStatus === 'Unverified').length;
        return {
            today,
            cropSoFar,
            unverifiedToday
        };
    }, [baseFinanceFilters, todayDateKey, history.length]);

    const yesterdayCost = React.useMemo(
        () => financeSelectors.getTotalCost({
            ...baseFinanceFilters,
            fromDate: yesterdayDate,
            toDate: yesterdayDate
        }),
        [baseFinanceFilters, yesterdayDate, history.length]
    );

    const getLogContextSnapshot = (log: DailyLog): { cropName: string; plotName: string; plotId?: string } => {
        const selection = log.context.selection[0];
        const crop = crops.find(item => item.id === selection?.cropId);
        const plotId = selection?.selectedPlotIds?.[0];
        const plotFromCatalog = crop?.plots.find(plot => plot.id === plotId);

        return {
            cropName: selection?.cropName || crop?.name || 'General Farm',
            plotName: selection?.selectedPlotNames?.[0] || plotFromCatalog?.name || 'General Farm',
            plotId
        };
    };

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const nudge = params.get('nudge');
        if (!nudge) return;

        setCurrentRoute('main');
        setMainView('log');

        if (nudge === 'close-day') {
            setShowCloseDaySummary(true);
            if (todayDayState.unverifiedCount > 0) {
                setShowReviewInbox(true);
            }
        }

        if (nudge === 'review-summary') {
            setShowCloseYesterdaySummary(true);
        }

        params.delete('nudge');
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
        window.history.replaceState({}, '', nextUrl);
    }, [setCurrentRoute, setMainView, todayDayState.unverifiedCount]);

    if (!permissionsGranted) {
        return (
            <React.Suspense fallback={<RouteLoader />}>
                <OnboardingPermissionsPage onComplete={() => setPermissionsGranted(true)} />
            </React.Suspense>
        );
    }

    // Build the snapshot ctx that every route render-function consumes. This
    // keeps the route modules free of hook calls (which would violate
    // rules-of-hooks if invoked conditionally).
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
        ownerDisplayName, operatorNameById,
        todayDateKey, yesterdayDate,
        todayLogs, todayDayState, yesterdayDayState,
        costSnapshot, yesterdayCost,
        handleEditLog, getLogContextSnapshot
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
        </div >
        </React.Suspense>
    );
};

export default AppRouter;
