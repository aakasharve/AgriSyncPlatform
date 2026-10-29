// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// Shared context shape passed to every route-render function. AppRouter builds
// this once per render and hands it to the route table. Keeps route render
// functions free of hook calls (which would violate React's rules-of-hooks
// when called conditionally inside the cascade).
//
// We derive most of the field types from the existing AppFeature contexts'
// ReturnType — this keeps the context faithful to the source of truth instead
// of duplicating function signatures.

import React from 'react';
import { DailyLog } from '../../types';
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

type Navigation = ReturnType<typeof useAppNavigationState>;
type LogContext = ReturnType<typeof useAppLogState>;
type DataState = ReturnType<typeof useAppDataState>;
type VoiceState = ReturnType<typeof useAppVoiceState>;
type CommandsState = ReturnType<typeof useAppCommandsState>;
type WeatherState = ReturnType<typeof useAppWeatherState>;
type TrustState = ReturnType<typeof useAppTrustState>;
type UiRuntime = ReturnType<typeof useAppUiRuntime>;
type ViewHelpers = ReturnType<typeof useAppViewHelpers>;

export interface DayStateSnapshot {
    closurePercent: number;
    isClosed: boolean;
    /**
     * spec: dfes-companion-2026-07-11 (wave-2.4 follow-up) — false only when the
     * day has nothing planned AND nothing recorded. Carried through to the view
     * (rather than re-derived from `closurePercent === 0` at each render site)
     * so the ring, the closure label and the yesterday banner all answer
     * "has this day begun?" from the ONE fact computeDayState decided it with.
     */
    hasStarted: boolean;
    completedCount: number;
    plannedCount: number;
    pendingCount: number;
    unverifiedCount: number;
}

export interface CostSnapshot {
    today: number;
    cropSoFar: number;
    unverifiedToday: number;
    /** What the three figures cover: a plot's name, a crop's name, or "संपूर्ण शेत". */
    scopeLabel: string;
}

export interface AppRouterContext {
    /**
     * The session's ACTIVE farm (FarmContext.currentFarmId), threaded through
     * so hook-free route render functions can reach it.
     *
     * BUGFIX_2026-07-19: the DFES understanding bar previously sourced its farm
     * from the saved log's own `context.selection[0].farmId`, which is OPTIONAL
     * (log.types.ts, "Phase 7 - needed for finance tracking") and is never
     * populated by LogContext/useLogCommands. So it was ALWAYS undefined,
     * useDayUnderstanding short-circuited on `!farmId` before issuing any
     * request, and the bar sat on its "अजून समजतंय…" pending state forever —
     * for every farmer, no matter what the server had scored. Verified live:
     * zero GET /shramsafal/day-understanding calls ever reached the backend.
     */
    activeFarmId: string | null;

    // navigation
    currentRoute: Navigation['currentRoute'];
    setCurrentRoute: Navigation['setCurrentRoute'];
    /** A screen's own back button: where he came from, else the given parent (WP-6). */
    goBackOr: Navigation['goBackOr'];
    /**
     * Opens a PLACE over the home tabs (its मागे returns home) — the bottom bar's open. Optional so
     * older context builders compile; merge-review m1: the work home's हजेरी door uses it.
     */
    openPlace?: Navigation['openPlace'];
    /**
     * spec: plr-d10 (I14, CMP-3) — home tabs this person may not open (`hiddenViews.ts`: a worker gets
     * no तुलना). Optional so a ctx built without a farm role (the dev previews, tests) hides nothing.
     */
    hiddenViews?: readonly Navigation['mainView'][];
    mainView: Navigation['mainView'];
    setMainView: Navigation['setMainView'];
    // spec: 2026-07-13-labour-attendance-approval-design (Task 3.4) — "why am
    // I here" hint carried from the labour feature into the log page.
    logIntent: Navigation['logIntent'];
    setLogIntent: Navigation['setLogIntent'];
    // spec: 2026-07-13-labour-attendance-approval-design (Task 3.5) — ids of
    // the log(s) saved while logIntent === 'labour'; threaded to the labour
    // route so it can render a "just logged" labour-only summary.
    lastLabourLogIds: Navigation['lastLabourLogIds'];
    // spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — the आजची कामे tab card was tapped:
    // the log tab answers with its work home, fresh. Optional so older context builders compile.
    logHomePending?: boolean;
    consumeLogHome?: () => void;
    /** The server-told role on the current farm (/me/context), e.g. 'PrimaryOwner', 'Worker'. */
    farmRole?: string | null;
    /** The work home's "आजची हजेरी" door: owner tier or the owner's labour grant only (H10). */
    canOpenAttendanceFromHome?: boolean;

    // log/context
    logScope: LogContext['logScope'];
    setLogScope: LogContext['setLogScope'];
    currentLogContext: LogContext['currentLogContext'];
    hasActiveLogContext: LogContext['hasActiveLogContext'];
    isContextReady: LogContext['isContextReady'];

    // data
    isDemoMode: DataState['isDemoMode'];
    setIsDemoMode: DataState['setIsDemoMode'];
    farmerProfile: DataState['farmerProfile'];
    setFarmerProfile: DataState['setFarmerProfile'];
    crops: DataState['crops'];
    handleUpdateCrops: DataState['handleUpdateCrops'];
    handleAddPerson: DataState['handleAddPerson'];
    handleDeletePerson: DataState['handleDeletePerson'];
    setLedgerDefaults: DataState['setLedgerDefaults'];
    ledgerDefaults: DataState['ledgerDefaults'];
    userResources: DataState['userResources'];
    setUserResources: DataState['setUserResources'];
    plannedTasks: DataState['plannedTasks'];
    handleSaveTask: DataState['handleSaveTask'];
    handleUpdateTask: DataState['handleUpdateTask'];
    showTaskCreationSheet: DataState['showTaskCreationSheet'];
    setShowTaskCreationSheet: DataState['setShowTaskCreationSheet'];

    // history (computed from demo/real)
    history: DailyLog[];
    mockHistory: DataState['mockHistory'];

    // voice/UI status
    status: VoiceState['status'];
    setStatus: VoiceState['setStatus'];
    mode: VoiceState['mode'];
    setMode: VoiceState['setMode'];
    recordingSegment: VoiceState['recordingSegment'];
    setRecordingSegment: VoiceState['setRecordingSegment'];
    handleAudioReady: VoiceState['handleAudioReady'];
    handleTextReady: VoiceState['handleTextReady'];
    error: VoiceState['error'];
    errorTranscript: VoiceState['errorTranscript'];
    draftLog: VoiceState['draftLog'];
    setDraftLog: VoiceState['setDraftLog'];
    provenance: VoiceState['provenance'];
    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2.
    // Surfaces the Sarvam transcribe-stream lifecycle to render-functions
    // so mainView can mount <LiveCaption /> alongside AudioRecorderStreaming.
    voiceStreamingPhase: VoiceState['voiceStreamingPhase'];
    liveCaption: VoiceState['liveCaption'];

    // dfes-companion Phase 4 — voice-continuity ladder outcome.
    continuityLevel: VoiceState['continuityLevel'];
    savedPendingCaptureId: VoiceState['savedPendingCaptureId'];
    /**
     * PLR-D10 I13 — the recording the voice auto-save just wrote, for the ONE result screen. Shown only
     * while it is the latest save (`lastSavedLogIds`). Optional so older context builders compile.
     */
    voiceResult?: VoiceState['voiceResult'];

    // weather
    weatherData: WeatherState['weatherData'];
    weatherStatus: WeatherState['weatherStatus'];
    boundaryUnset: WeatherState['boundaryUnset'];
    refetchWeather: WeatherState['refetchWeather'];

    // commands / trust
    handleManualSubmit: CommandsState['handleManualSubmit'];
    handleUpdateNote: CommandsState['handleUpdateNote'];
    handleVerifyLog: TrustState['handleVerifyLog'];

    // ui runtime
    handleReset: UiRuntime['handleReset'];
    lastSavedLogSummary: UiRuntime['lastSavedLogSummary'];
    lastSavedLogIds: UiRuntime['lastSavedLogIds'];

    // view helpers
    getTodayCounts: ViewHelpers['getTodayCounts'];
    getContextColorIndicator: ViewHelpers['getContextColorIndicator'];

    // local-only state (lifted into AppRouter and threaded down)
    showReviewInbox: boolean;
    setShowReviewInbox: React.Dispatch<React.SetStateAction<boolean>>;
    showQuickLog: boolean;
    setShowQuickLog: React.Dispatch<React.SetStateAction<boolean>>;
    /**
     * wave-3.10, founder decision 8 (2026-08-16) — the optional reason chips shown after
     * he taps `आज काम नाही`. Skipping them still saves the day (doctrine P9).
     */
    showNoWorkReason: boolean;
    setShowNoWorkReason: React.Dispatch<React.SetStateAction<boolean>>;
    reflectFocusRequest: { logId: string; date: string; plotId?: string } | null;
    setReflectFocusRequest: React.Dispatch<React.SetStateAction<{ logId: string; date: string; plotId?: string } | null>>;
    /**
     * spec: plr-d10 (I14, H16) — open पूर्ण शेतीचा आढावा narrowed to ONE plot (a लक्ष द्या "तुकडा पहा" card).
     * Read once by `ReflectPage`, then cleared. Optional so a ctx built without it (the dev previews, tests)
     * simply opens the whole farm.
     */
    reflectFocusPlotId?: string | null;
    setReflectFocusPlotId?: (plotId: string | null) => void;
    // FINDING F3 — `showCloseDaySummary` / `showCloseYesterdaySummary` were
    // removed from this contract. Their only readers went with the Daily
    // Closure card in commit `0e4ad118` (spec §4.2 moved it into the waiting
    // drawer), so the fields survived as a type that let three call sites
    // keep writing to nothing. Keeping them typed here is what made the dead
    // path compile.

    // derived presentation
    ownerDisplayName: string;
    operatorNameById: Map<string, string>;
    todayDateKey: string;
    yesterdayDate: string;
    todayLogs: DailyLog[];
    todayDayState: DayStateSnapshot;
    yesterdayDayState: DayStateSnapshot;
    costSnapshot: CostSnapshot;
    yesterdayCost: number;

    // log-card helpers (kept here so MainLogView doesn't redefine them)
    handleEditLog: (log: DailyLog) => void;
    getLogContextSnapshot: (log: DailyLog) => { cropName: string; plotName: string; plotId?: string };
}
