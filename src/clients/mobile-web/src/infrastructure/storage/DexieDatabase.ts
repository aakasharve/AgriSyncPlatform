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

export interface PlannedTaskCacheRecord {
    id: string;
    cropCycleId: string;
    plannedDate: string;
    payload: unknown;
    updatedAt: string;
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
// SCHEMA VERSION CONSTANTS
// =============================================================================

/** Current Dexie schema version — bump this when adding version(N).stores(). */
export const DATABASE_VERSION = 6;
/** Reserved for CEI Phase 1 — do NOT use until Task 5.1.1 executes the actual migration. */
export const CEI_PHASE1_SCHEMA_VERSION = 7;

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
