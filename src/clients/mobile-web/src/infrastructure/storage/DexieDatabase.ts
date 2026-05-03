/**
 * DexieDatabase — DFES V2 Storage Layer
 *
 * IndexedDB-backed database using Dexie.js.
 * 9 tables: logs, outbox, mutationQueue, auditEvents, syncCursors, appMeta,
 * referenceData, attachments, uploadQueue.
 *
 * Replaces localStorage for:
 * - Larger storage capacity (no 5MB limit)
 * - Indexed queries (by date, status, operator)
 * - Transactional writes (atomic log + outbox + audit)
 *
 * @module infrastructure/storage/DexieDatabase
 */

import Dexie, { type Table } from 'dexie';
import type { DailyLog } from '../../types';
import type { AuditEvent } from './AuditLogRepository';
import type { JobCard } from '../../domain/work/JobCard';
import type { WorkerProfileData } from '../../domain/work/ReliabilityScore';
import type { CorrectionEvent } from '../../domain/ai/contracts/CorrectionEvent';
import { applyV1 } from './dexie/versions/v1';
import { applyV2 } from './dexie/versions/v2';
import { applyV3 } from './dexie/versions/v3';
import { applyV4 } from './dexie/versions/v4';
import { applyV5 } from './dexie/versions/v5';
import { applyV6 } from './dexie/versions/v6';
import { applyV7 } from './dexie/versions/v7';
import { applyV8 } from './dexie/versions/v8';
import { applyV9 } from './dexie/versions/v9';
import { applyV10 } from './dexie/versions/v10';
import { applyV11 } from './dexie/versions/v11';
import { applyV12 } from './dexie/versions/v12';
import { applyV13 } from './dexie/versions/v13';
import { applyV14 } from './dexie/versions/v14';
import { applyV15 } from './dexie/versions/v15';

// =============================================================================
// OUTBOX (Pending sync events)
// =============================================================================

export type OutboxAction =
    | 'CREATE_LOG'
    | 'UPDATE_LOG'
    | 'DELETE_LOG'
    | 'CONFIRM_LOG'
    | 'VERIFY_LOG'
    | 'DISPUTE_LOG'
    | 'CORRECT_LOG';

export type OutboxStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';

export interface OutboxEvent {
    /** Auto-incremented by Dexie */
    id?: number;
    /** Idempotency key: `{logId}_{action}_{capturedAtMs}` */
    idempotencyKey: string;
    action: OutboxAction;
    resourceId: string;
    payload: unknown;
    status: OutboxStatus;
    createdAt: string;
    retryCount: number;
    lastAttemptAt?: string;
    error?: string;
}

// =============================================================================
// MUTATION QUEUE (Backend sync-ready queue)
// =============================================================================

/**
 * Sub-plan 04 Task 5 / T-IGH-04-CONFLICT-STATUS-DURABILITY:
 * - PENDING            queued, eligible for next worker cycle.
 * - SENDING            in flight to server.
 * - APPLIED            server accepted (or duplicate).
 * - FAILED             transient failure (network blip, unknown error).
 *                      Eligible for auto-retry via markFailedAsPending.
 * - REJECTED_USER_REVIEW
 *                      DURABLE rejection — server gave an error code that
 *                      RejectionPolicy classifies as "permanent" (CLIENT_TOO_OLD,
 *                      MUTATION_TYPE_UNKNOWN, MUTATION_TYPE_UNIMPLEMENTED, etc.).
 *                      markFailedAsPending must SKIP these; the user must
 *                      explicitly retry or discard via OfflineConflictPage.
 * - REJECTED_DROPPED   user explicitly discarded a REJECTED_USER_REVIEW row.
 *                      Soft-delete — kept for audit + Sub-plan 05 E2E
 *                      assertion. Never returned by getPending(); never
 *                      included in conflict UI list().
 */
export type MutationQueueStatus =
    | 'PENDING'
    | 'SENDING'
    | 'APPLIED'
    | 'FAILED'
    | 'REJECTED_USER_REVIEW'
    | 'REJECTED_DROPPED';

export interface MutationQueueItem {
    id?: number;
    deviceId: string;
    clientRequestId: string;
    clientCommandId: string;
    mutationType: string;
    payload: unknown;
    status: MutationQueueStatus;
    createdAt: string;
    updatedAt: string;
    retryCount: number;
    lastError?: string;
}

// =============================================================================
// ATTACHMENTS (Metadata + local linkage)
// =============================================================================

export type LocalAttachmentStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface AttachmentRecord {
    /** Local attachment id (and server id when provided via attachmentId) */
    id: string;
    farmId: string;
    linkedEntityId?: string;
    linkedEntityType?: string;
    /** Device-local file reference used by upload worker */
    localPath: string;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
    status: LocalAttachmentStatus;
    remoteAttachmentId?: string;
    uploadedAtUtc?: string;
    finalizedAtUtc?: string;
    createdAt: string;
    updatedAt: string;
    retryCount: number;
    lastError?: string;
}

// =============================================================================
// ATTACHMENT UPLOAD QUEUE
// =============================================================================

export type UploadQueueStatus = 'pending' | 'uploading' | 'retry_wait' | 'failed' | 'completed';

export interface UploadQueueItem {
    autoId?: number;
    attachmentId: string;
    status: UploadQueueStatus;
    retryCount: number;
    lastAttemptAt?: string;
    nextAttemptAt?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
}

// =============================================================================
// PENDING AI JOBS (Offline queue for voice/receipt/patti AI requests)
// =============================================================================

export type PendingAiOperationType = 'voice_parse' | 'receipt_extract' | 'patti_extract';
export type PendingAiJobStatus = 'pending' | 'processing' | 'failed' | 'failed_permanent' | 'completed';

export interface PendingAiAttemptSignature {
    signature: string;
    errorClass: string;
    firstSeenAtMs: number;
    lastSeenAtMs: number;
    count: number;
}

export interface PendingAiJobContext {
    farmId?: string;
    userId?: string;
    operation?: 'voice' | 'receipt' | 'patti' | 'text';
    plotId?: string;
    cropCycleId?: string;
    cropName?: string;
    parseContext?: object;
    textTranscript?: string;
    idempotencyKey?: string;
    requestPayloadHash?: string;
    inputSpeechDurationMs?: number;
    inputRawDurationMs?: number;
    segmentMetadataJson?: string;
}

export interface PendingAiJobRecord {
    id?: number;
    operationType: PendingAiOperationType;
    inputBlob?: Blob;
    inputMimeType?: string;
    context: PendingAiJobContext;
    status: PendingAiJobStatus;
    createdAt: string;
    updatedAt: string;
    retryCount: number;
    lastError?: string;
    nextRetryAfterMs?: number;
    attemptSignatures?: PendingAiAttemptSignature[];
}

// =============================================================================
// VOICE CLIPS (30-day processing journal, no indefinite retention)
// =============================================================================

export type VoiceClipRetentionPolicy = 'processing_30d';
export type VoiceClipStatus = 'recorded' | 'queued' | 'parsing' | 'parsed' | 'failed';

export interface VoiceClipCacheRecord {
    id: string;
    farmId: string;
    plotId?: string;
    cropCycleId?: string;
    pendingAiJobId?: number;
    recordedAtUtc: string;
    durationMs?: number;
    mimeType: string;
    sizeBytes: number;
    localBlob: Blob;
    status: VoiceClipStatus;
    retentionPolicy: VoiceClipRetentionPolicy;
    expiresAtUtc: string;
    createdAt: string;
    updatedAt: string;
    lastError?: string;
}

// =============================================================================
// SYNC CURSORS
// =============================================================================

export interface SyncCursor {
    tableName: string;
    lastSyncAt: string;
    serverCursor?: string;
    version: number;
}

// =============================================================================
// APP META (Key-Value store)
// =============================================================================

export interface AppMetaEntry {
    key: string;
    value: unknown;
    updatedAt: string;
}

// =============================================================================
// REFERENCE DATA CACHE
// =============================================================================

export type ReferenceDataKey =
    | 'scheduleTemplates'
    | 'cropTypes'
    | 'activityCategories'
    | 'costCategories';

export interface ReferenceDataRecord {
    key: ReferenceDataKey;
    data: unknown;
    versionHash: string;
    updatedAt: string;
}

// =============================================================================
// SYNC CACHE TABLES
// =============================================================================

export interface DayLedgerCacheRecord {
    id: string;
    farmId: string;
    dateKey: string;
    payload: unknown;
    updatedAt: string;
}

export interface PlannedActivityOverrideMarkers {
    /** Arbitrary override marker map — keys are marker names, values are booleans or strings */
    [key: string]: boolean | string | null | undefined;
}

export interface PlannedTaskCacheRecord {
    id: string;
    cropCycleId: string;
    plannedDate: string;
    payload: unknown;
    updatedAt: string;
    /** CEI Phase 1 — template activity that sourced this planned activity */
    sourceTemplateActivityId?: string | null;
    /** CEI Phase 1 — override markers applied to this activity */
    overrideMarkers?: PlannedActivityOverrideMarkers | null;
}

export interface FarmCacheRecord {
    id: string;
    ownerAccountId?: string;
    payload: unknown;
    syncStatus?: string;
    serverUpdatedAt?: string;
    updatedAt: string;
    modifiedAtUtc?: string;
}

export interface PlotCacheRecord {
    id: string;
    farmId: string;
    ownerAccountId?: string;
    payload: unknown;
    syncStatus?: string;
    serverUpdatedAt?: string;
    updatedAt: string;
    modifiedAtUtc?: string;
}

export interface FarmBoundaryCacheRecord {
    id: string;
    farmId: string;
    ownerAccountId: string;
    payload: unknown;
    syncStatus: string;
    serverUpdatedAt: string;
    updatedAt: string;
}

export interface PlotAreaCacheRecord {
    id: string;
    plotId: string;
    farmId: string;
    ownerAccountId: string;
    payload: unknown;
    syncStatus: string;
    serverUpdatedAt: string;
    updatedAt: string;
}

export interface CropCycleCacheRecord {
    id: string;
    farmId: string;
    plotId: string;
    payload: unknown;
    updatedAt: string;
}

export interface CostEntryCacheRecord {
    id: string;
    farmId: string;
    payload: unknown;
    updatedAt: string;
}

export interface FinanceCorrectionCacheRecord {
    id: string;
    costEntryId: string;
    payload: unknown;
    updatedAt: string;
}

// =============================================================================
// SCHEDULE TEMPLATE — shape inside referenceData.data array
// =============================================================================

/** Shape of each item stored inside referenceData['scheduleTemplates'].data */
export interface ScheduleTemplateCacheItem {
    id: string;
    name?: string;
    /** CEI Phase 1 — set by server; backfilled to 1 for legacy rows */
    version?: number;
    /** CEI Phase 1 — 'Public' | 'Tenant'; backfilled to 'Public' for legacy rows */
    tenantScope?: string;
    /** CEI Phase 1 — null for system templates */
    createdByUserId?: string | null;
    previousVersionId?: string | null;
    derivedFromTemplateId?: string | null;
    publishedAtUtc?: string | null;
    [key: string]: unknown;
}

// =============================================================================
// ATTENTION CARDS (CEI Phase 1)
// =============================================================================

export interface AttentionCardCacheRecord {
    cardId: string;
    farmId: string;
    rank: string;
    computedAtUtc: string;
    // mirror of AttentionCardDto fields
    farmName: string;
    plotId: string;
    plotName: string;
    cropCycleId?: string | null;
    stageName?: string | null;
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

// =============================================================================
// VERSIONED LOG RECORD
// =============================================================================

export interface DexieLogRecord {
    /** Log ID (primary key) */
    id: string;
    /** Schema version at time of write */
    schemaVersion: number;
    /** The actual log data */
    log: DailyLog;
    /** Date string for index (YYYY-MM-DD) */
    date: string;
    /** Verification status for index */
    verificationStatus?: string;
    /** Creator operator ID for index */
    createdByOperatorId?: string;
    /** Soft-deleted flag for index */
    isDeleted: 0 | 1;
    /** Server-reported modification timestamp; used to skip stale-pull overwrites */
    serverModifiedAtUtc?: string;
}

// =============================================================================
// CEI PHASE 3 — COMPLIANCE SIGNALS (§4.6)
// =============================================================================

export interface DexieComplianceSignal {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId?: string | null;
    ruleCode: string;
    severity: string; // 'Info' | 'Watch' | 'NeedsAttention' | 'Critical'
    suggestedAction: string;
    titleEn: string;
    titleMr: string;
    descriptionEn: string;
    descriptionMr: string;
    payloadJson: string;
    firstSeenAtUtc: string;
    lastSeenAtUtc: string;
    acknowledgedAtUtc?: string | null;
    resolvedAtUtc?: string | null;
    resolutionNote?: string | null;
    isOpen: boolean;
}

// =============================================================================
// CEI PHASE 2 — TEST STACK (§4.5)
// =============================================================================

/** Mirrors ShramSafal.Domain.Tests.TestProtocolKind (numeric for index friendliness). */
export interface DexieTestProtocol {
    id: string;
    name: string;
    cropType: string;
    kind: number;
    periodicity: number;
    everyNDays?: number;
    stageNames: string[];
    parameterCodes: string[];
    createdByUserId: string;
    createdAtUtc: string;
}

export interface DexieTestResult {
    parameterCode: string;
    parameterValue: string;
    unit: string;
    referenceRangeLow?: number;
    referenceRangeHigh?: number;
}

export interface DexieTestInstance {
    id: string;
    testProtocolId: string;
    cropCycleId: string;
    farmId: string;
    plotId: string;
    stageName: string;
    /** ISO date "YYYY-MM-DD" */
    plannedDueDate: string;
    /** 0=Due, 1=Collected, 2=Reported, 3=Overdue, 4=Waived */
    status: number;
    collectedByUserId?: string;
    collectedAtUtc?: string;
    reportedByUserId?: string;
    reportedAtUtc?: string;
    waivedReason?: string;
    attachmentIds: string[];
    results: DexieTestResult[];
    protocolKind: number;
    modifiedAtUtc: string;
    createdAtUtc: string;
    /** Denormalized for list rendering */
    testProtocolName?: string;
}

export interface DexieTestRecommendation {
    id: string;
    testInstanceId: string;
    ruleCode: string;
    titleEn: string;
    titleMr: string;
    suggestedActivityName: string;
    suggestedOffsetDays: number;
    createdAtUtc: string;
}

// =============================================================================
// CEI PHASE 4 — JOB CARDS (§4.8)
// =============================================================================

export interface DexieJobCard extends JobCard {
    /** Redundant field for Dexie compound-index compatibility */
    modifiedAtUtc: string;
}

export interface DexieWorkerProfile {
    /** PK */
    workerUserId: string;
    /** Farm this cache was fetched for (part of the profile endpoint path) */
    scopedFarmId: string;
    data: WorkerProfileData;
    cachedAtUtc: string;
}

// =============================================================================
// SUB-PLAN 04 TASK 2 — FRONTEND STORAGE UNIFICATION
// =============================================================================

/**
 * Crop blob row. The full CropProfile is stored as `data`; `id` is the crop's
 * stable id (e.g. `crop_grapes`). `updatedAtMs` lets us detect stale rows
 * during the legacy-localStorage migration without changing the CropProfile
 * schema itself.
 */
export interface CropRow {
    id: string;
    data: unknown;
    updatedAtMs: number;
}

/**
 * Farmer profile blob row. Singleton: id is always `'self'`. Storing the full
 * FarmerProfile as `data` keeps the existing FarmerProfile shape untouched
 * while moving the storage substrate from localStorage to Dexie.
 */
export interface ProfileRow {
    id: 'self';
    data: unknown;
    updatedAtMs: number;
}

/**
 * UI preferences key-value store (sidebar collapsed, theme, etc). Replaces
 * the per-key localStorage scatter for non-essential UX prefs that don't need
 * to be in localStorage's sync namespace.
 */
export interface UiPrefRow {
    key: string;
    value: unknown;
}

// =============================================================================
// ANALYTICS OUTBOX (DWC v2 §2.6 — closure-loop telemetry)
// =============================================================================

/**
 * One queued analytics event awaiting POST to `/analytics/ingest`.
 * Drained by `AnalyticsEventBus` per `ADR-2026-05-02_telemetry-batching.md`:
 * 50-row batches, 5-attempt cap, all-or-nothing batch policy.
 */
export interface AnalyticsOutboxRow {
    /** Auto-incremented by Dexie. */
    id?: number;
    /** Serialized {eventType, props} — round-tripped through JSON.parse on drain. */
    payloadJson: string;
    /** Epoch ms; secondary index used for FIFO drain ordering. */
    createdAtUtc: number;
    /** Monotonic per-row send attempts; row drops at MAX_ATTEMPTS (5). */
    attempts: number;
}

// =============================================================================
// SCHEMA VERSION CONSTANTS
// =============================================================================

/** Current Dexie schema version — bump this when adding version(N).stores(). */
export const DATABASE_VERSION = 15; // DWC v2 §2.6 analytics outbox.
/** CEI Phase 1 schema version (now active — applied by Task 5.1.1). */
export const CEI_PHASE1_SCHEMA_VERSION = 7;
/** CEI Phase 2 schema version — adds test stack (protocols/instances/recs). */
export const CEI_PHASE2_SCHEMA_VERSION = 8;
/** CEI Phase 3 schema version — adds compliance signals store (§4.6). RESERVED. */
export const CEI_PHASE3_SCHEMA_VERSION = 9;
/** CEI Phase 4 schema version — job cards + worker profiles (stores added in Task 6.1.1). RESERVED. */
export const CEI_PHASE4_SCHEMA_VERSION = 10;
/** Farm geography schema version — ownerAccount scoped cache tables. */
export const FARM_GEOGRAPHY_SCHEMA_VERSION = 11;
/** AI voice journal schema version — local 30-day processing clips only. */
export const AI_VOICE_JOURNAL_SCHEMA_VERSION = 12;
/** AI correction event schema version — per-bucket correction-rate signal. */
export const AI_CORRECTION_EVENTS_SCHEMA_VERSION = 13;
/** Sub-plan 04 Task 2 — crops + farmerProfile + uiPrefs unification (away from localStorage). */
export const SUBPLAN_04_FRONTEND_STORAGE_SCHEMA_VERSION = 14;
/** DWC v2 §2.6 — analytics outbox store for closure-loop telemetry. */
export const DWC_TELEMETRY_OUTBOX_SCHEMA_VERSION = 15;

// =============================================================================
// DATABASE CLASS
// =============================================================================

export class AgriLogDatabase extends Dexie {
    logs!: Table<DexieLogRecord, string>;
    outbox!: Table<OutboxEvent, number>;
    mutationQueue!: Table<MutationQueueItem, number>;
    attachments!: Table<AttachmentRecord, string>;
    uploadQueue!: Table<UploadQueueItem, number>;
    pendingAiJobs!: Table<PendingAiJobRecord, number>;
    voiceClips!: Table<VoiceClipCacheRecord, string>;
    aiCorrectionEvents!: Table<CorrectionEvent, string>;
    auditEvents!: Table<AuditEvent, string>;
    syncCursors!: Table<SyncCursor, string>;
    appMeta!: Table<AppMetaEntry, string>;
    referenceData!: Table<ReferenceDataRecord, ReferenceDataKey>;
    dayLedgers!: Table<DayLedgerCacheRecord, string>;
    plannedTasks!: Table<PlannedTaskCacheRecord, string>;

    farms!: Table<FarmCacheRecord, string>;
    plots!: Table<PlotCacheRecord, string>;
    farmBoundaries!: Table<FarmBoundaryCacheRecord, string>;
    plotAreas!: Table<PlotAreaCacheRecord, string>;
    cropCycles!: Table<CropCycleCacheRecord, string>;
    costEntries!: Table<CostEntryCacheRecord, string>;
    financeCorrections!: Table<FinanceCorrectionCacheRecord, string>;

    /** CEI Phase 1 — server-computed attention cards */
    attentionCards!: Table<AttentionCardCacheRecord, string>;

    /** CEI Phase 2 §4.5 — test stack */
    testProtocols!: Table<DexieTestProtocol, string>;
    testInstances!: Table<DexieTestInstance, string>;
    testRecommendations!: Table<DexieTestRecommendation, string>;

    /** CEI Phase 3 §4.6 — compliance signals */
    complianceSignals!: Table<DexieComplianceSignal, string>;

    /** CEI Phase 4 §4.8 — job cards */
    jobCards!: Table<DexieJobCard, string>;
    /** CEI Phase 4 §4.8 — worker profile cache */
    workerProfiles!: Table<DexieWorkerProfile, string>;

    /** Sub-plan 04 Task 2 — crops as Dexie rows (away from localStorage). */
    crops!: Table<CropRow, string>;
    /** Sub-plan 04 Task 2 — farmer profile singleton (away from localStorage). */
    farmerProfile!: Table<ProfileRow, 'self'>;
    /** Sub-plan 04 Task 2 — misc UI preferences key-value store. */
    uiPrefs!: Table<UiPrefRow, string>;

    /** DWC v2 §2.6 — analytics outbox; drained by `AnalyticsEventBus`. */
    analyticsOutbox!: Table<AnalyticsOutboxRow, number>;

    constructor() {
        super('AgriLogDB');

        // Schema versions are declared in dexie/versions/v{N}.ts. Each applyVN
        // call performs `this.version(N).stores({...})` (and any `.upgrade()`
        // chain). Order matters — Dexie applies migrations sequentially.
        applyV1(this);
        applyV2(this);
        applyV3(this);
        applyV4(this);
        applyV5(this);
        applyV6(this);
        applyV7(this);
        applyV8(this);
        applyV9(this);
        applyV10(this);
        applyV11(this);
        applyV12(this);
        applyV13(this);
        applyV14(this);
        applyV15(this);
    }
}

// =============================================================================
// SINGLETON
// =============================================================================

let dbInstance: AgriLogDatabase | null = null;

/**
 * Get the singleton database instance.
 * Creates it on first call.
 */
export function getDatabase(): AgriLogDatabase {
    if (!dbInstance) {
        dbInstance = new AgriLogDatabase();
    }
    return dbInstance;
}

/**
 * Reset the database instance (for testing).
 * @internal
 */
export async function resetDatabase(): Promise<void> {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}
