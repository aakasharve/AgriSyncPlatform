/**
 * DexieDatabase — DFES V2 Storage Layer
 *
 * IndexedDB-backed database using Dexie.js.
 * 10 tables: logs, outbox, mutationQueue, auditEvents, syncCursors, appMeta,
 * dayLedgers, plannedTasks, attachments, uploadQueue.
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
    mutationType: string;
    payload: unknown;
    status: MutationQueueStatus;
    createdAt: string;
    updatedAt: string;
    retryCount: number;
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

export type GpsConsentDecision = 'granted' | 'denied' | 'later';

export interface GpsConsentMetaValue {
    askedAt: string;
    decision: GpsConsentDecision;
}

export const GPS_CONSENT_META_KEY = 'gps_consent';

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

// =============================================================================
// ATTACHMENTS CACHE + UPLOAD QUEUE
// =============================================================================

export type AttachmentStatus = 'pending' | 'uploading' | 'finalized' | 'failed';

export interface AttachmentRecord {
    id: string;
    farmId: string;
    linkedEntityId?: string;
    linkedEntityType?: string;
    localPath: string;
    status: AttachmentStatus;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    serverAttachmentId?: string;
    storagePath?: string;
    uploadedByUserId?: string;
    createdAtUtc: string;
    finalizedAtUtc?: string;
    updatedAt: string;
    lastError?: string;
}

export type UploadQueueStatus = 'pending' | 'uploading' | 'completed' | 'failed';

export interface UploadQueueItem {
    autoId?: number;
    attachmentId: string;
    status: UploadQueueStatus;
    retryCount: number;
    lastAttemptAt?: string;
    createdAt: string;
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
}

// =============================================================================
// DATABASE CLASS
// =============================================================================

export class AgriLogDatabase extends Dexie {
    logs!: Table<DexieLogRecord, string>;
    outbox!: Table<OutboxEvent, number>;
    mutationQueue!: Table<MutationQueueItem, number>;
    auditEvents!: Table<AuditEvent, string>;
    syncCursors!: Table<SyncCursor, string>;
    appMeta!: Table<AppMetaEntry, string>;
    dayLedgers!: Table<DayLedgerCacheRecord, string>;
    plannedTasks!: Table<PlannedTaskCacheRecord, string>;
    attachments!: Table<AttachmentRecord, string>;
    uploadQueue!: Table<UploadQueueItem, number>;

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
            dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
            plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
        });

        this.version(4).stores({
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
            dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
            plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, serverAttachmentId, [linkedEntityId+linkedEntityType], [status+updatedAt]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt',
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
