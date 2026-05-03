/**
 * Dexie schema v15 — DWC v2 §2.6: analytics outbox.
 *   Adds the `analyticsOutbox` store so the new `AnalyticsEventBus` can
 *   persist closure-loop telemetry events through offline windows. Schema
 *   is `++id, createdAtUtc, attempts` per `ADR-2026-05-02_telemetry-batching.md`.
 *   No upgrade function — the store is fresh and starts empty on every
 *   device that crosses v14 → v15.
 *
 * @module infrastructure/storage/dexie/versions/v15
 */

import type Dexie from 'dexie';

export function applyV15(db: Dexie): void {
    db.version(15).stores({
        // All v14 stores (unchanged) — Dexie inherits prior version definitions
        // even when omitted, but listing them keeps the migration auditable.
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
        crops: 'id, updatedAtMs',
        farmerProfile: 'id, updatedAtMs',
        uiPrefs: 'key',
        // NEW — DWC v2 §2.6 (analytics outbox)
        analyticsOutbox: '++id, createdAtUtc, attempts',
    });
}
