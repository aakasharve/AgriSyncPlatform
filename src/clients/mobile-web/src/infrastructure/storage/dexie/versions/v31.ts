// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन") - Dexie schema v31.
//
// Adds ONE index: `plannedWork.ownItemId` (a plan made from the farmer's own schedule names the own work it was made from; the phone finds "is this work
// already planned?" by it). No store is added or removed; the new plan fields (scheduleTaskKey, occurrence, expectedFrom / expectedTo, waiting, signAnswer) are
// plain fields that need no index. v30 is slice 3's.
//
// Every v30 store is RE-LISTED VERBATIM (the whole `.stores({...})` list of v30.ts) - a partial store list on a new version causes silent data loss on devices
// that have never seen the omitted stores (the Dexie audit pattern; see v24's header). `pendingInterpretations` is DELIBERATELY absent for the same reason as in
// v24 to v30.
//
// One-way for APK users (an older build opening a v31 database throws), so this bump ships WITH the feature that needs it and nothing else rides along
// (v24.ts:59-60 rule). No `.upgrade()` callback: an added index on an existing store needs no data migration (rows without the field are simply not in it).
//
// @module infrastructure/storage/dexie/versions/v31

import type Dexie from 'dexie';

export function applyV31(db: Dexie): void {
    db.version(31)
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
            // spec: schedule mechanism slice 5 - v31 adds the `ownItemId` index: the plans made from an own work (one open occurrence at a time) are found by it.
            plannedWork: 'id, farmId, status, assigneeUserId, modifiedAtUtc, ownItemId',
            // spec: lane SCH-ID-P - the pictures of schedule makers (a person's photo, a schedule's picture, an institution's logo), keyed by the
            // server's picture id; the Blob is the image, `sha256` the hash the server named for it.
            schedulePictures: 'pictureId, kind, fetchedAt',
            // spec: schedule mechanism slice 3 - a plot-season's OWN schedule while it is built: the works as the server holds them (keyed by the server's id, a
            // UUIDv5 of crop season + task key) and every save / removal of them. Server rows only; this phone's unanswered changes are in the queue.
            ownScheduleItems: 'id, farmId, plotId, cropCycleId, [cropCycleId+taskKey], state',
            ownScheduleItemRevisions: 'id, itemId, farmId, cropCycleId, atUtc',
        });
}
