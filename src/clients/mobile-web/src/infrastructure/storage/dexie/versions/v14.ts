/**
 * Dexie schema v14 — Sub-plan 04 Task 2: frontend storage unification.
 *   Adds crops + farmerProfile + uiPrefs stores so the React app can
 *   move off localStorage for these surfaces. No upgrade function —
 *   all three stores are fresh; existing localStorage data is moved
 *   in by `LegacyLocalStorageMigrator` on app startup, not by a Dexie
 *   schema upgrade.
 *
 * Extracted from DexieDatabase.ts (Sub-plan 04 Task 9 file decomposition).
 * Schema string is byte-for-byte identical to the original `this.version(14).stores({...})` call.
 *
 * @module infrastructure/storage/dexie/versions/v14
 */

import type Dexie from 'dexie';

export function applyV14(db: Dexie): void {
    db.version(14).stores({
        // All v13 stores (unchanged)
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
        // NEW — Sub-plan 04 Task 2 (frontend storage unification)
        crops: 'id, updatedAtMs',
        farmerProfile: 'id, updatedAtMs',
        uiPrefs: 'key',
    });
}
