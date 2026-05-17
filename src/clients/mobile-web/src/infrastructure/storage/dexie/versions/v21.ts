// spec: voice-diary-e2e-2026-05-17 (D.17)
//
// Dexie schema v21 — VOICE DIARY E2E: stamp each voiceClips row with a
// pointer to its retained-tier S3 copy when (and only when) the user
// flips FullHistoryJournal ON and the AiJobWorker hook successfully
// archives the clip via `archiveToRetainedTierIfConsented`.
//
// The `voiceClips` store gains an `s3RetainedKey` secondary index so a
// future sweep / observability query can locate "every local clip that
// has been mirrored to S3 already" without a full table scan. All other
// stores are re-listed verbatim per the established Dexie audit pattern
// (see v20.ts header).
//
// Upgrade behavior — purely additive, NO row migration:
//
// Pre-existing `voiceClips` rows survive untouched; their
// `s3RetainedKey` column is implicitly `undefined` (Dexie does not
// enforce non-null on optional fields). The archive worker will stamp
// the column on the next successful retained-tier persist for clips
// captured AFTER the user grants FullHistoryJournal.
//
// @module infrastructure/storage/dexie/versions/v21

import type Dexie from 'dexie';

export function applyV21(db: Dexie): void {
    db.version(21)
        .stores({
            // All v20 stores re-listed; only `voiceClips` adds the
            // `s3RetainedKey` secondary index.
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            // NEW (v21): `s3RetainedKey` index supports "which local clips
            // have a cloud copy already" lookups + observability queries.
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
    // NOTE: no `.upgrade()` block — purely additive. Pre-existing
    // voiceClips rows carry `s3RetainedKey = undefined`. The archive
    // worker stamps the column on the next successful retained-tier
    // persist. Rollback is safe because removing the index is a no-op
    // for rows that don't carry the field.
}
