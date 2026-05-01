/**
 * Dexie schema v13 — AI Correction Events: bucket-level human correction signal.
 *   This is local-first telemetry; upload is opt-in and can be added
 *   later without changing the event contract.
 *
 * Extracted from DexieDatabase.ts (Sub-plan 04 Task 9 file decomposition).
 * Schema string is byte-for-byte identical to the original `this.version(13).stores({...})` call.
 *
 * @module infrastructure/storage/dexie/versions/v13
 */

import type Dexie from 'dexie';

export function applyV13(db: Dexie): void {
    db.version(13).stores({
        logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
        outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
        mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
        attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
        uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
        pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
        voiceClips: 'id, farmId, plotId, cropCycleId, recordedAtUtc, status, retentionPolicy, expiresAtUtc, [farmId+recordedAtUtc]',
        aiCorrectionEvents: 'id, extractionId, timestamp, correctionType, bucketId, fieldPath',
        auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
        syncCursors: 'tableName',
        appMeta: 'key',
        referenceData: 'key, versionHash, updatedAt',
        dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
        plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
        farms: 'id, ownerAccountId, [ownerAccountId+id], syncStatus, serverUpdatedAt, modifiedAtUtc',
        plots: 'id, farmId, ownerAccountId, [ownerAccountId+farmId], syncStatus, serverUpdatedAt, modifiedAtUtc',
        farmBoundaries: 'id, farmId, ownerAccountId, [ownerAccountId+farmId], syncStatus, serverUpdatedAt',
        plotAreas: 'id, plotId, farmId, ownerAccountId, [ownerAccountId+farmId], syncStatus, serverUpdatedAt',
        cropCycles: 'id, farmId, plotId, modifiedAtUtc',
        costEntries: 'id, farmId, modifiedAtUtc',
        financeCorrections: 'id, costEntryId, modifiedAtUtc',
        attentionCards: 'cardId, farmId, rank, computedAtUtc',
        testProtocols: 'id, cropType, kind',
        testInstances: 'id, cropCycleId, farmId, plannedDueDate, status, modifiedAtUtc',
        testRecommendations: 'id, testInstanceId',
        complianceSignals: 'id, farmId, plotId, severity, lastSeenAtUtc, [farmId+isOpen]',
        jobCards: 'id, farmId, assignedWorkerUserId, status, modifiedAtUtc, [farmId+status]',
        workerProfiles: 'workerUserId, scopedFarmId',
    });
}
