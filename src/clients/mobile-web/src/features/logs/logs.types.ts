/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Log Types - Feature Layer
 *
 * BACKWARD COMPATIBILITY: This file re-exports from domain/types/log.types.ts
 * New code should import directly from src/domain/types/log.types
 *
 * @deprecated Import from src/domain/types/ instead
 */

// Re-export all log types from domain layer
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

    // Harvest
    HarvestUnit,

    // Verification
    CropPhase,
    LogMeta,
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
} from '../../domain/types/log.types';

// Enum export (value export)
export { LogVerificationStatus } from '../../domain/types/log.types';
