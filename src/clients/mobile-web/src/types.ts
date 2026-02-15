/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BACKWARD COMPATIBILITY LAYER
 *
 * This file re-exports types from their canonical locations for backward compatibility.
 * New code should import directly from:
 *   - src/domain/types/ for domain types
 *   - src/features/{feature}/ for feature-specific types
 *
 * @deprecated Import directly from src/domain/types/ instead
 */

// =============================================================================
// DOMAIN TYPES (Re-export from canonical location)
// =============================================================================

// Weather types
export type {
    WeatherStamp,
    WeatherEventType,
    WeatherEvent,
    FarmerReactionType,
    WeatherReaction,
    WeatherSnapshot,
    DailyForecast,
    DetailedWeather,
} from './domain/types/weather.types';

// Log types - Core events
export type {
    LogApplyPolicy,
    LogScope,
    CropActivityEvent,
    IrrigationEvent,
    LabourEvent,
    InputMethod,
    InputReason,
    InputMixItem,
    InputEvent,
    MachineryEvent,
    ExpenseItem,
    ActivityExpenseEvent,
    ResourceItem,
} from './domain/types/log.types';

// Log types - Observations & Tasks
export type {
    ObservationNoteType,
    ObservationSeverity,
    ObservationSource,
    TaskCandidate,
    ObservationNote,
    PlannedTask,
} from './domain/types/log.types';

// Log types - Disturbance & Issues
export type {
    DayOutcome,
    DisturbanceScope,
    LogSegment,
    DisturbanceEvent,
    BucketIssueType,
    BucketIssueSeverity,
    BucketIssue,
} from './domain/types/log.types';

// Log types - Verification & Meta
export type {
    CropPhase,
    LogMeta,
    VerificationRecord,
    VerificationTransition,
    LogVerification,
    HarvestUnit,
} from './domain/types/log.types';

// Log types - Timeline
export type {
    TranscriptSnapshot,
    LogTimelineEntry,
    DayTranscriptSummary,
} from './domain/types/log.types';

// Log types - Aggregate & Response
export type {
    QuestionForUser,
    DailyLog,
    UnclearReason,
    UnclearSegment,
    AgriLogResponse,
} from './domain/types/log.types';

// Log types - Context
export type {
    SelectedCropContext,
    FarmContext,
} from './domain/types/log.types';

// Log enum + migration helpers (value exports)
export { LogVerificationStatus, migrateVerificationStatus, isV1Status } from './domain/types/log.types';

// Farm types - Units & Geo
export type {
    LandUnit,
    GeoPoint,
    PlotGeo,
    PlotGeoData,
} from './domain/types/farm.types';

// Farm types - Plot & Crop
export type {
    PlotBaseline,
    LandPrepInfo,
    PlantingMaterial,
    DripDetails,
    PlotInfrastructure,
    Plot,
    CropLifecycle,
    WorkflowStep,
    SeedInfo,
    CropProfile,
} from './domain/types/farm.types';

// Farm types - Infrastructure
export type {
    WaterResource,
    PowerSchedule,
    ElectricitySchedule,
    ElectricityPatternMode,
    ElectricityRepeatRule,
    ElectricityWeekType,
    ElectricityOffWindow,
    ElectricityPhaseSchedule,
    ElectricityTimingConfiguration,
    FarmMotor,
    FarmMachinery,
    FarmInfrastructure,
    FarmLocation,
} from './domain/types/farm.types';

// Farm types - Trust & Profile
export type {
    FarmTrustSettings,
    Person,
    FarmOperator,
    FarmerProfile,
} from './domain/types/farm.types';

// Farm types - Settings & State
export type {
    LabourShift,
    LedgerDefaults,
    InputMode,
    AppStatus,
    PageView,
    AppRoute,
    AudioData,
    AppConfig,
    AgriLogEntry,
    TodayCounts,
    TranscriptionSegment,
    TranscriptionResponse,
} from './domain/types/farm.types';

// Farm enums (value exports)
export {
    OperatorCapability,
    VerificationStatus,
    ActivityType,
    Emotion,
} from './domain/types/farm.types';

// Summary types - Daily & Compare
export type {
    DayWorkSummary,
    LabourSummary,
    IrrigationSummary,
    MachinerySummary,
    InputsSummary,
    InputItem,
    NotesSummary,
    CostBreakdown,
    StageCode,
    StageComparisonUnit,
    ExecutionBucket,
    PlannedItem,
    ExecutedItem,
    PlotComparisonSummary,
    ComparePageState,
    IssueSummary,
} from './domain/types/summary.types';

// =============================================================================
// FEATURE-SPECIFIC TYPES (Re-export for backward compatibility)
// =============================================================================

// Scheduler types
export type {
    ScheduleReferenceType,
    ScheduleOwnerType,
    StageTemplate,
    OperationCategory,
    OperationType,
    FrequencyMode,
    PeriodicExpectation,
    OneTimeExpectation,
    CropScheduleTemplate,
    StageOverride,
    ExpectationOverride,
    PlotScheduleInstance,
    ScheduleShiftEvent,
    IrrigationFrequency,
    IrrigationTimeWindow,
    IrrigationPlan,
    PlotIrrigationConfig,
} from './features/scheduler/scheduler.types';

// Re-export StageCode from scheduler (it's duplicated in summary.types for domain purity)
export type { StageCode as SchedulerStageCode } from './features/scheduler/scheduler.types';

// Procurement types
export type {
    ExpenseScope,
    ExpenseCategory,
    ExpenseLineItem,
    ProcurementExpense,
    ReceiptExtractionResponse,
    ExpenseSummaryByScope,
} from './features/procurement/procurement.types';

// Harvest types
export * from './features/logs/harvest.types';
