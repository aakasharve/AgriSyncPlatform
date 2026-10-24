// spec: 2026-08-28-labour-v2-release-1 (Labour V2 R1 Task 3.5c)
//
// Dexie schema v25 — adds the `attendanceMarks` store: server-acknowledged
// attendance rulings, carried down by /sync/pull.
//
// Every v24 store is RE-LISTED VERBATIM (v24.ts:70-107) — a partial store
// list on a new version causes silent data loss on devices that have never
// seen the omitted stores (the Dexie audit pattern; see v24's header for the
// measured v23 incident). `pendingInterpretations` is DELIBERATELY absent
// from this list for the same reason it is absent from v24's: it is DFES's
// v23 store, Dexie treats an unlisted store as unchanged, and re-listing it
// wrongly here is what WOULD delete it.
//
// One-way for APK users (an older build opening a v25 database throws), so
// this bump ships WITH the feature that needs it — the attendance write
// path — and nothing else rides along (v24.ts:59-60 rule).
//
// No `.upgrade()` callback: a brand-new empty store needs no data migration.
//
// @module infrastructure/storage/dexie/versions/v25

import type Dexie from 'dexie';

export function applyV25(db: Dexie): void {
    db.version(25)
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
            // Labour V2 R1 Task 3.5c — server-acknowledged attendance marks,
            // carried down by /sync/pull. Grain matches ux_attendance_marks_
            // farm_operator_day. Queue rows in `mutationQueue` are the UNSYNCED
            // half; getLocalAttendanceMarks merges the two with `source` so no
            // reader can render intent as saved (P10).
            attendanceMarks: 'id, farmId, workDate, [farmId+workDate]',
        });
}
