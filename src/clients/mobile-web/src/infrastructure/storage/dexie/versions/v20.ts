// spec: data-principle-spine-2026-05-05/10.6
//
// Dexie schema v20 — DATA_PRINCIPLE_SPINE sub-phase 10.6 (OQ-9):
// register the `pii_redaction` correction-event type. This is a
// pure-additive bump — the only change is that `correctionType` now
// accepts the new literal "pii_redaction" downstream of the
// aiCorrectionEvents store.
//
// No `.upgrade()` block is needed because the schema field types
// don't change. The new value is a TypeScript-level union extension
// (see domain/ai/contracts/CorrectionEvent.ts in the same envelope).
// `withCorrectionBucket` routes `pii_redaction` to its own bucket so
// the Phase 11 retraining reader filters it out via
// `WHERE correctionType !== 'pii_redaction'`.
//
// @module infrastructure/storage/dexie/versions/v20

import type Dexie from 'dexie';

export function applyV20(db: Dexie): void {
    db.version(20)
        .stores({
            // All v19 stores re-listed verbatim. Schema is unchanged;
            // the bump exists to anchor the OQ-9 correction-event
            // extension to a visible Dexie version (so a future
            // migration auditor can grep this version-list and find
            // why the CorrectionType union grew).
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            voiceClips: 'id, farmId, plotId, cropCycleId, recordedAtUtc, status, retentionPolicy, expiresAtUtc, wrappedDekId, consentTokenKid, [farmId+recordedAtUtc]',
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
            analyticsOutbox: '++id, createdAtUtc, attempts',
        });
    // NOTE: no `.upgrade()` block — purely additive (TS-level union
    // extension on CorrectionType; no row migration needed).
}
