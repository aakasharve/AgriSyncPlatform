/**
 * Dexie schema v6 — adds pendingAiJobs store.
 *
 * Extracted from DexieDatabase.ts (Sub-plan 04 Task 9 file decomposition).
 * Schema string is byte-for-byte identical to the original `this.version(6).stores({...})` call.
 *
 * @module infrastructure/storage/dexie/versions/v6
 */

import type Dexie from 'dexie';

export function applyV6(db: Dexie): void {
    db.version(6).stores({
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
