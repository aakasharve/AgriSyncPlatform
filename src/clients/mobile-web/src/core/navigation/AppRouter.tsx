import React from 'react';
import {
    AppRoute, PageView, AppStatus, InputMode, LogSegment,
    FarmerProfile, CropProfile, DailyLog, PlannedTask, LedgerDefaults,
    DetailedWeather, WeatherEvent, WeatherReaction, ResourceItem,
    FarmContext, LogScope, AgriLogResponse, LogVerificationStatus
} from '../../types';

// Page Imports
import ProfilePage from '../../pages/ProfilePage';
import SettingsPage from '../../pages/SettingsPage';
import SchedulerPage from '../../pages/SchedulerPage';
import ProcurementPage from '../../pages/ProcurementPage';
import HarvestIncomePage from '../../pages/HarvestIncomePage';
import ReflectPage from '../../pages/ReflectPage';
import TestE2EPage from '../../pages/TestE2EPage';
import { ComparePage } from '../../pages/ComparePage';
import FinanceManagerHome from '../../pages/FinanceManagerHome';
import LedgerPage from '../../pages/LedgerPage';
import PriceBookPage from '../../pages/PriceBookPage';
import ReviewInboxPage from '../../pages/ReviewInboxPage';
import ReportsPage from '../../pages/ReportsPage';
import FinanceSettingsPage from '../../pages/FinanceSettingsPage';
import { AdminAiOpsPage } from '../../features/admin/ai/AdminAiOpsPage';
import CropSelector from '../../features/context/components/CropSelector';
import InputMethodToggle from '../../shared/components/ui/InputMethodToggle';
import AudioRecorder from '../../features/voice/components/AudioRecorder';
import ManualEntry from '../../features/logs/components/ManualEntry';
import DailyLogCard from '../../features/logs/components/DailyLogCard';
import TaskCreationSheet from '../../features/scheduler/components/TaskCreationSheet';
import { Leaf } from 'lucide-react';
import { getSegmentVisual } from '../../shared/utils/uiUtils'; // We might need to extract this helper too
import { getDateKey } from '../domain/services/DateKeyService';
import { buildTimelineEntries } from '../../services/transcriptTimelineService';
import LogWizardContainer from '../../features/logs/components/wizard/LogWizardContainer';
import ReviewInboxSheet from '../../features/logs/components/ReviewInboxSheet';
import { QuickLogSheet } from '../../features/logs/components/QuickLogSheet';
import WeatherWidget from '../../features/weather/components/WeatherWidget';
import OnboardingPermissionsPage from '../../pages/OnboardingPermissionsPage';
import {
    computeDayState,
    formatCurrencyINR
} from '../../shared/utils/dayState';
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

type FeedStatusTone = 'pending' | 'rejected' | 'approved';

const formatLogTime = (iso?: string): string => {
    if (!iso) return '--:--';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

const truncateLine = (value: string, maxLength: number = 72): string => {
    if (!value) return value;
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}...`;
};

const getVerificationPresentation = (status?: LogVerificationStatus): {
    label: 'UNVERIFIED' | 'VERIFIED';
    tone: FeedStatusTone;
    isPending: boolean;
} => {
    const verified = status === LogVerificationStatus.VERIFIED || status === LogVerificationStatus.APPROVED;
    if (verified) {
        return { label: 'VERIFIED', tone: 'approved', isPending: false };
    }
    return { label: 'UNVERIFIED', tone: 'pending', isPending: true };
};

const getPrimaryWorkDone = (log: DailyLog): string => {
    if (log.disturbance?.reason) {
        return `Work Blocked: ${log.disturbance.reason}`;
    }

    const primaryActivity = log.cropActivities?.[0];
    const candidateTitle = primaryActivity?.title?.trim();
    const workType = primaryActivity?.workTypes?.[0]?.trim();
    if (workType) return `${workType} Completed`;
    if (candidateTitle && candidateTitle.toLowerCase() !== 'daily operations') return `${candidateTitle} Completed`;

    if (log.irrigation.length > 0) return 'Irrigation Completed';

    const primaryInput = log.inputs?.[0];
    if (primaryInput) {
        const isFertilizer = primaryInput.type === 'fertilizer' || primaryInput.reason === 'Growth' || primaryInput.reason === 'Deficiency';
        const isSpray = primaryInput.type === 'pesticide' || primaryInput.type === 'fungicide' || primaryInput.reason === 'Pest' || primaryInput.reason === 'Disease';
        if (isFertilizer) return 'Fertilizer Applied';
        if (isSpray) return 'Spray Logged';
        return 'Input Applied';
    }

    const primaryLabour = log.labour?.[0];
    if (primaryLabour?.activity) return `${primaryLabour.activity} Done`;
    if (log.labour.length > 0) return 'Labour Logged';

    if (log.machinery.length > 0) return 'Machinery Work Logged';
    return 'Activity Logged';
};

const getSummaryLines = (log: DailyLog): string[] => {
    const lines: string[] = [];

    const irrigation = log.irrigation?.[0];
    if (irrigation) {
        if (typeof irrigation.durationHours === 'number') {
            lines.push(`Water Duration: ${irrigation.durationHours} hrs`);
        }
        if (irrigation.method || irrigation.source) {
            lines.push(`${irrigation.method || 'Irrigation'} via ${irrigation.source || 'available source'}`);
        }
    }

    const input = log.inputs?.[0];
    if (input && lines.length < 2) {
        const firstMix = input.mix?.[0]?.productName || input.productName;
        if (firstMix) {
            lines.push(`Input: ${firstMix}`);
        }
    }

    const labour = log.labour?.[0];
    if (labour && lines.length < 2 && labour.count) {
        lines.push(`Labour: ${labour.count} workers`);
    }

    const firstObservation = log.observations?.[0]?.textCleaned || log.observations?.[0]?.textRaw;
    const firstActivityNote = log.cropActivities.find(activity => activity.notes)?.notes;
    const firstIrrigationNote = log.irrigation.find(event => event.notes)?.notes;
    const firstNote = firstObservation || firstActivityNote || firstIrrigationNote;
    if (firstNote && lines.length < 2) {
        lines.push(`Note: ${truncateLine(firstNote, 60)}`);
    }

    lines.push(
        `System: ${log.cropActivities.length} activity, ${log.irrigation.length} irrigation, ${log.inputs.length} input entries.`
    );

    return lines.slice(0, 3).map(line => truncateLine(line));
};

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
        setDraftLog
    } = voice;

    const weatherData = weather.weatherData;
    const handleManualSubmit = commands.handleManualSubmit;
    const handleUpdateNote = commands.handleUpdateNote;
    const handleVerifyLog = trust.handleVerifyLog;
    const history = isDemoMode ? mockHistory : realHistory;

    // Sathi Wizard State
    const [showLogWizard, setShowLogWizard] = React.useState(false);
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
        const context = log.context.selection[0];
        setLogScope({
            selectedCropIds: [context.cropId],
            selectedPlotIds: context.selectedPlotIds,
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
        return <OnboardingPermissionsPage onComplete={() => setPermissionsGranted(true)} />;
    }

    return (
        <div className="relative w-full">
            {currentRoute === 'profile' && (
                <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                    <ProfilePage
                        profile={farmerProfile}
                        crops={crops}
                        onUpdateProfile={setFarmerProfile}
                        onUpdateCrops={handleUpdateCrops}
                        onAddPerson={handleAddPerson}
                        onDeletePerson={handleDeletePerson}
                        onOpenScheduleLibrary={(cropId) => {
                            if (typeof window !== 'undefined' && cropId) {
                                window.sessionStorage.setItem('schedule_library_crop_id', cropId);
                            }
                            setCurrentRoute('schedule');
                        }}
                        onOpenFinanceManager={() => setCurrentRoute('finance-manager')}
                    />
                </div>
            )}


            {currentRoute === 'settings' && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <SettingsPage defaults={ledgerDefaults} onUpdateDefaults={setLedgerDefaults} crops={crops} />
                </div>
            )}

            {currentRoute === 'ai-admin' && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <AdminAiOpsPage onBack={() => setCurrentRoute('settings')} />
                </div>
            )}

            {currentRoute === 'schedule' && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <SchedulerPage
                        crops={crops}
                        logs={history}
                        tasks={plannedTasks}
                        onUpdateCrops={handleUpdateCrops}
                        userResources={userResources}
                        onAddResource={(resource) => setUserResources(prev => [...prev, resource])}
                        onOpenTaskCreator={() => setShowTaskCreationSheet(true)}
                        onCloseDay={() => {
                            setCurrentRoute('main');
                            setMainView('log');
                            setShowCloseDaySummary(true);
                        }}
                    />
                </div>
            )}

            {currentRoute === 'procurement' && (
                <ProcurementPage crops={crops} />
            )}

            {currentRoute === 'test-e2e' && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <TestE2EPage />
                </div>
            )}

            {currentRoute === 'income' && (
                <HarvestIncomePage
                    context={currentLogContext}
                    crops={crops}
                    onBack={() => setCurrentRoute('main')}
                />
            )}

            {currentRoute === 'finance-manager' && (
                <FinanceManagerHome
                    currentRoute={currentRoute}
                    onNavigate={setCurrentRoute}
                />
            )}

            {currentRoute === 'finance-ledger' && (
                <LedgerPage
                    currentRoute={currentRoute}
                    onNavigate={setCurrentRoute}
                />
            )}

            {currentRoute === 'finance-price-book' && (
                <PriceBookPage
                    currentRoute={currentRoute}
                    onNavigate={setCurrentRoute}
                />
            )}

            {currentRoute === 'finance-review-inbox' && (
                <ReviewInboxPage
                    currentRoute={currentRoute}
                    onNavigate={setCurrentRoute}
                />
            )}

            {currentRoute === 'finance-reports' && (
                <ReportsPage
                    currentRoute={currentRoute}
                    onNavigate={setCurrentRoute}
                />
            )}

            {currentRoute === 'finance-settings' && (
                <FinanceSettingsPage
                    currentRoute={currentRoute}
                    onNavigate={setCurrentRoute}
                />
            )}

            {currentRoute === 'main' && mainView === 'reflect' && (
                <ReflectPage
                    history={history}
                    crops={crops}
                    ledgerDefaults={ledgerDefaults}
                    tasks={plannedTasks}
                    onUpdateTask={(task) => handleUpdateTask(task.id, task)}
                    onAddTask={() => setShowTaskCreationSheet(true)}
                    onEditLog={(log) => {
                        setMainView('log');
                        const context = log.context.selection[0];
                        setLogScope({
                            selectedCropIds: [context.cropId],
                            selectedPlotIds: context.selectedPlotIds,
                            mode: 'single',
                            applyPolicy: 'broadcast'
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
                            summary: '', // Missing in DailyLog
                            missingSegments: []
                        };
                        // Note: We might need a better adapter here, checking types
                        setDraftLog(agriLogFormat);
                    }}
                    onUpdateNote={handleUpdateNote}
                    onVerifyLog={handleVerifyLog}
                    currentOperator={farmerProfile.operators.find(op => op.id === farmerProfile.activeOperatorId)}
                    operators={farmerProfile.operators}
                    navigate={setCurrentRoute}
                    focusLogRequest={reflectFocusRequest}
                    onFocusLogConsumed={() => setReflectFocusRequest(null)}
                />
            )}

            {currentRoute === 'main' && mainView === 'compare' && (
                <ComparePage
                    plots={crops.flatMap(c => c.plots)}
                    crops={crops}
                    logs={history}
                    onBack={() => setMainView('log')}
                />
            )}

            {currentRoute === 'main' && mainView === 'log' && (
                <>
                    {/* IDLE / RECORDING STATE */}
                    {status !== 'confirming' && status !== 'success' && status !== 'processing' && (
                        <>
                            {!recordingSegment && (
                                <div className="mb-4 animate-in slide-in-from-top-4 duration-300 delay-100 space-y-3">
                                    <WeatherWidget data={weatherData} isLoading={!weatherData} />

                                    <div className="flex items-center justify-between px-1">
                                        <p className="text-base font-black tracking-tight text-stone-800">Daily Log</p>
                                        <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                                            Owner: {ownerDisplayName}
                                        </span>
                                    </div>

                                    <div className="bg-white border border-stone-200 rounded-2xl p-3.5 shadow-sm space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <div
                                                    className="w-14 h-14 rounded-full p-1"
                                                    style={{
                                                        background: `conic-gradient(#059669 ${todayDayState.closurePercent * 3.6}deg, #e7e5e4 0deg)`
                                                    }}
                                                >
                                                    <div className="w-full h-full rounded-full bg-white flex items-center justify-center text-[11px] font-black text-stone-700">
                                                        {todayDayState.closurePercent}%
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-xs uppercase tracking-wide font-bold text-stone-400">Daily Closure</p>
                                                    <p className={`text-sm font-bold ${todayDayState.isClosed ? 'text-emerald-700' : 'text-amber-700'}`}>
                                                        {todayDayState.isClosed ? 'Day Closed' : 'Day Not Closed'}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setShowCloseDaySummary(prev => !prev)}
                                                className="px-3 py-1.5 rounded-full bg-stone-900 text-white text-xs font-bold"
                                            >
                                                Close Day
                                            </button>
                                        </div>

                                        <p className="text-sm font-semibold text-stone-700">
                                            Tasks: Done {todayDayState.completedCount} / Planned {todayDayState.plannedCount}
                                        </p>
                                        {todayDayState.unverifiedCount > 0 && (
                                            <p className="text-xs font-semibold text-amber-700">
                                                Pending approvals: {todayDayState.unverifiedCount}
                                            </p>
                                        )}

                                        {showCloseDaySummary && (
                                            <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3 space-y-2">
                                                <p className="text-xs font-semibold text-stone-700">
                                                    {todayDayState.isClosed
                                                        ? 'Today is fully closed.'
                                                        : `Day closure pending: ${todayDayState.pendingCount} tasks and ${todayDayState.unverifiedCount} unverified entries.`}
                                                </p>
                                                {todayDayState.unverifiedCount > 0 && (
                                                    <button
                                                        onClick={() => setShowReviewInbox(true)}
                                                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                                                    >
                                                        Verify now
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        {(!yesterdayDayState.isClosed || showCloseYesterdaySummary) && (
                                            <div className="pt-1">
                                                <button
                                                    onClick={() => setShowCloseYesterdaySummary(prev => !prev)}
                                                    className="w-full text-left rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
                                                >
                                                    Yesterday not fully closed
                                                </button>
                                            </div>
                                        )}

                                        {showCloseYesterdaySummary && (
                                            <div className="mt-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 space-y-2">
                                                <p className="text-xs uppercase tracking-wide font-bold text-stone-400">Close Yesterday</p>
                                                <p className="text-sm text-stone-700">
                                                    Planned {yesterdayDayState.plannedCount}, completed {yesterdayDayState.completedCount}, pending {yesterdayDayState.pendingCount}, unverified {yesterdayDayState.unverifiedCount}.
                                                </p>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => {
                                                            setMainView('reflect');
                                                            setShowCloseYesterdaySummary(false);
                                                        }}
                                                        className="px-3 py-1.5 rounded-lg bg-stone-900 text-white text-xs font-bold"
                                                    >
                                                        Review summary
                                                    </button>
                                                    {yesterdayDayState.unverifiedCount > 0 && (
                                                        <button
                                                            onClick={() => setShowReviewInbox(true)}
                                                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                                                        >
                                                            Verify now
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="rounded-2xl bg-stone-900 text-white p-3.5 space-y-2">
                                        <p className="text-[10px] uppercase tracking-wide font-bold text-stone-300">Running Cost</p>
                                        <div className="grid grid-cols-3 gap-2 text-sm">
                                            <div>
                                                <p className="text-stone-400 text-xs">Today</p>
                                                <p className="font-black">Rs {formatCurrencyINR(costSnapshot.today)}</p>
                                            </div>
                                            <div>
                                                <p className="text-stone-400 text-xs">Yesterday</p>
                                                <p className="font-black">Rs {formatCurrencyINR(yesterdayCost)}</p>
                                            </div>
                                            <div>
                                                <p className="text-stone-400 text-xs">Running</p>
                                                <p className="font-black">Rs {formatCurrencyINR(costSnapshot.cropSoFar)}</p>
                                            </div>
                                        </div>
                                        {costSnapshot.unverifiedToday > 0 && (
                                            <button
                                                onClick={() => setShowReviewInbox(true)}
                                                className="w-full text-left rounded-lg border border-amber-300/50 bg-amber-200/20 px-2.5 py-2 text-xs text-amber-100 font-semibold"
                                            >
                                                Cost may be inaccurate - {costSnapshot.unverifiedToday} entries unverified. Verify now.
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {!recordingSegment && (
                                <div id="crop-selector-container" className="mb-6 animate-in slide-in-from-top-4 duration-500">
                                    <CropSelector
                                        mode="log"
                                        crops={crops}
                                        selectedCrops={logScope.selectedCropIds}
                                        selectedPlots={(() => {
                                            const map: Record<string, string[]> = {};
                                            logScope.selectedCropIds.forEach(cId => {
                                                const relevantPlots = logScope.selectedPlotIds.filter(pid =>
                                                    crops.find(c => c.id === cId)?.plots.some(p => p.id === pid)
                                                );
                                                map[cId] = relevantPlots;
                                            });
                                            return map;
                                        })()}
                                        onSelectionChange={(newCrops, newPlots) => {
                                            const flattenedPlots = Object.values(newPlots).flat();
                                            setLogScope({
                                                selectedCropIds: newCrops,
                                                selectedPlotIds: flattenedPlots,
                                                mode: flattenedPlots.length > 1 ? 'multi' : 'single',
                                                applyPolicy: 'broadcast'
                                            });
                                            // Auto-switch to voice mode to show the recorder immediately
                                            if (flattenedPlots.length > 0) {
                                                setMode('voice');
                                            }
                                        }}
                                        disabled={false}
                                    />
                                </div>
                            )}

                            {/* INPUT METHOD TOGGLE */}
                            {!recordingSegment && status !== 'recording' && (
                                <div className="mb-6 px-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
                                    <InputMethodToggle
                                        mode={mode}
                                        onChange={(newMode) => setMode(newMode)}
                                        disabled={false}
                                        suggestInteraction={hasActiveLogContext}
                                    />
                                </div>
                            )}

                            {recordingSegment && (
                                <div className={`mb-4 border-2 p-5 rounded-3xl flex items-center justify-between shadow-sm animate-in slide-in-from-top-4 ${getSegmentVisual(recordingSegment).color}`}>
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-white/50 rounded-full animate-pulse">
                                            {getSegmentVisual(recordingSegment).icon}
                                        </div>
                                        <div>
                                            <p className="font-bold text-lg leading-none mb-1">Recording {getSegmentVisual(recordingSegment).label}</p>
                                            <p className="text-sm opacity-80">
                                                {recordingSegment === 'labour' ? 'Speak count & duration...' : 'Speak details clearly...'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="relative animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {getContextColorIndicator()}

                                <div className={`transition-all duration-500 ${!isContextReady ? 'opacity-90' : ''}`}>
                                    {mode === 'voice' ? (
                                        <AudioRecorder
                                            onAudioCaptured={handleAudioReady}
                                            onTextCaptured={handleTextReady}
                                            disabled={!isContextReady}
                                            externalError={error}
                                            transcript={errorTranscript}
                                            suggestInteraction={isContextReady}
                                            onRequestContextSelection={() => {
                                                const el = document.getElementById('crop-selector-container');
                                                if (el) {
                                                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                    el.classList.add('ring-4', 'ring-emerald-200', 'rounded-xl');
                                                    setTimeout(() => el.classList.remove('ring-4', 'ring-emerald-200', 'rounded-xl'), 1500);
                                                }
                                            }}
                                        />
                                    ) : (
                                        hasActiveLogContext ? (
                                            <ManualEntry
                                                context={currentLogContext}
                                                crops={crops}
                                                defaults={ledgerDefaults}
                                                profile={farmerProfile}
                                                onSubmit={handleManualSubmit}
                                                disabled={false}
                                                initialData={draftLog}
                                                onDataConsumed={() => setDraftLog(null)}
                                                todayCountsMap={(() => {
                                                    const map: Record<string, any> = {};
                                                    if (currentLogContext) {
                                                        const todayStr = getDateKey();
                                                        const pids = new Set<string>();
                                                        currentLogContext.selection.forEach(s => s.selectedPlotIds.forEach(p => pids.add(p)));
                                                        pids.forEach(pid => {
                                                            map[pid] = getTodayCounts(pid, todayStr);
                                                        });
                                                    }
                                                    return map;
                                                })()}
                                                transcriptEntries={(() => {
                                                    // Build timeline entries for today's logs in current context
                                                    const todayStr = getDateKey();
                                                    const contextPlotIds = new Set<string>();
                                                    currentLogContext?.selection.forEach(s => s.selectedPlotIds.forEach(p => contextPlotIds.add(p)));

                                                    const todayLogs = history.filter(log =>
                                                        log.date === todayStr &&
                                                        log.context?.selection?.some((sel: any) =>
                                                            sel.selectedPlotIds?.some((pid: string) => contextPlotIds.has(pid))
                                                        )
                                                    );
                                                    return buildTimelineEntries(todayLogs, crops);
                                                })()}
                                                todayLogs={(() => {
                                                    // Full log objects for loading into editor
                                                    const todayStr = getDateKey();
                                                    const contextPlotIds = new Set<string>();
                                                    currentLogContext?.selection.forEach(s => s.selectedPlotIds.forEach(p => contextPlotIds.add(p)));

                                                    return history.filter(log =>
                                                        log.date === todayStr &&
                                                        log.context?.selection?.some((sel: any) =>
                                                            sel.selectedPlotIds?.some((pid: string) => contextPlotIds.has(pid))
                                                        )
                                                    );
                                                })()}
                                            />
                                        ) : (
                                            <div className="flex items-center justify-center h-64 text-slate-400">
                                                Select a plot to continue...
                                            </div>
                                        )
                                    )}
                                </div>

                                {/* TODAY'S ACTIVITY LEDGER CARDS */}
                                {!recordingSegment && mode !== 'manual' && (
                                    <div className="mt-12 animate-in slide-in-from-bottom-8 relative z-10">


                                        {/* Section Divider */}
                                        <div className="flex items-center gap-4 mb-6">
                                            <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
                                            <div className="px-4 py-1.5 rounded-full bg-slate-100/80 backdrop-blur-sm border border-slate-200 text-slate-500 text-[10px] font-bold uppercase tracking-widest shadow-sm">
                                                Today's Timeline
                                            </div>
                                            <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
                                        </div>

                                        <div className="flex items-center justify-between px-2 mb-4">
                                            <h3 className="text-slate-800 font-bold text-lg tracking-tight">Activity Feed</h3>
                                            <span className="text-[10px] uppercase font-bold text-slate-500 bg-white border border-slate-100 px-2 py-1 rounded-lg shadow-sm">
                                                {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' })}
                                            </span>
                                        </div>

                                        {todayLogs.length === 0 ? (
                                            <div className="text-center p-8 bg-stone-50 rounded-2xl border-2 border-dashed border-stone-100 text-stone-300 font-medium">
                                                No work logged yet today
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {todayLogs.map(log => {
                                                    const contextDetails = getLogContextSnapshot(log);
                                                    const verification = getVerificationPresentation(log.verification?.status);
                                                    const createdById = log.meta?.createdByOperatorId || '';
                                                    const loggedBy = operatorNameById.get(createdById) || ownerDisplayName;
                                                    const primaryCropId = log.context.selection[0]?.cropId;
                                                    const cropColor = crops.find(crop => crop.id === primaryCropId)?.color || 'bg-slate-400';

                                                    return (
                                                        <DailyLogCard
                                                            key={log.id}
                                                            logId={log.id}
                                                            workDone={getPrimaryWorkDone(log)}
                                                            plotName={contextDetails.plotName}
                                                            cropName={contextDetails.cropName}
                                                            cropColor={cropColor}
                                                            loggedBy={loggedBy}
                                                            timeLabel={formatLogTime(log.meta?.createdAtISO)}
                                                            statusLabel={verification.label}
                                                            statusTone={verification.tone}
                                                            counts={{
                                                                cropActivities: log.cropActivities.length,
                                                                irrigation: log.irrigation.length,
                                                                labour: log.labour.length,
                                                                inputs: log.inputs.length
                                                            }}
                                                            summaryLines={getSummaryLines(log)}
                                                            onClick={() => handleEditLog(log)}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )}


                                    </div>
                                )}

                                {recordingSegment && (
                                    <div className="mt-6 text-center">
                                        <button
                                            onClick={() => { setRecordingSegment(null); setStatus('confirming'); }}
                                            className="text-stone-400 font-bold text-sm bg-stone-100 px-6 py-2 rounded-full hover:bg-stone-200"
                                        >
                                            Cancel & Go Back
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* PROCESSING / CONFIRM / SUCCESS */}
                    {status === 'processing' && (
                        <div className="bg-white rounded-3xl shadow-xl shadow-stone-200/50 border border-stone-100 p-16 text-center">
                            <div className="flex justify-center mb-8">
                                <div className="relative">
                                    <div className="w-24 h-24 border-4 border-stone-100 border-t-emerald-500 rounded-full animate-spin"></div>
                                    <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center"><Leaf size={32} className="text-emerald-600 animate-pulse" /></div>
                                </div>
                            </div>
                            <h3 className="text-xl font-bold text-stone-800 mb-3 leading-snug">Your Shram sathi is trying to understand what work you did today...</h3>
                            <div className="text-sm text-stone-400 max-w-xs mx-auto mt-2 italic">Listening carefully to your log...</div>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="animate-in fade-in duration-500 bg-gradient-to-br from-emerald-50 to-white rounded-3xl shadow-xl border border-emerald-100 p-8 text-center relative overflow-hidden">
                            {/* Decorative Background Elements */}
                            <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500/20"></div>
                            <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-100 rounded-full blur-3xl opacity-50"></div>

                            <div className="relative z-10">
                                <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 text-emerald-600 shadow-sm border border-emerald-50">
                                    <Leaf size={40} className="drop-shadow-sm" />
                                </div>
                                <h2 className="text-3xl font-bold text-stone-800 mb-6 tracking-tight">Saved to Ledger</h2>

                                {/* Dynamic Feedback Summary */}
                                {lastSavedLogSummary && lastSavedLogSummary.length > 0 ? (
                                    <div className="mb-8 space-y-3">
                                        {lastSavedLogSummary.map((item, idx) => (
                                            <div key={idx} className="bg-white rounded-2xl p-5 border border-emerald-100 shadow-sm relative overflow-hidden group">
                                                <div className="absolute inset-0 bg-emerald-50/50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                                <p className="text-stone-700 font-medium text-lg relative z-10">
                                                    I Understood your <span className="font-bold text-emerald-600 text-xl">{item.count}</span> activities for <span className="font-bold text-stone-900">{item.cropName}</span>
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-stone-500 mb-8">Your activity has been logged successfully.</p>
                                )}

                                <div className="flex flex-col gap-3">
                                    {/* Review Details Button (New) */}
                                    {lastSavedLogIds && lastSavedLogIds.length > 0 && (
                                        <button
                                            onClick={() => {
                                                const logId = lastSavedLogIds[0];
                                                const logToEdit = history.find(l => l.id === logId) || mockHistory.find(l => l.id === logId);
                                                if (logToEdit) {
                                                    // Trigger Edit Logic (Copied from ReflectPage onEditLog)
                                                    handleEditLog(logToEdit);
                                                }
                                            }}
                                            className="w-full bg-white text-emerald-700 border border-emerald-200 py-4 rounded-xl font-bold text-lg hover:bg-emerald-50 transition-colors mb-1"
                                        >
                                            Review Details
                                        </button>
                                    )}

                                    <button onClick={() => setMainView('reflect')} className="w-full bg-stone-100 text-stone-700 py-4 rounded-xl font-bold text-lg hover:bg-stone-200 transition-colors">
                                        View Activity Heatmap
                                    </button>
                                    <button onClick={handleReset} className="w-full bg-stone-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-emerald-800 transition-colors shadow-lg shadow-emerald-900/20">
                                        Add Another Log
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}


                    {/* SATHI LOG WIZARD */}
                    <LogWizardContainer
                        isOpen={showLogWizard}
                        onClose={() => setShowLogWizard(false)}
                        profile={farmerProfile}
                        crops={crops}
                        onSubmit={(data) => {
                            console.log("Wizard Submitted:", data);
                            setShowLogWizard(false);
                            setStatus('success');
                        }}
                    />


                </>
            )}

            {/* GLOBAL SHEETS */}
            <TaskCreationSheet
                isOpen={showTaskCreationSheet}
                onClose={() => setShowTaskCreationSheet(false)}
                onSave={handleSaveTask}
                crops={crops}
                selectedCropId={crops[0]?.id}
                people={farmerProfile.operators.map(op => ({ ...op, isActive: op.isActive ?? true }))}
            />

            {/* DFES Phase 0: Review Inbox Sheet */}
            <ReviewInboxSheet
                isOpen={showReviewInbox}
                onClose={() => setShowReviewInbox(false)}
                logs={history}
                operators={farmerProfile.operators}
                currentOperatorId={farmerProfile.activeOperatorId || 'owner'}
                onApproveLog={(logId) => handleVerifyLog(logId, LogVerificationStatus.APPROVED)}
                onApproveAll={(logIds) => logIds.forEach(id => handleVerifyLog(id, LogVerificationStatus.APPROVED))}
                onDisputeLog={(logId, note) => handleVerifyLog(logId, LogVerificationStatus.REJECTED, note)}
            />

            {/* DFES: QuickLogSheet (INT-3 Voice Integration) */}
            <QuickLogSheet
                isOpen={showQuickLog}
                onClose={() => setShowQuickLog(false)}
                onVoiceStart={() => {
                    setMode('voice');
                    setStatus('idle');
                }}
                onTypeSelect={(type) => {
                    if (type === 'no_work') {
                        setMode('manual');
                        setStatus('idle');
                    } else {
                        setMode('manual');
                        setStatus('idle');
                        setRecordingSegment(type as LogSegment);
                    }
                }}
            />

            {/* DFES: FAB to open QuickLogSheet (visible on main log view when idle) */}
            {
                currentRoute === 'main' && mainView === 'log' && status === 'idle' && !recordingSegment && hasActiveLogContext && (
                    <button
                        onClick={() => setShowQuickLog(true)}
                        className="fixed bottom-24 left-4 z-40 w-14 h-14 bg-white text-emerald-600 rounded-full shadow-lg shadow-emerald-900/10 border border-emerald-100 flex items-center justify-center active:scale-95 transition-transform"
                        aria-label="Quick Log"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                )
            }
        </div >
    );
};

export default AppRouter;
