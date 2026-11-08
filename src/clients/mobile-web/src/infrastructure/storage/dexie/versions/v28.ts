// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1, founder D-24c) - Dexie schema v28.
//
// Adds the `plannedWork` store: the phone's copy of the farm's tasks and reminders as the server keeps them (pull key
// `plannedWork`, each row as THIS person may see it). One row per task: { id, farmId, title, scope, status, assigneeUserId, ...,
// modifiedAtUtc, plots: [...] }. Changes made on this phone and not yet answered are NOT rows here: they stay in the mutation
// queue and `getLocalPlannedWork` merges the two with a label (P10: queued intent is never drawn as saved).
//
// v27 is TAKEN (lane L8b-2: `scheduleSubscriptions`); the plan said v27 and the code moved on, so this is v28.
//
// Every v27 store is RE-LISTED VERBATIM (the whole `.stores({...})` list of v27.ts) - a partial store list on a new version
// causes silent data loss on devices that have never seen the omitted stores (the Dexie audit pattern; see v24's header for
// the measured v23 incident). `pendingInterpretations` is DELIBERATELY absent for the same reason as in v24 to v27: it is
// DFES's v23 store, Dexie treats an unlisted store as unchanged, and re-listing it wrongly here is what WOULD delete it.
//
// One-way for APK users (an older build opening a v28 database throws), so this bump ships WITH the feature that needs it and
// nothing else rides along (v24.ts:59-60 rule). No `.upgrade()` callback: a brand-new empty store needs no data migration.
//
// @module infrastructure/storage/dexie/versions/v28

import type Dexie from 'dexie';

export function applyV28(db: Dexie): void {
    db.version(28)
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
            // spec: lane IT1c Task 4 - the offline copy of the server's published input library (one row, id 'current').
            // A global reference copy: it holds no farm data and is the same for every person on the device.
            inputLibrary: 'id',
            // spec: lane L8b-2 - the plot's chosen schedule (server rows + this phone's unanswered choices).
            scheduleSubscriptions: 'id, farmId, plotId, cropCycleId, state',
            // spec: lane L8c-1 - the farm's tasks and reminders (server rows only; this phone's unanswered changes are in the queue).
            plannedWork: 'id, farmId, status, assigneeUserId, modifiedAtUtc',
        });
}
