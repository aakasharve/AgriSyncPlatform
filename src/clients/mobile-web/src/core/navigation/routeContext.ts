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
    completedCount: number;
    plannedCount: number;
    pendingCount: number;
    unverifiedCount: number;
}

export interface CostSnapshot {
    today: number;
    cropSoFar: number;
    unverifiedToday: number;
}

export interface AppRouterContext {
    // navigation
    currentRoute: Navigation['currentRoute'];
    setCurrentRoute: Navigation['setCurrentRoute'];
    mainView: Navigation['mainView'];
    setMainView: Navigation['setMainView'];

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

    // weather
    weatherData: WeatherState['weatherData'];

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
    reflectFocusRequest: { logId: string; date: string; plotId?: string } | null;
    setReflectFocusRequest: React.Dispatch<React.SetStateAction<{ logId: string; date: string; plotId?: string } | null>>;
    showCloseDaySummary: boolean;
    setShowCloseDaySummary: React.Dispatch<React.SetStateAction<boolean>>;
    showCloseYesterdaySummary: boolean;
    setShowCloseYesterdaySummary: React.Dispatch<React.SetStateAction<boolean>>;

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
