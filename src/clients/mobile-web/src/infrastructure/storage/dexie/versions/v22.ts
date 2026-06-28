// spec: ai-intelligence-plan-2026-06-25
//
// Dexie schema v22 — W1.P2: per-field `FieldProvenance` carry-through.
//
// Per-field provenance (`provenance?: FieldProvenance`) rides on the cached
// AgriLogResponse/DexieLogRecord objects (inside the `log.parsedLog` payload).
// No new indexed column is needed — provenance is a nested optional property
// inside the log JSON blob, which Dexie stores as-is.
//
// This version bump exists to:
//   1. Anchor the W1.P2 frontend change to a visible Dexie migration point
//      so a future auditor can grep the version chain and understand when
//      provenance fields became valid on stored event items.
//   2. Satisfy the established pattern: every schema-relevant change gets a
//      version file even when no `.upgrade()` callback is needed.
//
// All stores are re-listed verbatim from v21 (the Dexie audit pattern —
// a partial store list on a new version causes silent data loss / VersionError
// on devices that have never seen the omitted stores).
//
// Upgrade behavior — purely additive, NO row migration:
//   Pre-existing log rows survive untouched; their event-item `provenance`
//   fields are simply absent (undefined) which is the correct default for
//   pre-W1.P2 data.
//
// @module infrastructure/storage/dexie/versions/v22

import type Dexie from 'dexie';

export function applyV22(db: Dexie): void {
    db.version(22)
        .stores({
            // All v21 stores re-listed verbatim. No index changes.
            // v21 added `s3RetainedKey` to voiceClips; all other stores
            // are unchanged since v17–v20. Re-listing is mandatory per
            // the Dexie audit pattern to prevent silent data loss.
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            voiceClips: 'id, farmId, plotId, cropCycleId, recordedAtUtc, status, retentionPolicy, expiresAtUtc, wrappedDekId, consentTokenKid, s3RetainedKey, [farmId+recordedAtUtc]',
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
    // NOTE: no `.upgrade()` block — provenance is a nested optional field
    // inside the log JSON blob. Pre-existing rows simply have undefined
    // event-item provenance, which is the correct default. Rollback is
    // safe because removing the version is a no-op for stored data.
}
