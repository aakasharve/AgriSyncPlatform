/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Builds an `AppRouterContext` (`core/navigation/routeContext.ts`) from
 * seeded, in-memory state instead of the real `useAppData` /
 * `useVoiceRecorder` / `useLogCommands` / `useWeatherMonitor` /
 * `useTrustLayer` hooks `useAgriLogApp` composes in the real app.
 *
 * WHY NOT THE REAL HOOKS: every one of those five is deeply wired to a
 * backend or Dexie WRITE path — `useAppData` persists through
 * `DataSourceProvider`, `useVoiceRecorder` calls `BackendAiClient`,
 * `useWeatherMonitor` calls `BackendWeatherClient`, `useLogCommands` /
 * `useTrustLayer` queue real mutations. None of that is available or wanted
 * here (task hard constraint: no backend, no Dexie writes). This hook
 * satisfies the exact SAME `AppRouterContext` shape `AppRouter.tsx` builds
 * — so `mainView.tsx`'s `renderLogView` / `renderReflectView` /
 * `renderCompareView` (real, unmodified, imported as-is) render for real —
 * with local `useState` standing in for those five hooks.
 *
 * WHAT IS REAL, NOT STUBBED, IN THIS HOOK:
 *  - `useLogContext()` (`app/context/LogContext.tsx`) — pure client state,
 *    no backend. Plot/crop selection behaves EXACTLY as the real app: the
 *    same `LogProvider` component, not a fork.
 *  - `useAppNavigation()` (`app/hooks/useAppNavigation.ts`) — pure client
 *    state, no backend.
 *  - `useAppRouterDerivations()` (`core/navigation/hooks/`) — pure
 *    derivation over the seeded `history`/`crops`/`farmerProfile`. Its one
 *    non-pure read, `financeSelectors` -> `financeService`, is a
 *    documented DEXIE-READ-ONLY cache (`financeService.ts` header: "Dexie
 *    Reads Only") — so `costSnapshot`/`yesterdayCost` reflect whatever is
 *    honestly cached in this browser's local IndexedDB, never a fabricated
 *    number, and never written to.
 *  - `getTodayCounts` / `buildContextColorIndicator` — the SAME pure
 *    helpers `AppContent.tsx` feeds `AppFeatureProviders` today
 *    (`app/helpers/appContentDailyCounts.ts` /
 *    `appContentContextDisplay.tsx`).
 *
 * WHAT IS AN HONEST STUB (never fakes success): `voice` (recording/parsing
 * needs a backend STT+AI pipeline that does not exist here — the recorder UI
 * still renders, pressing it will not silently pretend to save anything),
 * `weather` (no farm boundary/location behind this seed, so `status:
 * 'no-location'` — the REAL `WeatherWidget` renders its own honest
 * no-location fallback, not a fabricated forecast), `commands` / `trust`
 * (manual submit / note edit / verify — each calls `notify()` instead of
 * touching Dexie or a backend, so the farmer-facing message is "not
 * available here", never a fake success toast).
 */
import { useCallback, useState } from 'react';

import { useLogContext } from '../../../app/context/LogContext';
import type { ManualSubmitOutcome } from '../../../app/hooks/useLogCommands.types';
import { useAppNavigation } from '../../../app/hooks/useAppNavigation';
import { useAppRouterDerivations } from '../../../core/navigation/hooks/useAppRouterDerivations';
import type { AppRouterContext } from '../../../core/navigation/routeContext';
import { getTodayCounts as deriveTodayCounts } from '../../../app/helpers/appContentDailyCounts';
import { buildContextColorIndicator } from '../../../app/helpers/appContentContextDisplay';
import type { WeatherStatus } from '../../weather/useWeatherMonitor';
import type {
    AgriLogResponse,
    AppStatus,
    CropProfile,
    DailyLog,
    DetailedWeather,
    FarmerProfile,
    InputMode,
    LedgerDefaults,
    LogSegment,
    LogVerificationStatus,
    PlannedTask,
    Person,
    ResourceItem,
} from '../../../types';

export interface PreviewDataState {
    crops: CropProfile[];
    setCrops: (crops: CropProfile[]) => void;
    farmerProfile: FarmerProfile;
    setFarmerProfile: React.Dispatch<React.SetStateAction<FarmerProfile>>;
    history: DailyLog[];
    plannedTasks: PlannedTask[];
    setPlannedTasks: React.Dispatch<React.SetStateAction<PlannedTask[]>>;
    ledgerDefaults: LedgerDefaults;
    setLedgerDefaults: (v: LedgerDefaults) => void;
}

export interface UsePreviewRouterCtxResult {
    ctx: AppRouterContext;
    /** Non-null while an honest "not available in this preview" notice
     * should be shown (manual submit / verify / voice capture — anything
     * that would otherwise need a backend or a Dexie write). */
    notice: string | null;
    dismissNotice: () => void;
}

export function usePreviewRouterCtx(data: PreviewDataState): UsePreviewRouterCtxResult {
    const navigation = useAppNavigation();
    const context = useLogContext();

    const [notice, setNotice] = useState<string | null>(null);
    const notify = useCallback((message: string) => setNotice(message), []);
    const dismissNotice = useCallback(() => setNotice(null), []);

    // ── Voice / capture status — local, honest stub (no backend pipeline). ──
    const [status, setStatus] = useState<AppStatus>('idle');
    const [mode, setMode] = useState<InputMode>('voice');
    const [recordingSegment, setRecordingSegment] = useState<LogSegment | null>(null);
    const [draftLog, setDraftLog] = useState<AgriLogResponse | null>(null);
    const [error] = useState<string | null>(null);

    const handleAudioReady = useCallback(async () => {
        notify('Voice capture needs the AI backend — not available in this preview.');
    }, [notify]);
    const handleTextReady = useCallback(async () => {
        notify('Voice capture needs the AI backend — not available in this preview.');
    }, [notify]);

    // ── Weather — honest "no location behind this seed" state. The REAL
    // WeatherWidget (mounted by the REAL CompactWeatherChip on tap) owns
    // rendering its own no-location fallback; nothing here fabricates a
    // forecast. ──
    const [weatherData] = useState<DetailedWeather | undefined>(undefined);
    const [weatherStatus] = useState<WeatherStatus>('no-location');
    const refetchWeather = useCallback(() => {
        notify('Weather needs a farm location + the backend — not available in this preview.');
    }, [notify]);

    // ── Commands / trust — never a Dexie write, never a fake success. ──
    // Returns `'not_saved'` — the literal truth. `release/wave-1` widened this
    // contract from `Promise<void>` to `Promise<ManualSubmitOutcome>` while this
    // preview was on its own branch, so the merge surfaced the drift. The union
    // offers 'saved' | 'saved_with_warning' | 'not_saved' | 'already_saving';
    // this stub writes nothing, so anything but 'not_saved' would be the fake
    // success the comment above promises never to mint (doctrine P4).
    const handleManualSubmit = useCallback(async (): Promise<ManualSubmitOutcome> => {
        notify('Saving is disabled in this preview (no backend, no Dexie writes).');
        return 'not_saved';
    }, [notify]);
    const handleUpdateNote = useCallback(() => {
        notify('Editing notes is disabled in this preview.');
    }, [notify]);
    const handleVerifyLog = useCallback((_logId: string, _status: LogVerificationStatus, _notes?: string) => {
        notify('Verifying logs is disabled in this preview.');
    }, [notify]);

    // ── UI runtime ──
    const handleReset = useCallback(() => {
        setStatus('idle');
        setMode('voice');
        setDraftLog(null);
        setRecordingSegment(null);
    }, []);

    // ── Local-only sheet state (unused by the log/reflect/compare views
    // this preview renders, but part of AppRouterContext's shape). ──
    const [showReviewInbox, setShowReviewInbox] = useState(false);
    const [showQuickLog, setShowQuickLog] = useState(false);
    const [reflectFocusRequest, setReflectFocusRequest] = useState<{ logId: string; date: string; plotId?: string } | null>(null);
    const [userResources, setUserResources] = useState<ResourceItem[]>([]);
    const [showTaskCreationSheet, setShowTaskCreationSheet] = useState(false);

    const handleAddPerson = useCallback((person: Person) => {
        data.setFarmerProfile(prev => ({
            ...prev,
            operators: [...(prev.operators || []), {
                id: person.id || `preview_op_${Date.now()}`,
                name: person.name,
                role: 'WORKER',
                phone: person.phone,
                capabilities: [],
                isVerifier: false,
                isActive: true,
            }],
        }));
    }, [data]);

    const handleDeletePerson = useCallback((id: string) => {
        data.setFarmerProfile(prev => ({
            ...prev,
            operators: (prev.operators || []).filter(op => op.id !== id),
        }));
    }, [data]);

    const handleSaveTask = useCallback((task: PlannedTask) => {
        data.setPlannedTasks(prev => {
            const exists = prev.find(p => p.id === task.id);
            return exists ? prev.map(p => (p.id === task.id ? task : p)) : [...prev, task];
        });
    }, [data]);

    const handleUpdateTask = useCallback((id: string, updates: Partial<PlannedTask>) => {
        data.setPlannedTasks(prev => prev.map(t => (t.id === id ? { ...t, ...updates } : t)));
    }, [data]);

    const selectedScopeCropIds = context.logScope.selectedCropIds.filter(id => id && id !== 'FARM_GLOBAL');
    const selectedScopePlotIds = context.logScope.selectedPlotIds.filter(Boolean);

    const derivations = useAppRouterDerivations({
        farmerProfile: data.farmerProfile,
        crops: data.crops,
        history: data.history,
        plannedTasks: data.plannedTasks,
        selectedCropIds: selectedScopeCropIds,
        selectedPlotIds: selectedScopePlotIds,
    });

    // Mirrors AppRouter.tsx's own handleEditLog (same UX: tapping a
    // today's-activity card loads it back into the manual editor) — saving
    // it still routes through the honest `handleManualSubmit` stub above,
    // so "editing" here can never silently persist anything.
    const handleEditLog = useCallback((log: DailyLog) => {
        navigation.setMainView('log');
        const ctxSel = log.context.selection[0];
        context.setLogScope({
            selectedCropIds: [ctxSel.cropId],
            selectedPlotIds: ctxSel.selectedPlotIds,
            mode: 'single',
            applyPolicy: 'broadcast',
        });
        setMode('manual');
        setStatus('idle');
        setDraftLog({
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
        });
    }, [navigation, context]);

    const getTodayCounts = useCallback(
        (plotId: string, dateStr: string) => deriveTodayCounts(data.history, plotId, dateStr),
        [data.history],
    );
    const getContextColorIndicator = useCallback(
        () => buildContextColorIndicator(context, data.crops),
        [context, data.crops],
    );

    const ctx: AppRouterContext = {
        currentRoute: navigation.currentRoute,
        setCurrentRoute: navigation.setCurrentRoute,
        mainView: navigation.mainView,
        setMainView: navigation.setMainView,
        logIntent: navigation.logIntent,
        setLogIntent: navigation.setLogIntent,
        lastLabourLogIds: navigation.lastLabourLogIds,

        logScope: context.logScope,
        setLogScope: context.setLogScope,
        currentLogContext: context.currentLogContext,
        hasActiveLogContext: context.hasActiveLogContext,
        isContextReady: context.isContextReady,

        isDemoMode: true,
        setIsDemoMode: () => { /* always demo data in this preview */ },
        farmerProfile: data.farmerProfile,
        setFarmerProfile: data.setFarmerProfile,
        crops: data.crops,
        handleUpdateCrops: data.setCrops,
        handleAddPerson,
        handleDeletePerson,
        setLedgerDefaults: data.setLedgerDefaults,
        ledgerDefaults: data.ledgerDefaults,
        userResources,
        setUserResources,
        plannedTasks: data.plannedTasks,
        handleSaveTask,
        handleUpdateTask,
        showTaskCreationSheet,
        setShowTaskCreationSheet,

        history: data.history,
        mockHistory: data.history,

        status, setStatus,
        mode, setMode,
        recordingSegment, setRecordingSegment,
        handleAudioReady, handleTextReady,
        error, errorTranscript: undefined,
        draftLog, setDraftLog, provenance: null,
        voiceStreamingPhase: 'idle',
        liveCaption: '',
        // dfes-companion fields this preview harness must satisfy to be an
        // AppRouterContext. Inert on purpose: the preview stands in for five
        // real hooks with local useState (see this file's header), and none of
        // these five has a preview surface. Same shape the real supplier uses
        // for a session with no farm and no pending capture.
        continuityLevel: null,
        savedPendingCaptureId: null,
        activeFarmId: null,
        showNoWorkReason: false,
        setShowNoWorkReason: () => {},

        weatherData,
        weatherStatus,
        boundaryUnset: true,
        refetchWeather,

        handleManualSubmit, handleUpdateNote, handleVerifyLog,

        handleReset,
        lastSavedLogSummary: [],
        lastSavedLogIds: [],

        getTodayCounts,
        getContextColorIndicator,

        showReviewInbox, setShowReviewInbox,
        showQuickLog, setShowQuickLog,
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

    return { ctx, notice, dismissNotice };
}
