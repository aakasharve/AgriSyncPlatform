// spec: data-principle-spine-2026-05-05/06.5
//
// Dexie schema v19 — DATA_PRINCIPLE_SPINE sub-phase 06.5: stamp each
// voice clip with the consent-token `kid` it was sealed under.
//
//   The `voiceClips` store schema gains a `consentTokenKid` secondary
//   index so the audit/export path can scan clips by signing key id
//   (e.g. "every clip sealed under kid X must be re-checked after
//   counsel sign-off changes the consent text version"). All other
//   stores are re-listed verbatim per the established Dexie audit
//   pattern (see v18.ts header).
//
//   Upgrade behavior — purely additive, NO row migration:
//
//   Pre-existing `voiceClips` rows survive untouched; their
//   `consentTokenKid` column is implicitly `undefined`. A future
//   re-seal or write path can stamp the kid (see Phase 07 §6.5.2
//   re-seal cascade — the current envelope intentionally leaves this
//   un-stamped because the kid is only known at clip-capture time,
//   and pre-v19 rows were captured before the consent token primitive
//   existed).
//
//   Rollback semantics (per plan §Rollback): subsequent v20 may remove
//   the `consentTokenKid` index. The Dexie store key path itself does
//   not enforce non-null, so removing the index is safe even with rows
//   that carry the field.
//
// @module infrastructure/storage/dexie/versions/v19

import type Dexie from 'dexie';

export function applyV19(db: Dexie): void {
    db.version(19)
        .stores({
            // All v18 stores re-listed; only `voiceClips` adds the
            // `consentTokenKid` secondary index. Dexie inherits prior
            // version definitions even when omitted, but explicit
            // listing keeps the migration auditable.
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            // NEW (v19): `consentTokenKid` index supports clip→consent-state lookup.
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
    // NOTE: no `.upgrade()` block — pre-existing voiceClips rows carry
    // `consentTokenKid = undefined` until they are re-sealed under a
    // valid consent token. A future re-seal cascade (Phase 07 §6.5.2)
    // will stamp the kid; this migration is purely schema-additive.
}
