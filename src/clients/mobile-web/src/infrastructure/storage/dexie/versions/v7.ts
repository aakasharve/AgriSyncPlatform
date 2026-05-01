/**
 * Dexie schema v7 — CEI Phase 1: attention cards store + CEI §4.1–§4.4 backfills.
 *
 * Extracted from DexieDatabase.ts (Sub-plan 04 Task 9 file decomposition).
 * Schema string and `.upgrade()` callback are byte-for-byte identical to the
 * original `this.version(7).stores({...}).upgrade(async tx => ...)` call.
 *
 * @module infrastructure/storage/dexie/versions/v7
 */

import type Dexie from 'dexie';

export function applyV7(db: Dexie): void {
    db.version(7)
        .stores({
            // All v6 stores (unchanged)
            logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',
            outbox: '++id, idempotencyKey, status, action, [status+createdAt]',
            mutationQueue: '++id, &[deviceId+clientRequestId], status, mutationType, createdAt, [status+createdAt]',
            attachments: 'id, farmId, linkedEntityId, linkedEntityType, localPath, status, [linkedEntityId+linkedEntityType], [farmId+status]',
            uploadQueue: '++autoId, attachmentId, status, retryCount, lastAttemptAt, nextAttemptAt, [status+nextAttemptAt]',
            pendingAiJobs: '++id, operationType, status, createdAt, [status+createdAt]',
            auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',
            syncCursors: 'tableName',
            appMeta: 'key',
            referenceData: 'key, versionHash, updatedAt',
            dayLedgers: 'id, farmId, dateKey, [farmId+dateKey]',
            plannedTasks: 'id, cropCycleId, plannedDate, [cropCycleId+plannedDate]',
            farms: 'id, modifiedAtUtc',
            plots: 'id, farmId, modifiedAtUtc',
            cropCycles: 'id, farmId, plotId, modifiedAtUtc',
            costEntries: 'id, farmId, modifiedAtUtc',
            financeCorrections: 'id, costEntryId, modifiedAtUtc',
            // NEW — CEI Phase 1
            attentionCards: 'cardId, farmId, rank, computedAtUtc',
        })
        .upgrade(async tx => {
            // CEI-I4: backfill executionStatus = 'Completed' for all existing
            // log task records. DexieLogRecord stores the mapped DailyLog
            // (not raw DTOs), so log.log.tasks may be absent — the modify
            // is a safe no-op for any row that does not have a tasks array.
            await tx.table('logs').toCollection().modify((record: Record<string, unknown>) => {
                const log = record['log'] as Record<string, unknown> | undefined;
                if (log && Array.isArray(log['tasks'])) {
                    log['tasks'] = (log['tasks'] as Array<Record<string, unknown>>).map(task => ({
                        ...task,
                        executionStatus: task['executionStatus'] ?? 'Completed',
                    }));
                }
            });

            // CEI §4.3: backfill schedule template reference data rows.
            const templateRef = await tx.table('referenceData').get('scheduleTemplates');
            if (templateRef?.data && Array.isArray(templateRef.data)) {
                templateRef.data = (templateRef.data as Array<Record<string, unknown>>).map(t => ({
                    ...t,
                    version: t['version'] ?? 1,
                    tenantScope: t['tenantScope'] ?? 'Public',
                    createdByUserId: t['createdByUserId'] ?? null,
                }));
                await tx.table('referenceData').put(templateRef);
            }

            // CEI §4.2: backfill plannedTasks with new optional fields.
            await tx.table('plannedTasks').toCollection().modify((task: Record<string, unknown>) => {
                if (task['sourceTemplateActivityId'] === undefined) {
                    task['sourceTemplateActivityId'] = null;
                }
                if (task['overrideMarkers'] === undefined) {
                    task['overrideMarkers'] = null;
                }
            });
        });
}
