/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain Types Index
 *
 * This is the canonical location for all domain types.
 * All types here are pure domain concepts with no UI or infrastructure dependencies.
 *
 * Layer Rules:
 * - domain/types/ has zero dependency on features\/, application\/, or infrastructure\/
 * - application/ may import domain/types/
 * - features/ may import domain/types/ and application/
 * - infrastructure/ may import domain/types/ (but no UI components)
 *
 * Migration Note:
 * Types relocated here out of src/types.ts and src/features/logs/logs.types.ts.
 * The old locations re-export these types for backward compatibility.
 */

// =============================================================================
// WEATHER TYPES
// =============================================================================

export type {
    WeatherStamp,
    WeatherEventType,
    WeatherEvent,
    FarmerReactionType,
    WeatherReaction,
    WeatherSnapshot,
    DailyForecast,
    DetailedWeather,
} from './weather.types';

// =============================================================================
// LOG TYPES (Execution Ledger)
// =============================================================================

export type {
    // Scope
    LogApplyPolicy,
    LogScope,

    // Events
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

    // Observations & Tasks
    ObservationNoteType,
    ObservationSeverity,
    ObservationSource,
    TaskCandidate,
    ObservationNote,
    PlannedTask,

    // Disturbance
    DayOutcome,
    DisturbanceScope,
    LogSegment,
    DisturbanceEvent,
    BucketIssueType,
    BucketIssueSeverity,
    BucketIssue,

    // Harvest (inline)
    HarvestUnit,

    // Verification
    CropPhase,
    LogMeta,
    VerificationRecord,
    VerificationTransition,
    LogVerification,

    // Timeline
    TranscriptSnapshot,
    LogTimelineEntry,
    DayTranscriptSummary,

    // Questions
    QuestionForUser,

    // Aggregate Root
    DailyLog,

    // AI Response
    UnclearReason,
    UnclearSegment,
    AgriLogResponse,

    // Context
    SelectedCropContext,
    FarmContext,
} from './log.types';

// Enum + function exports (enums need value export, not just type)
export { LogVerificationStatus, migrateVerificationStatus, isV1Status } from './log.types';

// =============================================================================
// FARM TYPES
// =============================================================================

export type {
    // Units
    LandUnit,

    // Geo
    GeoPoint,
    PlotGeo,
    PlotGeoData,

    // Plot
    PlotBaseline,
    LandPrepInfo,
    PlantingMaterial,
    DripDetails,
    PlotInfrastructure,
    Plot,

    // Crop
    CropLifecycle,
    WorkflowStep,
    SeedInfo,
    CropProfile,

    // Infrastructure
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

    // Trust
    FarmTrustSettings,
    Person,
    FarmOperator,

    // Profile
    FarmerProfile,

    // Settings
    LabourShift,
    LedgerDefaults,

    // App State
    InputMode,
    AppStatus,
    PageView,
    AppRoute,
    AudioData,
    AppConfig,

    // Legacy
    AgriLogEntry,
    TodayCounts,
    TranscriptionSegment,
    TranscriptionResponse,
} from './farm.types';

// Enum exports (enums need value export)
export {
    OperatorCapability,
    VerificationStatus,
    ActivityType,
    Emotion,
} from './farm.types';

// =============================================================================
// SUMMARY TYPES (Reflect/Compare)
// =============================================================================

export type {
    // Daily Summary
    DayWorkSummary,
    LabourSummary,
    IrrigationSummary,
    MachinerySummary,
    InputsSummary,
    InputItem,
    NotesSummary,
    CostBreakdown,

    // Compare
    StageCode,
    StageComparisonUnit,
    ExecutionBucket,
    PlannedItem,
    ExecutedItem,
    PlotComparisonSummary,
    ComparePageState,
} from './summary.types';
