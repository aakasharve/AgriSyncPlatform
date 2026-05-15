/**
 * Dexie schema v16 — DATA_PRINCIPLE_SPINE sub-phase 01.6: provenance backfill.
 *
 *   No schema-shape change relative to v15 (store map is re-listed verbatim
 *   per the established Dexie audit pattern). The `.upgrade()` callback
 *   stamps a `pre_spine` provenance marker on every existing `logs` row
 *   whose `log.meta` is missing a `provenance` object — never overwriting
 *   an existing one. This mirrors the backend sub-phase 01.3 migration
 *   backfill: `source='pre_spine'`, `modelVersion='unknown'`,
 *   `promptVersion='unknown'`, `promptContentHash=null`, `appVersion=null`.
 *
 *   `'pre_spine'` is a frontend-local marker — it is never sent in
 *   mutations. Fresh parses from `BackendAiClient` continue to stamp
 *   `source='ai'`; manual entries stay `source='manual'`.
 *
 * @module infrastructure/storage/dexie/versions/v16
 */

import type Dexie from 'dexie';
import type { Transaction } from 'dexie';

export function applyV16(db: Dexie): void {
    db.version(16)
        .stores({
            // All v15 stores (unchanged) — Dexie inherits prior version
            // definitions even when omitted, but listing them keeps the
            // migration auditable.
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            voiceClips: 'id, farmId, plotId, cropCycleId, recordedAtUtc, status, retentionPolicy, expiresAtUtc, [farmId+recordedAtUtc]',
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
            // Stamp existing logs with pre_spine honesty (matches backend
            // sub-phase 01.3 migration backfill). Never overwrite an
            // existing `meta.provenance`.
            await tx.table('logs').toCollection().modify((record: Record<string, unknown>) => {
                const log = record['log'] as Record<string, unknown> | undefined;
                if (!log) return;
                const meta = log['meta'] as Record<string, unknown> | undefined;
                if (!meta) return;
                if (meta['provenance']) return;
                const lastModified = typeof meta['lastModified'] === 'string'
                    ? (meta['lastModified'] as string)
                    : new Date().toISOString();
                meta['provenance'] = {
                    source: 'pre_spine',
                    modelVersion: 'unknown',
                    promptVersion: 'unknown',
                    promptContentHash: null,
                    appVersion: null,
                    timestamp: lastModified,
                };
            });
        });
}
