/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DATA_PRINCIPLE_SPINE Phase 02 sub-phase 02.6 — strict Zod runtime
 * contract for `AgriLogResponse` (the trust-ledger AI boundary).
 *
 * Spec: `_COFOUNDER/Projects/AgriSync/Operations/Plans/DATA_PRINCIPLE_SPINE_2026-05-05/02_[38of38]_STORAGE_TIERING_AND_SCHEMA.md` §02.6
 * Spec-id: `data-principle-spine-2026-05-05/02-patch-zod-schema`
 *
 * Why this exists
 * ---------------
 * Before this file the frontend accepted any AI parse response that
 * passed a shallow manual `typeof` check (BackendAiClient.ts line ~49
 * — `isAgriLogResponse`). Drift between the server prompt template
 * (`AiPromptTemplateRegistry.cs`) and the client TS shape silently
 * corrupted the trust ledger: hallucinated fields slipped through,
 * unknown `categoryId` values fell back to "other" without telemetry,
 * and date-shaped strings could arrive in any format.
 *
 * The Zod schema below is the wire-boundary wall. Anything that fails
 * `safeParse` is thrown by BackendAiClient — never silently coerced.
 *
 * Design rules (matches plan §02.6 + Phase 02 MAJOR #3 envelope)
 * --------------------------------------------------------------
 * 1. Top-level `AgriLogResponseSchema` is `.strict()`. Unknown top-
 *    level keys are rejected. This is the load-bearing wall: drift in
 *    the response envelope (a new top-level field the server forgot
 *    to coordinate) MUST fail loudly.
 * 2. Nested event schemas use `.passthrough()`. Every event type
 *    declares 15–30 optional fields and grows with each prompt
 *    revision; strict nested mode would break every minor prompt
 *    bump. We validate the known fields strictly (type + enum +
 *    regex) and tolerate extras until they become load-bearing.
 * 3. `categoryId` uses the canonical 13-code enum locked by the
 *    R0 verdict (decisions-log 2026-05-15 / DATA_PRINCIPLE_SPINE
 *    02.5 / 02.6). Unknown codes fall back to the unparseable
 *    bucket via the prompt; if the server emits one anyway, this
 *    schema rejects it at the wire.
 * 4. Date fields use `z.string().regex(...)`. The `dueDate` /
 *    `dateKey` family is `YYYY-MM-DD` (10 chars); ISO timestamps
 *    use a permissive `T` + offset regex (the existing TS shape
 *    accepts both `"2026-02-03T07:45:00"` and full RFC 3339).
 * 5. The exported type is `AgriLogResponseValidated` — NOT
 *    `AgriLogResponse` — to avoid collision with the existing
 *    `AgriLogResponse` export from `domain/types/log.types.ts`
 *    which the rest of the codebase consumes structurally.
 *
 * Layer: Domain. No infrastructure / UI imports allowed.
 */

import { z } from 'zod';

import { COST_CATEGORY_IDS } from '../../finance/CostCategory';

// =============================================================================
// PRIMITIVES (regex + enum building blocks)
// =============================================================================

/** `YYYY-MM-DD` date-key per ObservationNote.dateKey / PlannedTask.dueDate. */
const DateKeyString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Expected YYYY-MM-DD',
});

/**
 * Loose ISO-8601 timestamp accepting both `2026-02-03T07:45:00`
 * (no offset — local time, used by TranscriptSnapshot.timestamp) and
 * full RFC 3339 with offset (`...Z` or `±hh:mm`). The existing TS
 * `timestamp` fields on ObservationNote / PlannedTask accept both
 * shapes today, so a stricter regex would reject valid legacy data.
 */
const IsoTimestampString = z.string().regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?$/,
    { message: 'Expected ISO-8601 timestamp' },
);

// =============================================================================
// ENUMS (mirror log.types.ts unions)
// =============================================================================

const DayOutcomeSchema = z.enum([
    'WORK_RECORDED',
    'DISTURBANCE_RECORDED',
    'NO_WORK_PLANNED',
    'IRRELEVANT_INPUT',
]);

const LogSegmentSchema = z.enum([
    'crop_activity',
    'irrigation',
    'labour',
    'input',
    'machinery',
]);

const DisturbanceScopeSchema = z.enum(['FULL_DAY', 'PARTIAL', 'DELAYED']);

const DisturbanceSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

const BucketIssueTypeSchema = z.enum([
    'MACHINERY',
    'ELECTRICITY',
    'WEATHER',
    'WATER_SOURCE',
    'PEST',
    'DISEASE',
    'LABOR_SHORTAGE',
    'MATERIAL_SHORTAGE',
    'OTHER',
]);

const BucketIssueSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

const CropActivityStatusSchema = z.enum([
    'completed',
    'partial',
    'pending',
    'gap_recorded',
]);

const InputMethodSchema = z.enum(['Spray', 'Drip', 'Drenching', 'Soil']);

const InputReasonSchema = z.enum([
    'Preventive',
    'Disease',
    'Pest',
    'Growth',
    'Deficiency',
    'Seller Advice',
    'Other',
]);

const InputLegacyTypeSchema = z.enum([
    'fertilizer',
    'pesticide',
    'fungicide',
    'bio',
    'other',
    'unknown',
]);

const InputCarrierTypeSchema = z.enum([
    'Blower',
    'Tank',
    'Hours',
    'Pati',
    'Bag',
    'Liters',
]);

const InputCostSourceSchema = z.enum(['MANUAL', 'PROCUREMENT']);

const LabourTypeSchema = z.enum(['HIRED', 'CONTRACT', 'SELF']);

const LabourContractUnitSchema = z.enum(['Tree', 'Acre', 'Row', 'Lump Sum']);

const LabourWhoWorkedSchema = z.enum([
    'OWNER',
    'OPERATOR',
    'HIRED_LABOUR',
    'UNKNOWN',
]);

const MachineryTypeSchema = z.enum([
    'tractor',
    'tiller',
    'harvester',
    'drone',
    'sprayer',
    'unknown',
]);

const MachineryOwnershipSchema = z.enum(['owned', 'rented', 'unknown']);

const ObservationNoteTypeSchema = z.enum([
    'observation',
    'issue',
    'tip',
    'reminder',
    'unknown',
]);

const ObservationSeveritySchema = z.enum(['normal', 'important', 'urgent']);

const ObservationSourceSchema = z.enum(['voice', 'manual']);

const ObservationStatusSchema = z.enum(['open', 'resolved']);

const _PlannedTaskPrioritySchema = z.enum(['normal', 'high', 'urgent']);

const _PlannedTaskStatusSchema = z.enum([
    'suggested',
    'pending',
    'in_progress',
    'done',
    'cancelled',
]);

const _PlannedTaskSourceSchema = z.enum([
    'ai_extracted',
    'observation_derived',
    'manual',
    'schedule',
]);

/**
 * W1.P2 — per-field provenance. Mirrors `FieldProvenance` in log.types.ts.
 * Added to nested event schemas (all .passthrough()) so the wire contract
 * accepts and forwards the value without top-level drift risk.
 */
const FieldProvenanceSchema = z.enum([
    'spoken',
    'confirmed',
    'derived',
    'assumed',
]);

const QuestionForUserTypeSchema = z.enum([
    'LABOUR_SOURCE_CHECK',
    'CONTEXT_CHECK',
]);

const QuestionForUserTargetSchema = z.enum(['LABOUR', 'CONTEXT']);

const UnclearReasonSchema = z.enum([
    'ambiguous_verb',
    'unknown_vocabulary',
    'incomplete_sentence',
    'conflicting_markers',
    'no_actionable_content',
    'audio_quality',
    'mixed_languages',
    'unknown',
]);

const _TranscriptLanguageSchema = z.enum(['mr', 'hi', 'en']);

const HarvestUnitTypeSchema = z.enum(['WEIGHT', 'COUNT', 'CONTAINER']);

const HarvestWeightUnitSchema = z.enum(['KG', 'QUINTAL', 'TON']);

const PlannedTaskCategorySchema = z.enum([
    'maintenance',
    'procurement',
    'coordination',
    'general',
]);

/**
 * Canonical cost-category enum (13 codes locked 2026-05-15 R0 verdict).
 * Source of truth: `domain/finance/CostCategory.ts#COST_CATEGORY_IDS`.
 * Re-derived here as a Zod enum so the schema fails loudly if the
 * canonical list drifts away from the runtime constant.
 */
const CostCategoryIdSchema = z.enum(
    COST_CATEGORY_IDS as unknown as readonly [string, ...string[]],
);

// =============================================================================
// SHARED FRAGMENTS
// =============================================================================

const TransparencyFields = {
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional(),
} as const;

const BucketIssueSchema = z.object({
    issueType: BucketIssueTypeSchema,
    reason: z.string(),
    note: z.string().optional(),
    severity: BucketIssueSeveritySchema,
    ...TransparencyFields,
}).passthrough();

const HarvestUnitSchema = z.object({
    type: HarvestUnitTypeSchema,
    weightUnit: HarvestWeightUnitSchema.optional(),
    containerName: z.string().optional(),
    containerSizeKg: z.number().optional(),
    countUnit: z.string().optional(),
}).passthrough();

const _DueWindowSchema = z.object({
    start: z.string(),
    end: z.string(),
}).passthrough();

// =============================================================================
// EVENT SCHEMAS
// =============================================================================

export const CropActivityEventSchema = z.object({
    id: z.string(),
    title: z.string(),
    workTypes: z.array(z.string()).optional(),
    status: CropActivityStatusSchema.optional(),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    notes: z.string().optional(),
    areaCovered: z.number().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    detectedCrop: z.string().optional(),
    isCommonActivity: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    targetPlotName: z.string().optional(),

    // Harvest linkage
    isHarvestActivity: z.boolean().optional(),
    linkedHarvestSessionId: z.string().optional(),
    harvestQuantity: z.number().optional(),
    harvestUnit: HarvestUnitSchema.optional(),
    gradeEstimates: z.array(z.object({
        gradeId: z.string(),
        estimatedPercentage: z.number(),
    }).passthrough()).optional(),

    issue: BucketIssueSchema.optional(),
    // W1.P2 — per-field provenance (nested schema; .passthrough() keeps this additive)
    provenance: FieldProvenanceSchema.optional(),
    ...TransparencyFields,
}).passthrough();

export const IrrigationEventSchema = z.object({
    id: z.string(),
    linkedActivityId: z.string().optional(),
    method: z.string(),
    source: z.string(),
    durationHours: z.number().optional(),
    waterVolumeLitres: z.number().optional(),
    notes: z.string().optional(),
    detectedCrop: z.string().optional(),
    motorId: z.string().optional(),
    targetPlotName: z.string().optional(),
    issue: BucketIssueSchema.optional(),
    // W1.P2 — per-field provenance
    provenance: FieldProvenanceSchema.optional(),
    ...TransparencyFields,
}).passthrough();

export const LabourEventSchema = z.object({
    id: z.string(),
    linkedActivityId: z.string().optional(),
    type: LabourTypeSchema,
    shiftId: z.string().optional(),
    maleCount: z.number().optional(),
    femaleCount: z.number().optional(),
    count: z.number().optional(),
    wagePerPerson: z.number().optional(),
    contractUnit: LabourContractUnitSchema.optional(),
    contractQuantity: z.number().optional(),
    operatorId: z.string().optional(),
    totalCost: z.number().optional(),
    notes: z.string().optional(),
    detectedCrop: z.string().optional(),
    whoWorked: LabourWhoWorkedSchema.optional(),
    activity: z.string().optional(),
    targetPlotName: z.string().optional(),
    issue: BucketIssueSchema.optional(),
    // W1.P2 — per-field provenance
    provenance: FieldProvenanceSchema.optional(),
    ...TransparencyFields,
}).passthrough();

export const InputMixItemSchema = z.object({
    id: z.string(),
    productName: z.string(),
    dose: z.number().optional(),
    unit: z.string(),
    linkedExpenseId: z.string().optional(),
    linkedExpenseItemId: z.string().optional(),
    costSource: InputCostSourceSchema.optional(),
    // W1.P2 — per-field provenance
    provenance: FieldProvenanceSchema.optional(),
}).passthrough();

export const InputEventSchema = z.object({
    id: z.string(),
    linkedActivityId: z.string().optional(),
    linkedExpenseId: z.string().optional(),
    linkedExpenseItemId: z.string().optional(),
    costSource: InputCostSourceSchema.optional(),
    method: InputMethodSchema,
    carrierType: InputCarrierTypeSchema.optional(),
    carrierCount: z.number().optional(),
    carrierCapacity: z.number().optional(),
    computedWaterVolume: z.number().optional(),
    mix: z.array(InputMixItemSchema),
    reason: InputReasonSchema.optional(),
    recommendedBy: z.string().optional(),
    cost: z.number().optional(),
    notes: z.string().optional(),
    detectedCrop: z.string().optional(),

    // Legacy back-compat fields
    type: InputLegacyTypeSchema.optional(),
    productName: z.string().optional(),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    targetPlotName: z.string().optional(),

    issue: BucketIssueSchema.optional(),
    // W1.P2 — per-field provenance
    provenance: FieldProvenanceSchema.optional(),
    ...TransparencyFields,
}).passthrough();

export const MachineryEventSchema = z.object({
    id: z.string(),
    linkedActivityId: z.string().optional(),
    type: MachineryTypeSchema,
    ownership: MachineryOwnershipSchema,
    hoursUsed: z.number().optional(),
    rentalCost: z.number().optional(),
    fuelCost: z.number().optional(),
    targetPlotName: z.string().optional(),
    notes: z.string().optional(),
    issue: BucketIssueSchema.optional(),
    // W1.P2 — per-field provenance
    provenance: FieldProvenanceSchema.optional(),
    ...TransparencyFields,
}).passthrough();

export const ExpenseItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    qty: z.number().optional(),
    unit: z.string().optional(),
    unitPrice: z.number().optional(),
    total: z.number().optional(),
}).passthrough();

export const ActivityExpenseEventSchema = z.object({
    id: z.string(),
    reason: z.string(),
    /**
     * Legacy free-text category. Kept for back-compat with logs parsed
     * by prompt versions earlier than v3.1. New parses should also
     * populate `categoryId` (the canonical 13-code enum). The wire
     * push contract (`AddCostEntryPayload.categoryId`) is enum-only;
     * the AI response surface tolerates the historical free-text
     * field until the v3.1 prompt fully rolls out.
     */
    category: z.string().optional(),
    /**
     * Canonical 13-code category id emitted by AgriLogParser v3.1+
     * (prompt-registry row 2026-05-15). Unknown codes are rejected
     * by this enum and the activity-expense falls back to manual
     * triage rather than corrupting cost analytics.
     */
    categoryId: CostCategoryIdSchema.optional(),
    vendor: z.string().optional(),
    vendorPhone: z.string().optional(),
    items: z.array(ExpenseItemSchema),
    totalAmount: z.number().optional(),
    linkedActivityId: z.string().optional(),
    observation: z.string().optional(),
    notes: z.string().optional(),
    timestamp: z.string().optional(),
    // W1.P2 — per-field provenance
    provenance: FieldProvenanceSchema.optional(),
    ...TransparencyFields,
}).passthrough();

// `ObservationNoteDraft = Partial<ObservationNote> & { textRaw: string }`
// so the AI parser is allowed to ship sparse observations as long as
// `textRaw` survives. We validate the partial-with-required-textRaw
// shape exactly.
export const ObservationNoteDraftSchema = z.object({
    id: z.string().optional(),
    plotId: z.string().optional(),
    cropId: z.string().optional(),
    dateKey: DateKeyString.optional(),
    timestamp: IsoTimestampString.optional(),

    textRaw: z.string(),
    textCleaned: z.string().optional(),

    noteType: ObservationNoteTypeSchema.optional(),
    severity: ObservationSeveritySchema.optional(),
    tags: z.array(z.string()).optional(),

    source: ObservationSourceSchema.optional(),
    aiConfidence: z.number().optional(),

    status: ObservationStatusSchema.optional(),
    resolvedAt: z.string().optional(),

    ...TransparencyFields,
}).passthrough();

// `AgriLogResponse.plannedTasks` is a narrower draft shape than the
// full `PlannedTask`. Mirror that draft contract here verbatim (the
// fields the AI is responsible for emitting); the persistence layer
// fills the rest (id, plotId, lifecycle status, createdAt, etc.).
export const PlannedTaskDraftSchema = z.object({
    title: z.string(),
    dueHint: z.string().nullable().optional(),
    category: PlannedTaskCategorySchema,
    sourceText: z.string(),
    systemInterpretation: z.string(),
}).passthrough();

export const DisturbanceEventSchema = z.object({
    scope: DisturbanceScopeSchema,
    group: z.string(),
    reason: z.string(),
    severity: DisturbanceSeveritySchema.optional(),
    blockedSegments: z.array(LogSegmentSchema),
    note: z.string().optional(),
    weatherEventId: z.string().optional(),
    ...TransparencyFields,
}).passthrough();

// `UnclearSegmentDraft = Partial<UnclearSegment>` — all fields optional.
export const UnclearSegmentDraftSchema = z.object({
    id: z.string().optional(),
    rawText: z.string().optional(),
    highlightRange: z.array(z.number()).optional(),
    confidence: z.number().optional(),
    reason: UnclearReasonSchema.optional(),
    userMessage: z.string().optional(),
    userMessageEn: z.string().optional(),
    suggestedRephrase: z.string().optional(),
}).passthrough();

export const QuestionForUserSchema = z.object({
    id: z.string(),
    type: QuestionForUserTypeSchema,
    target: QuestionForUserTargetSchema,
    text: z.string(),
    options: z.array(z.string()).optional(),
}).passthrough();

export const SuggestedContextSchema = z.object({
    cropId: z.string().optional(),
    plotId: z.string().optional(),
    reason: z.string().optional(),
}).passthrough();

// =============================================================================
// TOP-LEVEL AGRILOG RESPONSE
// =============================================================================

/**
 * Strict top-level schema. Unknown top-level keys cause `safeParse` to
 * fail — this is the boundary wall.
 *
 * Field shape matches `AgriLogResponse` in
 * `src/clients/mobile-web/src/domain/types/log.types.ts` lines 687–724.
 *
 * IMPORTANT: keep this in lockstep with that TS interface. A new
 * top-level field on `AgriLogResponse` MUST land in both places in
 * the same commit, or this schema will reject every parse response
 * the moment the server starts emitting the new field.
 */
export const AgriLogResponseSchema = z.object({
    summary: z.string(),
    dayOutcome: DayOutcomeSchema,
    cropActivities: z.array(CropActivityEventSchema),
    irrigation: z.array(IrrigationEventSchema),
    labour: z.array(LabourEventSchema),
    inputs: z.array(InputEventSchema),
    machinery: z.array(MachineryEventSchema),
    activityExpenses: z.array(ActivityExpenseEventSchema),
    observations: z.array(ObservationNoteDraftSchema).optional(),
    plannedTasks: z.array(PlannedTaskDraftSchema).optional(),
    disturbance: DisturbanceEventSchema.optional(),
    missingSegments: z.array(LogSegmentSchema),
    confidence: z.record(z.string(), z.number()).optional(),
    unclearSegments: z.array(UnclearSegmentDraftSchema).optional(),
    questionsForUser: z.array(QuestionForUserSchema).optional(),
    fullTranscript: z.string().optional(),
    aiSourceSummary: z.string().optional(),
    originalLogId: z.string().optional(),
    suggestedContext: SuggestedContextSchema.optional(),

    // -------------------------------------------------------------------------
    // VOICE-SPINE FIELDS (Sarvam pipeline, Phase 1.12 / 2026-05-21)
    // -------------------------------------------------------------------------
    // Five top-level siblings of the AgriLog bucket structure. All optional
    // so prompt-v3.x responses (which never emit these) continue to parse.
    // Wire-contract names are snake_case to match the AiJob column names
    // landed in Phase 1.1 (`transcript_english`, `transcript_english_redacted`,
    // `referenced_date`, `referenced_date_confidence`, `referenced_date_reason`)
    // minus the `transcript_` prefix that lives on the DB column only.
    //
    // - `english` / `english_redacted`: natural-English transcript with and
    //   without PII redaction. Redaction uses [FARMER_N] / [PHONE_N] /
    //   [PLOT_N] / [WORKER_N] / [VENDOR_N] tokens keyed by occurrence-order
    //   within the clip. Numbers, dates, and currency stay literal.
    // - `referenced_date`: ISO-8601 `YYYY-MM-DD` date the farmer is talking
    //   ABOUT (may differ from `captured_at`, which is when the recording
    //   happened). Resolved from temporal cues like "काल" / "yesterday" /
    //   "last Monday". Omitted entirely when no cue is present — do NOT
    //   default to `captured_at`.
    // - `referenced_date_confidence`: 0.0–1.0 confidence in that resolution.
    // - `referenced_date_reason`: short audit string explaining the
    //   derivation, e.g. "User said 'काल' on 2026-05-22 → 2026-05-21".
    //
    // These additions intentionally do NOT replace `fullTranscript` — both
    // co-exist during the Sarvam pipeline rollout. Phase 2 cuts new code
    // over to `english` / `english_redacted`; legacy paths keep reading
    // `fullTranscript` until that cutover lands.
    english: z.string().optional(),
    english_redacted: z.string().optional(),
    referenced_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
        message: 'Expected YYYY-MM-DD',
    }).optional(),
    referenced_date_confidence: z.number().min(0).max(1).optional(),
    referenced_date_reason: z.string().optional(),
}).strict();

/**
 * Type alias for the validated payload.
 *
 * NOT named `AgriLogResponse` — that identifier is already exported
 * from `domain/types/log.types.ts` and consumed by `BackendAiClient`,
 * `VoiceParserPort`, `GeminiClient`, and dozens of downstream
 * features. Re-exporting a Zod-inferred alias under the same name
 * would create an import collision and (worse) drift between the two
 * shapes once Zod's inference fills in default values or coerces
 * nullables.
 *
 * Consumers that want compile-time confidence that their value passed
 * through `safeParse` can type as `AgriLogResponseValidated` to
 * communicate that intent in the code.
 */
export type AgriLogResponseValidated = z.infer<typeof AgriLogResponseSchema>;
