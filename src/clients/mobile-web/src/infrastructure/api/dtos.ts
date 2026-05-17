// Sub-plan 04 Task 9: AgriSyncClient decomposition.
// All API DTOs live here. The slim AgriSyncClient.ts re-exports every
// named type so existing imports
// (`from '../../infrastructure/api/AgriSyncClient'`) continue to compile
// without any changes at call sites.

import type { VisibleBucketId } from '../../domain/ai/BucketId';
import type { CostCategoryId, CostCategoryRef } from '../../domain/finance/CostCategory';

export type VerificationStatus =
    | 'draft'
    | 'confirmed'
    | 'verified'
    | 'disputed'
    | 'correction_pending';

export interface LoginRequest {
    phone: string;
    password: string;
}

export interface AuthResponseDto {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAtUtc: string;
}

export interface SyncPushMutation {
    clientRequestId: string;
    clientCommandId?: string;
    mutationType: string;
    payload: unknown;
}

export interface SyncPushRequest {
    deviceId: string;
    mutations: SyncPushMutation[];
}

export interface SyncPushResult {
    clientRequestId: string;
    mutationType: string;
    status: 'applied' | 'duplicate' | 'failed';
    data?: unknown;
    errorCode?: string;
    errorMessage?: string;
}

export interface SyncPushResponse {
    serverTimeUtc: string;
    results: SyncPushResult[];
}

export interface FarmDto {
    id: string;
    name: string;
    ownerUserId: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface PlotDto {
    id: string;
    farmId: string;
    name: string;
    areaInAcres: number;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface CropCycleDto {
    id: string;
    farmId: string;
    plotId: string;
    cropName: string;
    stage: string;
    startDate: string;
    endDate?: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface LocationDto {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    altitude?: number;
    capturedAtUtc: string;
    provider: string;
    permissionState: string;
}

export interface LogTaskDto {
    id: string;
    activityType: string;
    notes?: string;
    occurredAtUtc: string;
    executionStatus?: string;
    deviationReasonCode?: string | null;
    deviationNote?: string | null;
}

export interface VerificationEventDto {
    id: string;
    logId: string;
    status: string;
    verifiedByUserId: string;
    reason?: string;
    occurredAtUtc: string;
}

export interface DailyLogDto {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId: string;
    operatorUserId: string;
    logDate: string;
    idempotencyKey?: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
    location?: LocationDto;
    lastVerificationStatus?: string;
    tasks: LogTaskDto[];
    verificationEvents: VerificationEventDto[];
}

export interface CostEntryDto {
    id: string;
    farmId: string;
    plotId?: string;
    cropCycleId?: string;
    // DATA_PRINCIPLE_SPINE 02.5 — wire-shape rename: free-text `category`
    // becomes a FK to ssf.cost_categories. Backend commit e2d5bcf renamed
    // the DTO field; mobile-web follows in the same bundle.
    categoryId: CostCategoryId;
    description: string;
    amount: number;
    currencyCode: string;
    entryDate: string;
    createdByUserId: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
    location?: LocationDto;
    isCorrected: boolean;
}

export interface FinanceCorrectionDto {
    id: string;
    costEntryId: string;
    originalAmount: number;
    correctedAmount: number;
    currencyCode: string;
    reason: string;
    correctedByUserId: string;
    correctedAtUtc: string;
    modifiedAtUtc: string;
}

export interface DayLedgerAllocationDto {
    id: string;
    plotId: string;
    allocatedAmount: number;
    currencyCode: string;
    allocatedAtUtc: string;
}

export interface DayLedgerDto {
    id: string;
    farmId: string;
    sourceCostEntryId: string;
    ledgerDate: string;
    allocationBasis: string;
    createdByUserId: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
    allocations: DayLedgerAllocationDto[];
}

export interface PlannedTask {
    id: string;
    cropCycleId: string;
    plannedDate: string;
    taskType: string;
    description: string;
    status: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface SyncOperatorDto {
    userId: string;
    displayName: string;
    role: string;
}

export interface AttachmentDto {
    id: string;
    farmId: string;
    linkedEntityId: string;
    linkedEntityType: string;
    fileName: string;
    mimeType: string;
    status: string;
    localPath?: string | null;
    sizeBytes?: number | null;
    createdByUserId: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
    uploadedAtUtc?: string | null;
    finalizedAtUtc?: string | null;
}

export interface CreateAttachmentRequest {
    farmId: string;
    linkedEntityId: string;
    linkedEntityType: string;
    fileName: string;
    mimeType: string;
    attachmentId?: string;
}

export interface CreateAttachmentResponse {
    attachment: AttachmentDto;
    uploadUrl: string;
}

export interface AttentionCardDto {
    cardId: string;
    farmId: string;
    farmName: string;
    plotId: string;
    plotName: string;
    cropCycleId?: string | null;
    stageName?: string | null;
    rank: string;
    computedAtUtc: string;
    titleEn: string;
    titleMr: string;
    descriptionEn: string;
    descriptionMr: string;
    suggestedAction: string;
    suggestedActionLabelEn: string;
    suggestedActionLabelMr: string;
    overdueTaskCount?: number | null;
    latestHealthScore?: string | null;
    unresolvedDisputeCount?: number | null;
}

export interface AttentionBoardDto {
    cards: AttentionCardDto[];
}

export interface SyncPullResponse {
    serverTimeUtc: string;
    nextCursorUtc: string;
    farms: FarmDto[];
    plots: PlotDto[];
    cropCycles: CropCycleDto[];
    dailyLogs: DailyLogDto[];
    attachments: AttachmentDto[];
    costEntries: CostEntryDto[];
    financeCorrections: FinanceCorrectionDto[];
    dayLedgers: DayLedgerDto[];
    priceConfigs: unknown[];
    plannedActivities: unknown[];
    auditEvents: unknown[];
    operators?: SyncOperatorDto[];
    scheduleTemplates?: unknown[];
    scheduleSubscriptions?: ScheduleSubscriptionDto[];
    cropTypes?: unknown[];
    activityCategories?: string[];
    // DATA_PRINCIPLE_SPINE 02.5 — server now emits the full
    // CostCategoryRefDto rows (id + mr/hi/en labels) rather than a flat
    // string array, so the client can render Marathi-first labels
    // straight from the reference-data table without a fallback map.
    costCategories?: CostCategoryRef[];
    referenceDataVersionHash?: string;
    attentionBoard?: AttentionBoardDto | null;
}

export interface AiParseResponse {
    success?: boolean;
    parsedLog: Record<string, unknown>;
    confidence: number;
    fieldConfidences?: Record<string, { score: number; level: string; reason?: string; bucketId?: VisibleBucketId }>;
    suggestedAction?: string;
    modelUsed?: string;
    promptVersion?: string;
    providerUsed?: string;
    fallbackUsed?: boolean;
    latencyMs?: number;
    validationOutcome?: string;
    jobId?: string;
    // DATA_PRINCIPLE_SPINE sub-phase 01.5 — provenance fields surfaced in the
    // voice-parse response envelope. Mirror the backend Provenance VO.
    sourceAiJobId?: string;
    promptContentHash?: string;
    appVersion?: string;
    rawInputRef?: string | null;
}

// spec: data-principle-spine-2026-05-05/05.1
//
// Request and response shapes for POST /shramsafal/ai/cove-reverify. The
// backend gates the call behind the same PaidFeature.AiParse entitlement
// /ai/voice-parse uses, so failures arrive as the standard {error, message}
// shape with code "entitlement.*" or "ShramSafal.*" — the AgriSyncClient
// 401-refresh interceptor already handles those.
export interface CoVeReverifyRequest {
    farmId: string;
    transcript: string;
    // The structured parse we want verified. Posted as an object so the
    // client doesn't have to JSON.stringify; backend keeps the raw text
    // via JsonElement.GetRawText() and forwards to the handler verbatim.
    parsed: Record<string, unknown>;
    // Optional — when present, the backend stamps it on the AuditEvent's
    // SourceAiJobId so the verification row joins back to the source parse.
    sourceAiJobId?: string;
}

export interface CoVeReverifyResponse {
    verificationScore: number; // 0..1
    lowConfidence: boolean;
    demotionReason?: string | null;
}

export interface AiJobStatusResponse {
    id: string;
    status: string;
    operationType: string;
    createdAtUtc: string;
    completedAtUtc?: string;
    inputSpeechDurationMs?: number;
    inputRawDurationMs?: number;
    inputSessionMetadata?: unknown;
    attempts: Array<{
        attemptNumber: number;
        provider: string;
        isSuccess: boolean;
        failureClass: string;
        errorMessage?: string;
        latencyMs: number;
        confidenceScore?: number;
        estimatedCostUnits?: number;
        requestPayloadHash?: string;
        rawProviderResponse?: string;
        attemptedAtUtc: string;
    }>;
    result?: unknown;
}

export interface AiHealthResponse {
    module: string;
    statuses: Array<{
        provider: string;
        isHealthy: boolean;
    }>;
}

export interface AiProviderConfigResponse {
    id: string;
    defaultProvider: string;
    fallbackEnabled: boolean;
    isAiProcessingDisabled: boolean;
    maxRetries: number;
    circuitBreakerThreshold: number;
    circuitBreakerResetSeconds: number;
    voiceConfidenceThreshold: number;
    receiptConfidenceThreshold: number;
    voiceProvider?: string;
    receiptProvider?: string;
    pattiProvider?: string;
    resolvedVoiceProvider?: string;
    resolvedReceiptProvider?: string;
    resolvedPattiProvider?: string;
    geminiModelId?: string;
    modifiedAtUtc: string;
    modifiedByUserId: string;
}

export interface AiDashboardResponse {
    config: AiProviderConfigResponse;
    sinceUtc: string;
    providerStats?: Record<string, { successCount: number; failureCount: number }>;
    successes: Record<string, number>;
    failures: Record<string, number>;
    recentJobs: Array<{
        id: string;
        operationType: string;
        status: string;
        createdAtUtc: string;
        completedAtUtc?: string;
        providers: string[];
    }>;
}

// --- Admin Ops Health ---
export interface OpsErrorEventDto {
    eventType: string;
    endpoint: string;
    statusCode?: number;
    latencyMs?: number;
    farmId?: string;
    occurredAtUtc: string;
}

export interface OpsFarmErrorDto {
    farmId: string;
    errorCount: number;
    syncErrors: number;
    logErrors: number;
    voiceErrors: number;
    lastErrorAt: string;
}

export interface AdminOpsHealthDto {
    voiceInvocations24h: number;
    voiceFailures24h: number;
    voiceFailureRatePct: number;
    voiceAvgLatencyMs: number;
    voiceP95LatencyMs: number;
    recentErrors: OpsErrorEventDto[];
    topSufferingFarms: OpsFarmErrorDto[];
    /** null = alert views not yet created (Ops Phase 2 not deployed) */
    apiErrorSpike: boolean | null;
    voiceDegraded: boolean | null;
    computedAtUtc: string;
}

// --- Schedule Surface Definitions ---
export interface CropScheduleTemplateDto {
    id: string;
    templateKey: string;
    cropKey: string;
    name: string;
    versionTag: string;
    isPublished: boolean;
    tasks: Array<{
        id: string;
        taskType: string;
        stage: string;
        dayOffsetFromCycleStart: number;
        toleranceDaysPlusMinus: number;
    }>;
}

export interface ScheduleSubscriptionDto {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId: string;
    cropKey: string;
    scheduleTemplateId: string;
    scheduleVersionTag: string;
    adoptedAtUtc: string;
    state: 'Active' | 'Migrated' | 'Abandoned' | 'Completed';
    migratedFromSubscriptionId?: string;
    migrationReason?: string;
    stateChangedAtUtc?: string;
}

export interface AdoptScheduleRequest {
    farmId: string;
    scheduleTemplateId: string;
    subscriptionId?: string;
    clientCommandId?: string;
}

export interface MigrateScheduleRequest {
    farmId: string;
    newScheduleTemplateId: string;
    reason: string;
    reasonText?: string;
}

export interface AbandonScheduleRequest {
    farmId: string;
    reasonText?: string;
}

// --- Document Extraction Session ---

export interface ExtractionSessionDraftResponse {
    normalizedJson: unknown;
    overallConfidence: number;
    jobId?: string;
    providerUsed?: string;
    fallbackUsed?: boolean;
    warnings?: string[];
}

/** Response from POST /ai/document-sessions/receipt|patti */
export interface CreateExtractionSessionResponse {
    success: boolean;
    sessionId: string;
    status: string;
    draft: ExtractionSessionDraftResponse;
}

/** Response from GET /ai/document-sessions/{sessionId} */
export interface GetExtractionSessionResponse {
    sessionId: string;
    documentType: string;
    status: string;
    draftResult: unknown | null;
    draftConfidence: number;
    draftProvider: string | null;
    draftJobId: string | null;
    verifiedResult: unknown | null;
    verifiedConfidence: number | null;
    verificationProvider: string | null;
    verificationJobId: string | null;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface UpdateAiProviderConfigRequest {
    defaultProvider?: 'Sarvam' | 'Gemini';
    fallbackEnabled?: boolean;
    isAiProcessingDisabled?: boolean;
    maxRetries?: number;
    circuitBreakerThreshold?: number;
    circuitBreakerResetSeconds?: number;
    voiceConfidenceThreshold?: number;
    receiptConfidenceThreshold?: number;
    voiceProvider?: 'Sarvam' | 'Gemini' | null;
    receiptProvider?: 'Sarvam' | 'Gemini' | null;
    pattiProvider?: 'Sarvam' | 'Gemini' | null;
}

export interface AllowedTransitionsDto {
    currentStatus: string;
    allowedTransitions: Array<{
        targetStatus: string;
        requiredRole: string;
        description: string;
    }>;
}

// spec: data-principle-spine-2026-05-05/05.3
//
// Tenant DEK transport shapes. Backend issues a 256-bit AES-GCM key
// wrapped by a per-tenant KMS CMK; the client uses it to seal voice
// clips at rest (see infrastructure/security/voiceEnvelope.ts). The
// `dekBase64` field is plaintext key bytes — base64-encoded only as
// JSON transport — and the client must drop it from memory on logout.
//
// NOTE: 05.2 (backend) is being implemented in parallel; if its
// response/request field names differ, fix this file in a follow-up.
export interface TenantDekResponse {
    /** Opaque KMS-wrapped DEK identifier; echoes back via /resolve. */
    dekId: string;
    /** Base64 of the 32-byte raw AES-256 key. Never persist to disk. */
    dekBase64: string;
    /** ISO-8601 UTC instant after which the client should re-fetch. */
    expiresAtUtc: string;
}

export interface ResolveDekRequest {
    dekId: string;
}

export interface ResolveDekResponse {
    /** Base64 of the 32-byte raw AES-256 key. Never persist to disk. */
    dekBase64: string;
}
