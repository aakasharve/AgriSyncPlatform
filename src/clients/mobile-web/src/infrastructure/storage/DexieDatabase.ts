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

export type MutationQueueStatus = 'PENDING' | 'SENDING' | 'APPLIED' | 'FAILED';

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
    payload: unknown;
    updatedAt: string;
}

export interface PlotCacheRecord {
    id: string;
    farmId: string;
    payload: unknown;
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
// SCHEMA VERSION CONSTANTS
// =============================================================================

/** Current Dexie schema version — bump this when adding version(N).stores(). */
export const DATABASE_VERSION = 10; // CEI Phase 4 — job cards + worker profiles (stores added in Task 6.1.1)
/** CEI Phase 1 schema version (now active — applied by Task 5.1.1). */
export const CEI_PHASE1_SCHEMA_VERSION = 7;
/** CEI Phase 2 schema version — adds test stack (protocols/instances/recs). */
export const CEI_PHASE2_SCHEMA_VERSION = 8;
/** CEI Phase 3 schema version — adds compliance signals store (§4.6). RESERVED. */
export const CEI_PHASE3_SCHEMA_VERSION = 9;
/** CEI Phase 4 schema version — job cards + worker profiles (stores added in Task 6.1.1). RESERVED. */
export const CEI_PHASE4_SCHEMA_VERSION = 10;

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
    auditEvents!: Table<AuditEvent, string>;
    syncCursors!: Table<SyncCursor, string>;
    appMeta!: Table<AppMetaEntry, string>;
    referenceData!: Table<ReferenceDataRecord, ReferenceDataKey>;
    dayLedgers!: Table<DayLedgerCacheRecord, string>;
    plannedTasks!: Table<PlannedTaskCacheRecord, string>;

    farms!: Table<FarmCacheRecord, string>;
    plots!: Table<PlotCacheRecord, string>;
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

    constructor() {
        super('AgriLogDB');

        this.version(1).stores({
            // logs: primary key = id, indexes for common queries
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',

            // outbox: auto-increment id, indexes for sync processing
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',

            // auditEvents: primary key = id, indexes for lookups
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',

            // syncCursors: primary key = tableName
            syncCursors: 'tableName',

            // appMeta: key-value store
            appMeta: 'key',
        });

        this.version(2).stores({
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
        });

        this.version(3).stores({
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
            referenceData: 'key, versionHash, updatedAt',
            dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
            plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
        });

        this.version(4).stores({
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
            referenceData: 'key, versionHash, updatedAt',
        });

        this.version(5).stores({
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
            referenceData: 'key, versionHash, updatedAt',
            dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
            plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
            farms: 'id, modifiedAtUtc',
            plots: 'id, farmId, modifiedAtUtc',
            cropCycles: 'id, farmId, plotId, modifiedAtUtc',
            costEntries: 'id, farmId, modifiedAtUtc',
            financeCorrections: 'id, costEntryId, modifiedAtUtc'
        });

        this.version(6).stores({
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
            referenceData: 'key, versionHash, updatedAt',
            dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
            plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
            farms: 'id, modifiedAtUtc',
            plots: 'id, farmId, modifiedAtUtc',
            cropCycles: 'id, farmId, plotId, modifiedAtUtc',
            costEntries: 'id, farmId, modifiedAtUtc',
            financeCorrections: 'id, costEntryId, modifiedAtUtc'
        });

        // =====================================================================
        // CEI Phase 1 — v7: attention cards store + CEI §4.1–§4.4 backfills
        // =====================================================================
        this.version(7)
            .stores({
                // All v6 stores (unchanged)
                logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
                outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
                mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
                attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
                uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
                pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
                auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
                syncCursors: 'tableName',
                appMeta: 'key',
                referenceData: 'key, versionHash, updatedAt',
                dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
                plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
                farms: 'id, modifiedAtUtc',
                plots: 'id, farmId, modifiedAtUtc',
                cropCycles: 'id, farmId, plotId, modifiedAtUtc',
                costEntries: 'id, farmId, modifiedAtUtc',
                financeCorrections: 'id, costEntryId, modifiedAtUtc',
                // NEW — CEI Phase 1
                attentionCards: 'cardId, farmId, rank, computedAtUtc',
            })
            .upgrade(async tx => {
                // CEI-I4: backfill executionStatus = 'Completed' for all existing
                // log task records. DexieLogRecord stores the mapped DailyLog
                // (not raw DTOs), so log.log.tasks may be absent — the modify
                // is a safe no-op for any row that does not have a tasks array.
                await tx.table('logs').toCollection().modify((record: Record<string, unknown>) => {
                    const log = record['log'] as Record<string, unknown> | undefined;
                    if (log && Array.isArray(log['tasks'])) {
                        log['tasks'] = (log['tasks'] as Array<Record<string, unknown>>).map(task => ({
                            ...task,
                            executionStatus: task['executionStatus'] ?? 'Completed',
                        }));
                    }
                });

                // CEI §4.3: backfill schedule template reference data rows.
                const templateRef = await tx.table('referenceData').get('scheduleTemplates');
                if (templateRef?.data && Array.isArray(templateRef.data)) {
                    templateRef.data = (templateRef.data as Array<Record<string, unknown>>).map(t => ({
                        ...t,
                        version: t['version'] ?? 1,
                        tenantScope: t['tenantScope'] ?? 'Public',
                        createdByUserId: t['createdByUserId'] ?? null,
                    }));
                    await tx.table('referenceData').put(templateRef);
                }

                // CEI §4.2: backfill plannedTasks with new optional fields.
                await tx.table('plannedTasks').toCollection().modify((task: Record<string, unknown>) => {
                    if (task['sourceTemplateActivityId'] === undefined) {
                        task['sourceTemplateActivityId'] = null;
                    }
                    if (task['overrideMarkers'] === undefined) {
                        task['overrideMarkers'] = null;
                    }
                });
            });

        // =====================================================================
        // CEI Phase 2 — v8: test stack (§4.5)
        //   No upgrade function needed — all three stores are fresh.
        // =====================================================================
        this.version(8).stores({
            // All v7 stores (unchanged)
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
            referenceData: 'key, versionHash, updatedAt',
            dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
            plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
            farms: 'id, modifiedAtUtc',
            plots: 'id, farmId, modifiedAtUtc',
            cropCycles: 'id, farmId, plotId, modifiedAtUtc',
            costEntries: 'id, farmId, modifiedAtUtc',
            financeCorrections: 'id, costEntryId, modifiedAtUtc',
            attentionCards: 'cardId, farmId, rank, computedAtUtc',
            // NEW — CEI Phase 2 §4.5 (test stack)
            testProtocols: 'id, cropType, kind',
            testInstances: 'id, cropCycleId, farmId, plannedDueDate, status, modifiedAtUtc',
            testRecommendations: 'id, testInstanceId',
        });

        // =====================================================================
        // CEI Phase 3 — v9: compliance signals store (§4.6)
        //   No upgrade function needed — fresh store, no backfill required.
        // =====================================================================
        this.version(9).stores({
            // All v8 stores (unchanged)
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
            referenceData: 'key, versionHash, updatedAt',
            dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
            plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
            farms: 'id, modifiedAtUtc',
            plots: 'id, farmId, modifiedAtUtc',
            cropCycles: 'id, farmId, plotId, modifiedAtUtc',
            costEntries: 'id, farmId, modifiedAtUtc',
            financeCorrections: 'id, costEntryId, modifiedAtUtc',
            attentionCards: 'cardId, farmId, rank, computedAtUtc',
            testProtocols: 'id, cropType, kind',
            testInstances: 'id, cropCycleId, farmId, plannedDueDate, status, modifiedAtUtc',
            testRecommendations: 'id, testInstanceId',
            // NEW — CEI Phase 3 §4.6 (compliance signals)
            complianceSignals: 'id, farmId, plotId, severity, lastSeenAtUtc, [farmId+isOpen]',
        });
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
