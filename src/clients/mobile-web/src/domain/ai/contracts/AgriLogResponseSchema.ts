
import { z } from 'zod';
import {
    InputMethod,
    InputReason,
    ObservationNoteType,
    ObservationSeverity,
    ObservationSource,
    DayOutcome,
    DisturbanceScope,
    LogSegment,
    BucketIssueType,
    BucketIssueSeverity,
    LogVerificationStatus,
    UnclearReason
} from '../../types/log.types'; // Imports from domain types are allowed

// --- ENUMS & UNIONS ---

export const LogSegmentSchema = z.enum(['crop_activity', 'irrigation', 'labour', 'input', 'machinery']);

export const DayOutcomeSchema = z.enum([
    'WORK_RECORDED',
    'DISTURBANCE_RECORDED',
    'NO_WORK_PLANNED',
    'IRRELEVANT_INPUT'
]);

export const BucketIssueSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const BucketIssueTypeSchema = z.enum([
    'MACHINERY', 'ELECTRICITY', 'WEATHER', 'WATER_SOURCE',
    'PEST', 'DISEASE', 'LABOR_SHORTAGE', 'MATERIAL_SHORTAGE', 'OTHER'
]);

export const BucketIssueSchema = z.object({
    issueType: BucketIssueTypeSchema,
    reason: z.string(),
    note: z.string().optional(),
    severity: BucketIssueSeveritySchema,
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional()
});

// RAW SCHEMA: Nullable issues allowed
export const BucketIssueRawSchema = BucketIssueSchema.nullable().optional();

// --- EVENTS ---

// Raw Schemas allow optional IDs and nullable fields where AI might fail

export const CropActivityEventSchema = z.object({
    id: z.string(),
    title: z.string(),
    workTypes: z.array(z.string()).optional(),
    status: z.enum(['completed', 'partial', 'pending', 'gap_recorded']).optional(),
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
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional(),
    issue: BucketIssueSchema.optional()
});

export const CropActivityEventRawSchema = CropActivityEventSchema.extend({
    id: z.string().optional(),
    issue: BucketIssueRawSchema
});

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
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional(),
    issue: BucketIssueSchema.optional()
});

export const IrrigationEventRawSchema = IrrigationEventSchema.extend({
    id: z.string().optional(),
    issue: BucketIssueRawSchema
});

export const LabourEventSchema = z.object({
    id: z.string(),
    linkedActivityId: z.string().optional(),
    type: z.enum(['HIRED', 'CONTRACT', 'SELF']),
    shiftId: z.string().optional(),
    maleCount: z.number().nullable().optional(),
    femaleCount: z.number().nullable().optional(),
    count: z.number().nullable().optional(),
    wagePerPerson: z.number().nullable().optional(),
    contractUnit: z.enum(['Tree', 'Acre', 'Row', 'Lump Sum']).optional(),
    contractQuantity: z.number().nullable().optional(),
    operatorId: z.string().optional(),
    totalCost: z.number().nullable().optional(),
    notes: z.string().optional(),
    detectedCrop: z.string().optional(),
    whoWorked: z.enum(['OWNER', 'OPERATOR', 'HIRED_LABOUR', 'UNKNOWN']).optional(),
    activity: z.string().optional(),
    targetPlotName: z.string().optional(),
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional(),
    issue: BucketIssueSchema.optional()
});

export const LabourEventRawSchema = LabourEventSchema.extend({
    id: z.string().optional(),
    issue: BucketIssueRawSchema
});

export const InputMixItemSchema = z.object({
    id: z.string(),
    productName: z.string(),
    dose: z.number().nullable().optional(),
    unit: z.string(),
    linkedExpenseId: z.string().optional(),
    linkedExpenseItemId: z.string().optional(),
    costSource: z.enum(['MANUAL', 'PROCUREMENT']).optional()
});

export const InputMixItemRawSchema = InputMixItemSchema.extend({
    id: z.string().optional()
});

export const InputEventSchema = z.object({
    id: z.string(),
    linkedActivityId: z.string().optional(),
    linkedExpenseId: z.string().optional(),
    linkedExpenseItemId: z.string().optional(),
    costSource: z.enum(['MANUAL', 'PROCUREMENT']).optional(),
    method: z.enum(['Spray', 'Drip', 'Drenching', 'Soil']),
    carrierType: z.enum(['Blower', 'Tank', 'Hours', 'Pati', 'Bag', 'Liters']).optional(),
    carrierCount: z.number().nullable().optional(),
    carrierCapacity: z.number().nullable().optional(),
    computedWaterVolume: z.number().nullable().optional(),
    mix: z.array(InputMixItemSchema),
    reason: z.enum(['Preventive', 'Disease', 'Pest', 'Growth', 'Deficiency', 'Seller Advice', 'Other']).optional(),
    recommendedBy: z.string().optional(),
    cost: z.number().nullable().optional(),
    notes: z.string().optional(),
    detectedCrop: z.string().optional(),
    type: z.enum(['fertilizer', 'pesticide', 'fungicide', 'bio', 'other', 'unknown']).optional(),
    productName: z.string().optional(),
    quantity: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    targetPlotName: z.string().optional(),
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional(),
    issue: BucketIssueSchema.optional()
});


export const InputEventRawSchema = InputEventSchema.extend({
    id: z.string().optional(),
    mix: z.array(InputMixItemRawSchema).optional(),
    issue: BucketIssueRawSchema
});

export const MachineryEventSchema = z.object({
    id: z.string(),
    linkedActivityId: z.string().optional(),
    type: z.enum(['tractor', 'tiller', 'harvester', 'drone', 'sprayer', 'unknown']),
    ownership: z.enum(['owned', 'rented', 'unknown']),
    hoursUsed: z.number().nullable().optional(),
    rentalCost: z.number().nullable().optional(),
    fuelCost: z.number().nullable().optional(),
    targetPlotName: z.string().optional(),
    notes: z.string().optional(),
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional(),
    issue: BucketIssueSchema.optional()
});

export const MachineryEventRawSchema = MachineryEventSchema.extend({
    id: z.string().optional(),
    issue: BucketIssueRawSchema
});

export const ExpenseItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    qty: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    unitPrice: z.number().nullable().optional(),
    total: z.number().nullable().optional()
});

export const ActivityExpenseEventSchema = z.object({
    id: z.string(),
    reason: z.string(),
    category: z.string().optional(),
    vendor: z.string().optional(),
    vendorPhone: z.string().optional(),
    items: z.array(ExpenseItemSchema),
    totalAmount: z.number().nullable().optional(),
    linkedActivityId: z.string().optional(),
    observation: z.string().optional(),
    notes: z.string().optional(),
    timestamp: z.string().optional(),
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional()
});

export const ActivityExpenseEventRawSchema = ActivityExpenseEventSchema.extend({
    id: z.string().optional(),
    items: z.array(ExpenseItemSchema.extend({ id: z.string().optional() }))
});

// --- OBSERVATIONS & METADATA ---

export const ObservationNoteSchema = z.object({
    id: z.string(),
    plotId: z.string(),
    cropId: z.string().optional(),
    dateKey: z.string(),
    timestamp: z.string(),
    textRaw: z.string(),
    textCleaned: z.string().optional(),
    noteType: z.enum(['observation', 'issue', 'tip', 'reminder', 'unknown']),
    severity: z.enum(['normal', 'important', 'urgent']),
    tags: z.array(z.string()).optional(),
    source: z.enum(['voice', 'manual']),
    aiConfidence: z.number().optional(),
    status: z.enum(['open', 'resolved']).optional(),
    resolvedAt: z.string().optional(),
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional()
});

export const ObservationNoteDraftSchema = ObservationNoteSchema.extend({
    id: z.string().optional(),
    plotId: z.string().optional(),
    dateKey: z.string().optional(),
    timestamp: z.string().optional(),
    status: z.enum(['open', 'resolved']).optional(),
    source: z.enum(['voice', 'manual']).optional(),
    noteType: z.enum(['observation', 'issue', 'tip', 'reminder', 'unknown']).optional(),
    severity: z.enum(['normal', 'important', 'urgent']).optional()
});

export const PlannedTaskDraftSchema = z.object({
    title: z.string(),
    dueHint: z.string().nullable().optional(),
    category: z.enum(['maintenance', 'procurement', 'coordination', 'general']),
    sourceText: z.string(),
    systemInterpretation: z.string()
});

export const DisturbanceEventSchema = z.object({
    scope: z.enum(['FULL_DAY', 'PARTIAL', 'DELAYED']),
    group: z.string(),
    reason: z.string(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    blockedSegments: z.array(LogSegmentSchema),
    note: z.string().optional(),
    weatherEventId: z.string().optional(),
    sourceText: z.string().optional(),
    systemInterpretation: z.string().optional()
});

export const DisturbanceEventRawSchema = DisturbanceEventSchema.nullable().optional();

export const UnclearSegmentSchema = z.object({
    id: z.string(),
    rawText: z.string(),
    highlightRange: z.array(z.number()).optional(),
    confidence: z.number(),
    reason: z.enum([
        'ambiguous_verb', 'unknown_vocabulary', 'incomplete_sentence',
        'conflicting_markers', 'no_actionable_content', 'audio_quality',
        'mixed_languages', 'unknown'
    ]),
    userMessage: z.string(),
    userMessageEn: z.string().optional(),
    suggestedRephrase: z.string().optional()
});

export const UnclearSegmentRawSchema = UnclearSegmentSchema.extend({
    id: z.string().optional(),
    userMessage: z.string().optional(),
    rawText: z.string().optional(),
    confidence: z.number().optional(),
    reason: z.enum([
        'ambiguous_verb', 'unknown_vocabulary', 'incomplete_sentence',
        'conflicting_markers', 'no_actionable_content', 'audio_quality',
        'mixed_languages', 'unknown'
    ]).optional()
});

export const UnclearSegmentDraftSchema = UnclearSegmentSchema.extend({
    id: z.string().optional(),
    rawText: z.string().optional(),
    confidence: z.number().optional(),
    reason: z.enum([
        'ambiguous_verb', 'unknown_vocabulary', 'incomplete_sentence',
        'conflicting_markers', 'no_actionable_content', 'audio_quality',
        'mixed_languages', 'unknown'
    ]).optional(),
    userMessage: z.string().optional()
});

export const QuestionForUserSchema = z.object({
    id: z.string(),
    type: z.enum(['LABOUR_SOURCE_CHECK', 'CONTEXT_CHECK']),
    target: z.enum(['LABOUR', 'CONTEXT']),
    text: z.string(),
    options: z.array(z.string()).optional()
});

export const QuestionForUserRawSchema = QuestionForUserSchema.extend({
    id: z.string().optional()
});

// --- ROOT RESPONSE SCHEMA ---

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
    confidence: z.record(z.string(), z.number()).optional(), // Legacy, keep for backward compat

    // NEW: Per-field confidence for V2 Voice Safety (AV-4)
    // Maps field path (e.g. "cropActivities[0].title") to confidence object
    fieldConfidences: z.record(
        z.string(),
        z.object({
            level: z.enum(['HIGH', 'MEDIUM', 'LOW']),
            score: z.number(),
            reason: z.string().optional()
        })
    ).optional(),

    unclearSegments: z.array(UnclearSegmentDraftSchema).optional(),
    questionsForUser: z.array(QuestionForUserSchema).optional(),
    fullTranscript: z.string().optional(),
    aiSourceSummary: z.string().optional(),
    originalLogId: z.string().optional(),

    suggestedContext: z.object({
        cropId: z.string().optional(),
        plotId: z.string().optional(),
        reason: z.string().optional()
    }).optional()
});

// RAW RESPONSE SCHEMA
export const AgriLogRawResponseSchema = AgriLogResponseSchema.extend({
    cropActivities: z.array(CropActivityEventRawSchema).optional(),
    irrigation: z.array(IrrigationEventRawSchema).optional(),
    labour: z.array(LabourEventRawSchema).optional(),
    inputs: z.array(InputEventRawSchema).optional(),
    machinery: z.array(MachineryEventRawSchema).optional(),
    activityExpenses: z.array(ActivityExpenseEventRawSchema).optional(),
    disturbance: DisturbanceEventRawSchema,
    missingSegments: z.array(LogSegmentSchema).optional(),
    unclearSegments: z.array(UnclearSegmentRawSchema).optional(),
    questionsForUser: z.array(QuestionForUserRawSchema).optional()
});

export type AgriLogResponse = z.infer<typeof AgriLogResponseSchema>;
export type RawAgriLogResponse = z.infer<typeof AgriLogRawResponseSchema>;
