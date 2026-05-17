// spec: data-principle-spine-2026-05-05/05.3
//
// Dexie schema v18 — DATA_PRINCIPLE_SPINE sub-phase 05.3: voice clip
// envelope encryption migration.
//
//   The `voiceClips` store schema gains a `wrappedDekId` index so
//   future read-path code can look up clips by DEK id when the cached
//   DEK has rotated. All other stores are re-listed verbatim per the
//   established Dexie audit pattern (see v17.ts header).
//
//   Upgrade behavior — one-way migration:
//
//   Pre-existing `voiceClips` rows carry plaintext audio in `localBlob`
//   (the old shape). We do NOT re-seal them in-place during the upgrade
//   because that would require a synchronous network round-trip to
//   `GET /shramsafal/security/tenant-dek` from inside the Dexie upgrade
//   transaction — which is both (a) racy with auth state at app boot,
//   and (b) violates the "upgrades must be deterministic and offline"
//   contract. Instead we tag them with `needsResealOnNextAccess = true`
//   and the read-path / next-write-path is responsible for re-sealing.
//
//   Per the plan's Rollback section (§Rollback), this migration is
//   intentionally lossy in the rollback direction: once a clip has
//   been re-sealed under a DEK and the DEK is unreachable (logout,
//   tenant deletion), the plaintext is gone. That's the point — it's
//   not a bug to fix, it's the privacy property we're buying.
//
// @module infrastructure/storage/dexie/versions/v18

import type Dexie from 'dexie';
import type { Transaction } from 'dexie';

export function applyV18(db: Dexie): void {
    db.version(18)
        .stores({
            // All v17 stores re-listed; only `voiceClips` adds the
            // `wrappedDekId` secondary index. Dexie inherits prior
            // version definitions even when omitted, but explicit
            // listing keeps the migration auditable.
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            // NEW: `wrappedDekId` index supports the rotation lookup path.
            voiceClips: 'id, farmId, plotId, cropCycleId, recordedAtUtc, status, retentionPolicy, expiresAtUtc, wrappedDekId, [farmId+recordedAtUtc]',
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
            // Mark every pre-existing plaintext clip for re-sealing on
            // next access. We never throw inside an upgrade — a single
            // bad row would block the whole DB from opening on the
            // affected device — so the mutation is wrapped defensively.
            await tx.table('voiceClips').toCollection().modify((row: Record<string, unknown>) => {
                try {
                    // Skip rows already in the sealed shape (defensive — a
                    // row could in theory exist with ciphertext if a future
                    // hot-reload re-ran the upgrade; this is a no-op then).
                    if (row['ciphertext']) return;
                    if (row['localBlob']) {
                        row['needsResealOnNextAccess'] = true;
                    }
                } catch {
                    // Defensive: never abort the upgrade on a malformed row.
                }
            });
        });
}
