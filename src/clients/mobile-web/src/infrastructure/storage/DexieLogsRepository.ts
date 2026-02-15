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

const SCHEMA_VERSION = VersionRegistry.DB_SCHEMA_VERSION;

/**
 * Create a DexieLogRecord from a DailyLog for indexed storage.
 */
function toRecord(log: DailyLog): DexieLogRecord {
    return {
        id: log.id,
        schemaVersion: SCHEMA_VERSION,
        log,
        date: log.date,
        verificationStatus: log.verification?.status,
        createdByOperatorId: log.meta?.createdByOperatorId,
        isDeleted: log.deletion ? 1 : 0,
    };
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
            return records.map(r => r.log);
        }
        const records = await db.logs.where('isDeleted').equals(0).toArray();
        return records.map(r => r.log);
    }

    async getByDate(date: string): Promise<DailyLog[]> {
        const db = getDatabase();
        const records = await db.logs
            .where('[date+isDeleted]')
            .equals([date, 0])
            .toArray();
        return records.map(r => r.log);
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
            .map(r => r.log);
    }

    async getById(id: string): Promise<DailyLog | null> {
        const db = getDatabase();
        const record = await db.logs.get(id);
        return record ? record.log : null;
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
            // 1. Write log record
            await db.logs.put(toRecord(log));

            // 2. Write outbox event
            const outboxEvent: OutboxEvent = {
                idempotencyKey: idempotencyKey(log.id, action!),
                action: action as any,
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
                await db.logs.put(toRecord(log));

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
            await db.logs.put(toRecord(updatedLog));

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
            await db.logs.put(toRecord(updatedLog));

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
        return records.filter(r => !r.isDeleted).map(r => r.log);
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
            .map(r => r.log);
    }

    async getByOperator(operatorId: string): Promise<DailyLog[]> {
        const db = getDatabase();
        const records = await db.logs
            .where('[createdByOperatorId+isDeleted]')
            .equals([operatorId, 0])
            .toArray();
        return records.map(r => r.log);
    }

    async getByDateRange(startDate: string, endDate: string): Promise<DailyLog[]> {
        const db = getDatabase();
        const records = await db.logs
            .where('date')
            .between(startDate, endDate, true, true)
            .toArray();
        return records.filter(r => !r.isDeleted).map(r => r.log);
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
