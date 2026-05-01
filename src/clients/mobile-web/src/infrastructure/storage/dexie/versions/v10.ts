/**
 * Dexie schema v10 — CEI Phase 4: job cards + worker profile cache (§4.8).
 *   No upgrade function needed — both stores are fresh.
 *
 * Extracted from DexieDatabase.ts (Sub-plan 04 Task 9 file decomposition).
 * Schema string is byte-for-byte identical to the original `this.version(10).stores({...})` call.
 *
 * @module infrastructure/storage/dexie/versions/v10
 */

import type Dexie from 'dexie';

export function applyV10(db: Dexie): void {
    db.version(10).stores({
        // All v9 stores (unchanged)
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
        complianceSignals: 'id, farmId, plotId, severity, lastSeenAtUtc, [farmId+isOpen]',
        // NEW — CEI Phase 4 §4.8 (job cards + worker profile cache)
        jobCards: 'id, farmId, assignedWorkerUserId, status, modifiedAtUtc, [farmId+status]',
        workerProfiles: 'workerUserId, scopedFarmId',
    });
}
