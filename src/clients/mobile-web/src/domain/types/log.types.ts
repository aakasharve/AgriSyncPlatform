/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain Log Types
 *
 * Pure domain types for the execution ledger (logs).
 * No imports from features/ or UI. This is the canonical location.
 *
 * Layer: Domain (can only import from other domain types)
 */

import type { WeatherStamp, WeatherSnapshot } from './weather.types';
import type { LogProvenance } from '../ai/LogProvenance';
import type { PatchEvent } from '../ledger/PatchEvent';

// =============================================================================
// LOG SCOPE (What context does a log apply to?)
// =============================================================================

export type LogApplyPolicy = 'broadcast' | 'ask' | 'ai_split';

export interface LogScope {
    // Primary Truth
    selectedPlotIds: string[];

    // Derived / Helper
    selectedCropIds: string[];

    // Mode
    mode: 'single' | 'multi'; // Derived from selectedPlotIds.length

    // Policy (How to apply a log to these plots)
    applyPolicy: LogApplyPolicy;
}

// =============================================================================
// CROP ACTIVITY EVENTS (The "Spine" of the ledger)
// =============================================================================

export interface CropActivityEvent {
    id: string;
    title: string; // Was taskName. Open-ended activity name (e.g. "Pruning", "Weeding")
    workTypes?: string[]; // Specific tasks inside this global holder (e.g. ["Pruning", "Weeding"])
    status?: 'completed' | 'partial' | 'pending' | 'gap_recorded';
    quantity?: number; // Was quantityCompleted
    unit?: string;
    notes?: string;
    areaCovered?: number;
    startTime?: string;
    endTime?: string;
    detectedCrop?: string;
    isCommonActivity?: boolean;
    tags?: string[];
    targetPlotName?: string; // For auto-bucketing

    // Harvest linkage (Phase 3)
    isHarvestActivity?: boolean;
    linkedHarvestSessionId?: string;
    harvestQuantity?: number;
    harvestUnit?: HarvestUnit;
    gradeEstimates?: {
        gradeId: string;
        estimatedPercentage: number;
    }[];

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;

    // Per-Bucket Issue (Phase 22)
    issue?: BucketIssue;
}

// =============================================================================
// IRRIGATION EVENTS
// =============================================================================

export interface IrrigationEvent {
    id: string;
    linkedActivityId?: string;
    method: string;
    source: string;
    durationHours?: number;
    waterVolumeLitres?: number;
    notes?: string;
    detectedCrop?: string;
    motorId?: string;
    targetPlotName?: string;

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;

    // Per-Bucket Issue (Phase 22)
    issue?: BucketIssue;
}

// =============================================================================
// LABOUR EVENTS
// =============================================================================

export interface LabourEvent {
    id: string;
    linkedActivityId?: string;
    type: 'HIRED' | 'CONTRACT' | 'SELF';
    shiftId?: string;
    maleCount?: number;
    femaleCount?: number;
    count?: number;
    wagePerPerson?: number;
    contractUnit?: 'Tree' | 'Acre' | 'Row' | 'Lump Sum';
    contractQuantity?: number;
    operatorId?: string;
    totalCost?: number;
    notes?: string;
    detectedCrop?: string;
    whoWorked?: 'OWNER' | 'OPERATOR' | 'HIRED_LABOUR' | 'UNKNOWN';
    activity?: string;
    targetPlotName?: string;

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;

    // Per-Bucket Issue (Phase 22)
    issue?: BucketIssue;
}

// =============================================================================
// INPUT EVENTS (Fertilizers, Pesticides, etc.)
// =============================================================================

export type InputMethod = 'Spray' | 'Drip' | 'Drenching' | 'Soil';
export type InputReason = 'Preventive' | 'Disease' | 'Pest' | 'Growth' | 'Deficiency' | 'Seller Advice' | 'Other';

export interface InputMixItem {
    id: string;
    productName: string;
    dose?: number;
    unit: string; // ml/L, g/L, kg/acre, etc.

    // Linkage for specific product in a mix
    linkedExpenseId?: string;
    linkedExpenseItemId?: string;
    costSource?: 'MANUAL' | 'PROCUREMENT';
}

export interface InputEvent {
    id: string;
    linkedActivityId?: string;

    // Expense linkage (Phase 3 No-Duplicate Rule)
    linkedExpenseId?: string;        // Link to ProcurementExpense
    linkedExpenseItemId?: string;    // Specific line item if expense has multiple
    costSource?: 'MANUAL' | 'PROCUREMENT';

    // Delivery
    method: InputMethod;

    // Carrier
    carrierType?: 'Blower' | 'Tank' | 'Hours' | 'Pati' | 'Bag' | 'Liters';
    carrierCount?: number; // e.g., 2 Blowers, 3 Hours, 10 Pati
    carrierCapacity?: number; // Snapshot of capacity at time of log (e.g. 600L)
    computedWaterVolume?: number; // Liters (Backend computed or Front-end estimated)

    // Mix
    mix: InputMixItem[];

    // Context
    reason?: InputReason;
    recommendedBy?: string; // "Seller", "Consultant Name"

    // Costs
    cost?: number; // Total cost of materials (optional capture)
    notes?: string;
    detectedCrop?: string;

    // Legacy fields for backward compatibility
    type?: 'fertilizer' | 'pesticide' | 'fungicide' | 'bio' | 'other' | 'unknown';
    productName?: string;
    quantity?: number;
    unit?: string;
    targetPlotName?: string;

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;

    // Per-Bucket Issue (Phase 22)
    issue?: BucketIssue;
}

// =============================================================================
// MACHINERY EVENTS
// =============================================================================

export interface MachineryEvent {
    id: string;
    linkedActivityId?: string;
    type: 'tractor' | 'tiller' | 'harvester' | 'drone' | 'sprayer' | 'unknown';
    ownership: 'owned' | 'rented' | 'unknown';
    hoursUsed?: number;
    rentalCost?: number;
    fuelCost?: number;
    targetPlotName?: string;
    notes?: string;

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;

    // Per-Bucket Issue (Phase 22)
    issue?: BucketIssue;
}

// =============================================================================
// EXPENSE EVENTS (Activity-linked expenses)
// =============================================================================

export interface ExpenseItem {
    id: string;
    name: string;
    qty?: number;
    unit?: string;
    unitPrice?: number;
    total?: number;
}

export interface ActivityExpenseEvent {
    id: string;
    reason: string;
    category?: string;
    vendor?: string;
    vendorPhone?: string;
    items: ExpenseItem[];
    totalAmount?: number;
    linkedActivityId?: string; // Link to specific activity
    observation?: string; // Optional: Links to a specific observation ID
    notes?: string;
    timestamp?: string;

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;
}

export interface ResourceItem {
    id: string;
    text: string;
    type: 'NUTRITION' | 'SPRAY' | 'ACTIVITY' | 'IRRIGATION';
    rate?: string;
    unit?: string;
    usageCount?: number;
}

// =============================================================================
// OBSERVATIONS & NOTES (Facts - immutable)
// =============================================================================

export type ObservationNoteType = 'observation' | 'issue' | 'tip' | 'reminder' | 'unknown';
export type ObservationSeverity = 'normal' | 'important' | 'urgent';
export type ObservationSource = 'voice' | 'manual';

export interface TaskCandidate {
    id: string;
    title: string;
    dueDate?: string;         // YYYY-MM-DD or null
    dueWindow?: { start: string; end: string };
    plotId: string;
    priority: 'normal' | 'high';
    status: 'suggested' | 'pending' | 'done';
    confidence: number;      // 0-100
    sourceNoteId: string;
    rawText?: string;       // Original text that triggered this
}

export interface ObservationNote {
    id: string;
    plotId: string;           // Required - always linked to a plot
    cropId?: string;          // Optional - crop if available
    dateKey: string;          // Required (YYYY-MM-DD)
    timestamp: string;        // ISO string

    // Content (IMMUTABLE - observations are facts, not mutable tasks)
    textRaw: string;          // Required - original voice/manual text (never lost)
    textCleaned?: string;     // Optional - AI cleaned/completed sentence with context

    // Classification
    noteType: ObservationNoteType;
    severity: ObservationSeverity;
    tags?: string[];          // e.g., ['leaf curl', 'wind', 'pump', 'weather']

    // Metadata
    source: ObservationSource;
    aiConfidence?: number;    // 0-100 (how confident AI was in classification)

    // @deprecated TASK TRACKING (TO BE REMOVED - use PlannedTask instead)
    status?: 'open' | 'resolved';
    resolvedAt?: string;
    extractedTasks?: TaskCandidate[];

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;
}

// =============================================================================
// PLANNED TASKS (Intent - mutable)
// =============================================================================

export interface PlannedTask {
    id: string;
    title: string;
    description?: string;

    // Temporal bounds (future)
    dueDate?: string;          // YYYY-MM-DD
    dueWindow?: { start: string; end: string };

    // Context binding
    plotId: string;
    cropId?: string;

    // Task lifecycle (mutable - tasks can change status)
    priority: 'normal' | 'high' | 'urgent';
    status: 'suggested' | 'pending' | 'in_progress' | 'done' | 'cancelled';

    // Assignment (Layer 3)
    assigneeId?: string; // Link to Person.id

    // Source attribution (CRITICAL for event-driven model)
    sourceType: 'ai_extracted' | 'observation_derived' | 'manual' | 'schedule';
    sourceObservationId?: string;  // Link back to ObservationNote IF derived from observation
    aiConfidence?: number;         // 0-100 if AI-extracted

    // Metadata
    createdAt: string;
    updatedAt?: string;
    completedAt?: string;
    tags?: string[];

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;
}

// =============================================================================
// DISTURBANCE EVENTS (Work Blockers)
// =============================================================================

export type DayOutcome = 'WORK_RECORDED' | 'DISTURBANCE_RECORDED' | 'NO_WORK_PLANNED' | 'IRRELEVANT_INPUT';
export type DisturbanceScope = 'FULL_DAY' | 'PARTIAL' | 'DELAYED';
export type LogSegment = 'crop_activity' | 'irrigation' | 'labour' | 'input' | 'machinery';

export interface DisturbanceEvent {
    scope: DisturbanceScope;
    group: string;
    reason: string;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH';
    blockedSegments: LogSegment[];
    note?: string;
    weatherEventId?: string; // Link to Weather Spine

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;
}

// =============================================================================
// BUCKET ISSUES (Per-activity issue tracking)
// =============================================================================

export type BucketIssueType = 'MACHINERY' | 'ELECTRICITY' | 'WEATHER' | 'WATER_SOURCE' | 'PEST' | 'DISEASE' | 'LABOR_SHORTAGE' | 'MATERIAL_SHORTAGE' | 'OTHER';
export type BucketIssueSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface BucketIssue {
    issueType: BucketIssueType;
    reason: string;
    note?: string;
    severity: BucketIssueSeverity;

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;
}

// =============================================================================
// HARVEST TYPES (Inline for domain purity)
// =============================================================================

export interface HarvestUnit {
    type: 'WEIGHT' | 'COUNT' | 'CONTAINER';

    // For WEIGHT
    weightUnit?: 'KG' | 'QUINTAL' | 'TON';

    // For CONTAINER
    containerName?: string;             // "Crate", "Bag", "Carret"
    containerSizeKg?: number;           // 10kg crate, 50kg bag

    // For COUNT
    countUnit?: string;                 // "pieces", "bunches"
}

// =============================================================================
// LOG VERIFICATION (Trust Layer — DFES V2)
// =============================================================================

export type CropPhase = 'LAND_PREPARATION' | 'CROP_CYCLE';

/**
 * LogVerificationStatus — the 5-state DFES verification model.
 *
 * V2 states (DFES MVP):
 *   DRAFT → CONFIRMED → VERIFIED → DISPUTED → CORRECTION_PENDING
 *
 * V1 states (deprecated, kept for migration compatibility):
 *   PENDING, APPROVED, REJECTED, AUTO_APPROVED
 *
 * Migration mapping (V1 → V2):
 *   PENDING      → DRAFT
 *   AUTO_APPROVED → CONFIRMED
 *   APPROVED     → VERIFIED
 *   REJECTED     → DISPUTED
 */
export enum LogVerificationStatus {
    // ── V2 (DFES MVP) ──────────────────────────────────
    DRAFT = 'DRAFT',                         // AI-parsed or manually entered, not yet reviewed
    CONFIRMED = 'CONFIRMED',                 // Operator saved/confirmed (or auto-confirmed by high-confidence AI)
    VERIFIED = 'VERIFIED',                   // Owner confirmed "this matches"
    DISPUTED = 'DISPUTED',                   // Owner flagged an issue
    CORRECTION_PENDING = 'CORRECTION_PENDING', // Transient: correction in progress after dispute

    // ── V1 (deprecated — kept for stored data migration) ──
    /** @deprecated Use DRAFT instead. Will be removed after migration. */
    PENDING = 'PENDING',
    /** @deprecated Use VERIFIED instead. Will be removed after migration. */
    APPROVED = 'APPROVED',
    /** @deprecated Use DISPUTED instead. Will be removed after migration. */
    REJECTED = 'REJECTED',
    /** @deprecated Use CONFIRMED instead. Will be removed after migration. */
    AUTO_APPROVED = 'AUTO_APPROVED',
}

/**
 * Maps V1 status values to their V2 equivalents.
 * Used during schema migration (V1→V2) and runtime normalization.
 */
export function migrateVerificationStatus(status: LogVerificationStatus): LogVerificationStatus {
    switch (status) {
        case LogVerificationStatus.PENDING: return LogVerificationStatus.DRAFT;
        case LogVerificationStatus.AUTO_APPROVED: return LogVerificationStatus.CONFIRMED;
        case LogVerificationStatus.APPROVED: return LogVerificationStatus.VERIFIED;
        case LogVerificationStatus.REJECTED: return LogVerificationStatus.DISPUTED;
        // V2 values pass through unchanged
        case LogVerificationStatus.DRAFT:
        case LogVerificationStatus.CONFIRMED:
        case LogVerificationStatus.VERIFIED:
        case LogVerificationStatus.DISPUTED:
        case LogVerificationStatus.CORRECTION_PENDING:
            return status;
        default:
            return LogVerificationStatus.DRAFT;
    }
}

/**
 * Check if a status is a V1 (deprecated) value that needs migration.
 */
export function isV1Status(status: LogVerificationStatus): boolean {
    return status === LogVerificationStatus.PENDING
        || status === LogVerificationStatus.APPROVED
        || status === LogVerificationStatus.REJECTED
        || status === LogVerificationStatus.AUTO_APPROVED;
}

export interface LogMeta {
    createdAtISO: string;
    createdByOperatorId?: string; // Link to FarmOperator
    deviceId?: string;
    appVersion?: string;
    schemaVersion?: number; // 1 = V1, 2 = V2 (DFES)
    provenance?: LogProvenance;
}

/**
 * VerificationRecord — DFES V2 replacement for LogVerification.
 * Tracks the full verification lifecycle with actor attribution and history.
 */
export interface VerificationRecord {
    status: LogVerificationStatus;
    required: boolean;
    confirmedByActorId?: string;
    confirmedAtISO?: string;
    verifiedByActorId?: string;
    verifiedAtISO?: string;
    disputedByActorId?: string;
    disputedAtISO?: string;
    disputeReason?: string;
    notes?: string;
    statusHistory?: VerificationTransition[];
}

/**
 * A single state transition in the verification lifecycle.
 */
export interface VerificationTransition {
    from: LogVerificationStatus;
    to: LogVerificationStatus;
    actorId: string;
    timestamp: string;
    reason?: string;
}

/**
 * @deprecated Use VerificationRecord instead. Kept for backward compatibility during migration.
 */
export interface LogVerification {
    status: LogVerificationStatus;
    required: boolean;
    verifiedByOperatorId?: string;
    verifiedAtISO?: string;
    notes?: string;
}

export interface LogDeletion {
    deletedAtISO: string;
    deletedByOperatorId: string;
    reason: string;
}

// =============================================================================
// TRANSCRIPT TIMELINE (For UI display)
// =============================================================================

export interface TranscriptSnapshot {
    raw: string;                      // Original user input
    cleaned?: string;                 // AI-processed version
    language?: 'mr' | 'hi' | 'en';    // Detected language
}

export interface LogTimelineEntry {
    id: string;
    logId: string;                    // Parent DailyLog ID

    // Temporal - EXACT time
    timestamp: string;                // ISO with time: "2026-02-03T07:45:00"
    displayTime: string;              // Formatted: "7:45 AM"

    // Context - crops/plots involved
    contexts: {
        cropId: string;
        cropName: string;
        cropIconName: string;         // Icon name for CropSymbol component
        cropColor?: string;           // Tailwind color class
        plotId?: string;
        plotName?: string;
    }[];

    // Transcript
    rawTranscript: string;            // Original voice/text input
    cleanedTranscript?: string;       // AI-cleaned version
    displayTranscript: string;        // What to show (prefer raw for connection)

    // Source
    source: 'VOICE' | 'MANUAL' | 'QUICK_ACTION';

    // What was logged (summary)
    loggedItems: {
        activities: number;
        observations: number;
        labour: number;
        irrigation: number;
        machinery: number;
        expenses: number;
    };
}

export interface DayTranscriptSummary {
    date: string;                     // YYYY-MM-DD
    totalLogs: number;
    entries: LogTimelineEntry[];

    // Aggregated crops involved today
    cropsInvolved: {
        cropId: string;
        cropName: string;
        cropIconName: string;
        cropColor?: string;
        logCount: number;
    }[];
}

// =============================================================================
// QUESTIONS FOR USER (AI clarification requests)
// =============================================================================

export interface QuestionForUser {
    id: string;
    type: 'LABOUR_SOURCE_CHECK' | 'CONTEXT_CHECK';
    target: 'LABOUR' | 'CONTEXT';
    text: string;
    options?: string[]; // For Context Check (e.g. ["Plot A", "Plot B"])
}

// =============================================================================
// DAILY LOG (The Aggregate Root)
// =============================================================================

/**
 * DailyLog - The immutable execution record for a single day.
 * This is the "truth" of what happened on the farm.
 */
export interface DailyLog {
    id: string;
    date: string;
    context: FarmContext;
    dayOutcome: DayOutcome;
    phaseAtLogTime?: CropPhase;
    dayNumberAtLogTime?: number | null;
    weatherSnapshot?: WeatherSnapshot; // @deprecated - use weatherStamp
    weatherStamp?: WeatherStamp;       // The Spine (Required for new logs)
    cropActivities: CropActivityEvent[];
    irrigation: IrrigationEvent[];
    labour: LabourEvent[];
    inputs: InputEvent[];
    machinery: MachineryEvent[];
    activityExpenses?: ActivityExpenseEvent[];
    observations?: ObservationNote[];  // Capture net for unstructured content
    plannedTasks?: PlannedTask[];      // Future intent items
    disturbance?: DisturbanceEvent;

    // History & Audit (Fix-12)
    deletion?: LogDeletion; // If present, treated as deleted
    patches?: PatchEvent[]; // History of major edits

    // Trust Layer
    meta?: LogMeta;
    verification?: LogVerification;

    fullTranscript?: string; // Raw verbatim text for training data
    transcriptSnapshot?: TranscriptSnapshot; // For timeline display
    manualTotalCost?: number;
    financialSummary: {
        totalLabourCost: number;
        totalInputCost: number;
        totalMachineryCost: number;
        totalActivityExpenses?: number;
        grandTotal: number;
    };
}

// =============================================================================
// AI RESPONSE TYPES
// =============================================================================

export type UnclearReason =
    | 'ambiguous_verb'           // Can't determine past vs future
    | 'unknown_vocabulary'       // Word not recognized
    | 'incomplete_sentence'      // Fragment
    | 'conflicting_markers'      // Past + Future mixed
    | 'no_actionable_content'    // Filler
    | 'audio_quality'            // Noise
    | 'mixed_languages'          // Code switching
    | 'unknown';                 // Fallback

export interface UnclearSegment {
    id: string;
    rawText: string;
    highlightRange?: number[]; // [start, end] indices in fullTranscript
    confidence: number;
    reason: UnclearReason;

    // Empathetic messaging
    userMessage: string;
    userMessageEn?: string;

    // Suggestions
    suggestedRephrase?: string;
}

export type ObservationNoteDraft = Partial<ObservationNote> & { textRaw: string };

export type UnclearSegmentDraft = Partial<UnclearSegment>;

export interface AgriLogResponse {
    summary: string;
    dayOutcome: DayOutcome;
    cropActivities: CropActivityEvent[];
    irrigation: IrrigationEvent[];
    labour: LabourEvent[];
    inputs: InputEvent[];
    machinery: MachineryEvent[];
    activityExpenses: ActivityExpenseEvent[];
    observations?: ObservationNoteDraft[];
    plannedTasks?: Array<{
        title: string;
        dueHint?: string | null;
        category: 'maintenance' | 'procurement' | 'coordination' | 'general';
        sourceText: string;
        systemInterpretation: string;
    }>;
    disturbance?: DisturbanceEvent;
    missingSegments: LogSegment[];
    confidence?: Record<string, number>;

    // Phase 7: Unclear Segment Handling
    unclearSegments?: UnclearSegmentDraft[];

    questionsForUser?: QuestionForUser[];
    fullTranscript?: string;

    // Transparency Support
    aiSourceSummary?: string;
    originalLogId?: string;

    // Global Voice Context Suggestion
    suggestedContext?: {
        cropId?: string;
        plotId?: string;
        reason?: string;
    };
}

// =============================================================================
// CONTEXT TYPES (Inline to avoid circular deps)
// =============================================================================

export interface SelectedCropContext {
    cropId: string;
    cropName: string;
    selectedPlotIds: string[];
    selectedPlotNames: string[];
}

export interface FarmContext {
    selection: SelectedCropContext[];
}
