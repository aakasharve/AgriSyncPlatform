/**
 * DexieLogsRepository — DFES V2
 *
 * Drop-in replacement for LocalStorageLogsRepository.
 * Implements the same LogsRepository port using Dexie/IndexedDB.
 *
 * Key differences from localStorage version:
 * - Atomic transactions (log + outbox + audit in one tx)
 * - Indexed queries (no more full-scan filtering)
 * - No 5MB storage limit
 * - Outbox event creation on every mutation
 *
 * @module infrastructure/storage/DexieLogsRepository
 */

import type { DailyLog, LogVerificationStatus } from '../../types';
import type { LogsRepository, StorageEvent, StorageEventListener } from '../../application/ports';
import { getDatabase, type DexieLogRecord, type OutboxEvent } from './DexieDatabase';
import { type AuditEvent, type AuditAction } from './AuditLogRepository';
import { VersionRegistry } from '../../core/contracts/VersionRegistry';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import { normalizeMojibakeDeep } from '../../shared/utils/textEncoding';

const SCHEMA_VERSION = VersionRegistry.DB_SCHEMA_VERSION;

/**
 * Create a DexieLogRecord from a DailyLog for indexed storage.
 */
function toRecord(log: DailyLog): DexieLogRecord {
    const normalizedLog = normalizeMojibakeDeep(log).value as DailyLog;
    return {
        id: normalizedLog.id,
        schemaVersion: SCHEMA_VERSION,
        log: normalizedLog,
        date: normalizedLog.date,
        verificationStatus: normalizedLog.verification?.status,
        createdByOperatorId: normalizedLog.meta?.createdByOperatorId,
        isDeleted: normalizedLog.deletion ? 1 : 0,
    };
}

/**
 * P0.5 — CARRY THE SYNC WATERMARK ACROSS EVERY LOCAL WRITE, IN ONE PLACE.
 *
 * `serverModifiedAtUtc` is not a field of `DailyLog`; it is sync control state
 * with exactly one writer (`reconcileLogs`) and one reader (the freshness guard
 * that stops a STALE pull overwriting a fresher local row). `toRecord` builds a
 * record from a `DailyLog` and therefore cannot carry it — so any bare
 * `put(toRecord(...))` silently ERASES the watermark and disarms that guard.
 *
 * `save()` already did this correctly and inline. `batchSave()` and `delete()`
 * did not, and `batchSave` is the primary confirm-and-save path — so the guard
 * was disarmed on nearly every log a farmer saved, not merely on deletes. The
 * visible consequence was a deleted log returning on the next pull.
 *
 * Extracted rather than copied a third time: three inline copies of a rule this
 * subtle is how the second one drifts from the first.
 *
 * A log this device never pulled has no watermark and still gets none — this
 * cannot invent a sync that did not happen (`P4`).
 */
function toRecordPreservingWatermark(
    log: DailyLog,
    existing: DexieLogRecord | undefined,
): DexieLogRecord {
    return {
        ...toRecord(log),
        ...(existing?.serverModifiedAtUtc
            ? { serverModifiedAtUtc: existing.serverModifiedAtUtc }
            : {}),
    };
}

function normalizeForRead(log: DailyLog): DailyLog {
    return normalizeMojibakeDeep(log).value as DailyLog;
}

/**
 * Generate an idempotency key for outbox events.
 */
function idempotencyKey(logId: string, action: string): string {
    return `${logId}_${action}_${systemClock.nowEpoch()}`;
}

export class DexieLogsRepository implements LogsRepository {
    private static instance: DexieLogsRepository;
    private listeners: Set<StorageEventListener> = new Set();

    private constructor() { }

    static getInstance(): DexieLogsRepository {
        if (!DexieLogsRepository.instance) {
            DexieLogsRepository.instance = new DexieLogsRepository();
        }
        return DexieLogsRepository.instance;
    }

    // ============================================
    // READ OPERATIONS
    // ============================================

    async getAll(filters?: { includeDeleted?: boolean }): Promise<DailyLog[]> {
        const db = getDatabase();
        if (filters?.includeDeleted) {
            const records = await db.logs.toArray();
            return records.map(r => normalizeForRead(r.log));
        }
        const records = await db.logs.where('isDeleted').equals(0).toArray();
        return records.map(r => normalizeForRead(r.log));
    }

    async getByDate(date: string): Promise<DailyLog[]> {
        const db = getDatabase();
        const records = await db.logs
            .where('[date+isDeleted]')
            .equals([date, 0])
            .toArray();
        return records.map(r => normalizeForRead(r.log));
    }

    async getByPlot(plotId: string): Promise<DailyLog[]> {
        const db = getDatabase();
        const records = await db.logs.where('isDeleted').equals(0).toArray();
        return records
            .filter(r =>
                r.log.context.selection.some(sel =>
                    sel.selectedPlotIds.includes(plotId)
                )
            )
            .map(r => normalizeForRead(r.log));
    }

    async getById(id: string): Promise<DailyLog | null> {
        const db = getDatabase();
        const record = await db.logs.get(id);
        return record ? normalizeForRead(record.log) : null;
    }

    // ============================================
    // WRITE OPERATIONS (Atomic transactions)
    // ============================================

    async save(log: DailyLog, audit?: { actorId: string; reason: string; action?: string }): Promise<void> {
        const db = getDatabase();
        const existing = await db.logs.get(log.id);
        const isUpdate = !!existing;

        // Determine Action
        let action = audit?.action;
        if (!action) {
            action = isUpdate ? 'UPDATE_LOG' : 'CREATE_LOG';
        }

        await db.transaction('rw', [db.logs, db.outbox, db.auditEvents], async () => {
            // 1. Write log record.
            //
            //    LABOUR_PHASE2 PHASE 4 — `serverModifiedAtUtc` SURVIVES A LOCAL
            //    EDIT. `toRecord` builds a record from a `DailyLog`, and this
            //    column is not on a `DailyLog`: it is sync control state written
            //    by exactly one writer, `reconcileLogs`, which uses it to skip a
            //    STALE pull rather than overwrite a fresher local row
            //    (`logsReconciler.ts:94-100`). A plain `put(toRecord(log))`
            //    therefore ERASED it.
            //
            //    That was inert until Phase 4, because `save` had no production
            //    caller at all — `UpdateLog` is its first. With one, the erasure
            //    would silently disarm the freshness guard for every log a
            //    farmer edits: the next pull would find no watermark, adopt the
            //    server's rebuild of the log unconditionally, and take the
            //    farmer's just-saved irrigation or machinery edit with it, on a
            //    pull that had nothing new to say about that log.
            //
            //    Read from `existing`, never minted. A record this device has
            //    never pulled has no watermark and still gets none — this cannot
            //    invent a sync that did not happen (`P4`).
            await db.logs.put(toRecordPreservingWatermark(log, existing));

            // 2. Write outbox event
            const outboxEvent: OutboxEvent = {
                idempotencyKey: idempotencyKey(log.id, action!),
                // Pre-existing `as any`, narrowed to the field's own type to
                // clear the strict pre-commit ESLint gate on a file this task
                // stages for the first time. Runtime behaviour is identical —
                // both are erased at emit; `action` is a `string` by this point
                // (the `if (!action)` above guarantees it) and this assertion
                // simply names the union it is being stored as.
                action: action as OutboxEvent['action'],
                resourceId: log.id,
                payload: log,
                status: 'PENDING',
                createdAt: new Date().toISOString(),
                retryCount: 0,
            };
            await db.outbox.add(outboxEvent);

            // 3. Write audit event (Unified - Fix-07)
            const auditEvent: AuditEvent = {
                id: idGenerator.generate(),
                timestamp: systemClock.nowISO(),
                actorId: audit?.actorId ?? log.meta?.createdByOperatorId ?? 'unknown',
                action: action as AuditAction,
                resourceId: log.id,
                details: audit?.reason ?? (isUpdate ? 'Log updated' : 'Log created'),
            };
            await db.auditEvents.add(auditEvent);
        });

        this.emit({
            type: isUpdate ? 'LOG_UPDATED' : 'LOG_CREATED',
            log,
        });
    }

    async batchSave(logs: DailyLog[]): Promise<void> {
        if (logs.length === 0) return;

        const db = getDatabase();

        await db.transaction('rw', [db.logs, db.outbox, db.auditEvents], async () => {
            const now = new Date().toISOString();

            for (const log of logs) {
                // P0.5 — the watermark survives a batch save exactly as it
                // survives a single one. This is the confirm-and-save path, so
                // the bare `put(toRecord(log))` that stood here disarmed the
                // freshness guard on nearly every log a farmer records.
                const existing = await db.logs.get(log.id);
                await db.logs.put(toRecordPreservingWatermark(log, existing));

                await db.outbox.add({
                    idempotencyKey: idempotencyKey(log.id, 'UPDATE_LOG'),
                    action: 'UPDATE_LOG',
                    resourceId: log.id,
                    payload: log,
                    status: 'PENDING',
                    createdAt: now,
                    retryCount: 0,
                });
            }

            await db.auditEvents.add({
                id: idGenerator.generate(),
                timestamp: now,
                actorId: logs[0]?.meta?.createdByOperatorId ?? 'unknown',
                action: 'UPDATE_LOG',
                resourceId: `batch_${logs.length}`,
                details: `Batch saved ${logs.length} logs`,
            });
        });

        this.emit({ type: 'LOGS_BATCH_SAVED', count: logs.length });
    }

    async delete(id: string, actorId: string, reason: string): Promise<void> {
        const db = getDatabase();
        const record = await db.logs.get(id);
        if (!record) return;

        const updatedLog: DailyLog = {
            ...record.log,
            deletion: {
                deletedAtISO: new Date().toISOString(),
                deletedByOperatorId: actorId,
                reason,
            },
        };

        await db.transaction('rw', [db.logs, db.outbox, db.auditEvents], async () => {
            // P0.5 — a delete that erased the watermark left the next pull free
            // to overwrite the row, and the log the farmer deleted came back.
            await db.logs.put(toRecordPreservingWatermark(updatedLog, record));

            await db.outbox.add({
                idempotencyKey: idempotencyKey(id, 'DELETE_LOG'),
                action: 'DELETE_LOG',
                resourceId: id,
                payload: { reason },
                status: 'PENDING',
                createdAt: new Date().toISOString(),
                retryCount: 0,
            });

            await db.auditEvents.add({
                id: idGenerator.generate(),
                timestamp: systemClock.nowISO(),
                actorId,
                action: 'DELETE_LOG',
                resourceId: id,
                details: `Soft deleted: ${reason}`,
            });
        });

        this.emit({ type: 'LOG_DELETED', logId: id });
    }

    async updateVerification(
        id: string,
        status: LogVerificationStatus,
        verifierId?: string
    ): Promise<void> {
        const db = getDatabase();
        const record = await db.logs.get(id);
        if (!record) {
            throw new Error(`Log with ID ${id} not found for verification update`);
        }

        const updatedLog: DailyLog = {
            ...record.log,
            verification: {
                ...record.log.verification,
                status,
                required: record.log.verification?.required ?? true,
                verifiedByOperatorId: verifierId,
                verifiedAtISO: new Date().toISOString(),
            },
        };

        await db.transaction('rw', [db.logs, db.outbox, db.auditEvents], async () => {
            // §P0.7 review B003 — THE FOURTH WRITER, missed when
            // `toRecordPreservingWatermark` was extracted for the other three.
            // A bare `toRecord` erases `serverModifiedAtUtc`, which disarms the
            // pull's freshness guard AND — since §P0.7 box 2e — makes the log
            // look locally-authored to `strandedLogReconciler`, which would then
            // re-enqueue a record the server already has as a fresh create.
            //
            // Latent: this method has no production caller today. Fixed anyway,
            // because "safe as long as nobody calls that method" is not an
            // invariant, and `__tests__/DexieLogsRepository.watermark.test.ts`
            // now holds all four writers to it rather than leaving it a
            // convention.
            await db.logs.put(toRecordPreservingWatermark(updatedLog, record));

            await db.outbox.add({
                idempotencyKey: idempotencyKey(id, 'VERIFY_LOG'),
                action: 'VERIFY_LOG',
                resourceId: id,
                payload: { status, verifierId },
                status: 'PENDING',
                createdAt: new Date().toISOString(),
                retryCount: 0,
            });

            await db.auditEvents.add({
                id: idGenerator.generate(),
                timestamp: systemClock.nowISO(),
                actorId: verifierId ?? 'unknown',
                action: 'VERIFY_LOG',
                resourceId: id,
                details: `Verification status changed to ${status}`,
            });
        });

        this.emit({ type: 'VERIFICATION_UPDATED', logId: id, status });
    }

    // ============================================
    // EXTENDED QUERY METHODS
    // ============================================

    async getByVerificationStatus(status: LogVerificationStatus): Promise<DailyLog[]> {
        const db = getDatabase();
        const records = await db.logs
            .where('verificationStatus')
            .equals(status)
            .toArray();
        return records.filter(r => !r.isDeleted).map(r => normalizeForRead(r.log));
    }

    async getUnverifiedLogs(): Promise<DailyLog[]> {
        const db = getDatabase();
        const records = await db.logs.where('isDeleted').equals(0).toArray();
        return records
            .filter(r =>
                !r.verificationStatus ||
                r.verificationStatus === 'PENDING' ||
                r.verificationStatus === 'DRAFT'
            )
            .map(r => normalizeForRead(r.log));
    }

    async getByOperator(operatorId: string): Promise<DailyLog[]> {
        const db = getDatabase();
        const records = await db.logs
            .where('[createdByOperatorId+isDeleted]')
            .equals([operatorId, 0])
            .toArray();
        return records.map(r => normalizeForRead(r.log));
    }

    async getByDateRange(startDate: string, endDate: string): Promise<DailyLog[]> {
        const db = getDatabase();
        const records = await db.logs
            .where('date')
            .between(startDate, endDate, true, true)
            .toArray();
        return records.filter(r => !r.isDeleted).map(r => normalizeForRead(r.log));
    }

    async count(): Promise<number> {
        const db = getDatabase();
        return db.logs.where('isDeleted').equals(0).count();
    }

    async exists(id: string): Promise<boolean> {
        const db = getDatabase();
        const record = await db.logs.get(id);
        return !!record;
    }

    // ============================================
    // OUTBOX METHODS (for sync layer)
    // ============================================

    async getPendingOutboxEvents(): Promise<OutboxEvent[]> {
        const db = getDatabase();
        return db.outbox.where('status').equals('PENDING').toArray();
    }

    async markOutboxEventSent(id: number): Promise<void> {
        const db = getDatabase();
        await db.outbox.update(id, { status: 'SENT' });
    }

    async markOutboxEventFailed(id: number, error: string): Promise<void> {
        const db = getDatabase();
        const event = await db.outbox.get(id);
        if (event) {
            await db.outbox.update(id, {
                status: 'FAILED',
                retryCount: event.retryCount + 1,
                lastAttemptAt: new Date().toISOString(),
                error,
            });
        }
    }

    // ============================================
    // EVENT SUBSCRIPTION
    // ============================================

    subscribe(listener: StorageEventListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private emit(event: StorageEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('[DexieLogsRepository] Listener error:', error);
            }
        }
    }
}
