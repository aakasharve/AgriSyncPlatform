// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.4
//
// Dexie schema v23 — strip the raw transcript from stored correction events.
//
//   `CorrectionEvent.rawTranscript` was a REQUIRED field, so every correction
//   row already on a farmer's phone carries the full utterance in unencrypted
//   IndexedDB — and `sourceText` carries the chunk of it that produced each
//   field, which is precisely where worker names appear. Removing the fields
//   from the TypeScript type stops new rows; it does nothing for the ones
//   already written. This upgrade is the half that deals with those.
//
//   No index changes: `rawTranscript`/`sourceText` were never indexed, and the
//   store line is unchanged from v22. The version exists for the `.upgrade()`.
//
//   Upgrade behavior — REMOVAL ONLY, and only of speech:
//     - deletes the top-level `rawTranscript` and `sourceText` keys;
//     - deep-strips transcript keys nested inside `aiValue` / `userValue`
//       (bucket items carry their own `sourceText`);
//     - touches NOTHING else. `fieldPath`, `aiValue`, `userValue`,
//       `correctionType` and `bucketId` — the structured signal the AI
//       learning loop consumes, and which has no other home — survive
//       byte-identically. §P0.8 protects that signal from eviction; this
//       removes the transcript inside it. The two are not in conflict.
//
//   Deliberately NOT touched: the `logs` store. Farmer logs legitimately hold
//   `fullTranscript` as the farmer's own record of their own day; §P0.4 is
//   scoped to correction events, and deleting the farmer's copy of their own
//   words is a founder decision, not an engineering one.
//
//   Idempotent per database. `delete` on an absent key is a no-op and the
//   deep strip of an already-stripped value is the identity, so a device
//   holding three farmer databases runs this three times to the same result.
//
//   One-way for APK users: an older build opening a v23 database throws. This
//   bump therefore ships ALONE — no behavioural change rides with it.
//
// @module infrastructure/storage/dexie/versions/v23

import type Dexie from 'dexie';
import type { Transaction } from 'dexie';
import { stripTranscriptText } from '../../../../domain/ai/contracts/transcriptRedaction';

export function applyV23(db: Dexie): void {
    db.version(23)
        .stores({
            // All v22 stores re-listed verbatim. No index changes — a partial
            // store list on a new version causes silent data loss on devices
            // that have never seen the omitted stores (the Dexie audit pattern).
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
        })
        .upgrade(async (tx: Transaction) => {
            await tx.table('aiCorrectionEvents').toCollection().modify((row: Record<string, unknown>) => {
                // NEVER throw inside an upgrade — one malformed row would
                // abort the transaction and the database would refuse to
                // open at all for that farmer, which is worse than the leak
                // we are closing. Every row is independently guarded, so a
                // bad row costs that row and nothing else. (v18 is the model.)
                try {
                    delete row['rawTranscript'];
                    delete row['sourceText'];

                    // Bucket items carry their own `sourceText`, so the
                    // transcript survives inside the values unless we go in
                    // after it. Reassign only when something actually
                    // changed, so a re-run writes nothing.
                    for (const key of ['aiValue', 'userValue'] as const) {
                        const before = row[key];
                        if (before === undefined) continue;
                        const after = stripTranscriptText(before);
                        if (JSON.stringify(after) !== JSON.stringify(before)) {
                            row[key] = after;
                        }
                    }
                } catch {
                    // Defensive: never abort the upgrade on a malformed row.
                }
            });
        });
}
