// RESERVED: this branch (feat/dfes-companion) owns Dexie schema version 23.
//
// Founder decision 18 (2026-08-16): feat/dfes-companion and
// feat/server-authoritative-architecture each independently created a v23.ts
// exporting applyV23, and each registered applyV23(this) in DexieDatabase.ts.
// origin/main tops out at v22. Dexie never re-runs a version it has already
// applied — if this branch ships v23 to farmers and the sibling branch later
// ships a DIFFERENT v23, those devices are already at IndexedDB 23 and will
// NEVER run the sibling's upgrade. Permanent, silent schema divergence, no
// error thrown.
//
// Resolution: this branch ships first and keeps v23. feat/server-authoritative-
// architecture MUST renumber its own applyV23 to v24 (registered as
// db.version(24)) before any web deploy from that branch.
//
// spec: dfes-companion-2026-07-11
//
// Dexie schema v23 — Phase 4: voice-continuity pending-interpretation store.
//
// Adds `pendingInterpretations`: durable captures (transcript-only / audio-only)
// that could not be structured at record time. Purely additive — no `.upgrade()`
// callback, no row migration. All v22 stores are re-listed verbatim; a partial
// store list on a new version causes silent data loss / VersionError on devices
// that have never seen the omitted stores.
//
// @module infrastructure/storage/dexie/versions/v23

import type Dexie from 'dexie';

export function applyV23(db: Dexie): void {
    db.version(23)
        .stores({
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
            // NEW — Phase 4 voice-continuity captures.
            pendingInterpretations: 'captureId, farmId, status, createdAtUtc, [status+createdAtUtc]',
        });
    // No `.upgrade()` — additive store, no data migration.
}
