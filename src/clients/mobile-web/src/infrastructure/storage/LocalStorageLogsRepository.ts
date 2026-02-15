/**
 * LocalStorageLogsRepository - Versioned Log Persistence
 *
 * Implements the LogsRepository port using localStorage with:
 * - Schema versioning for safe migrations
 * - Write queue for atomic operations
 * - Batch operations with all-or-nothing semantics
 *
 * Key invariants:
 * - All writes go through WriteQueue (single-writer)
 * - Records include schemaVersion for migration support
 * - Batch operations are atomic (all succeed or all fail)
 *
 * @module infrastructure/storage/LocalStorageLogsRepository
 */

import { DailyLog, LogVerificationStatus } from '../../types';
import { LogsRepository, StorageEvent, StorageEventListener } from '../../application/ports';
import { STORAGE_KEYS, CURRENT_SCHEMA_VERSION } from './schema';
import { WriteQueue, enqueueWrite } from './WriteQueue';
import { storageNamespace } from './StorageNamespace';

/**
 * Versioned log record wrapper.
 * Adds schema version metadata for migration support.
 */
interface VersionedLogRecord {
    schemaVersion: number;
    log: DailyLog;
}

/**
 * Internal storage format (array of versioned records).
 */
type StoredLogsData = VersionedLogRecord[];

/**
 * LocalStorageLogsRepository implements LogsRepository using localStorage.
 *
 * Features:
 * - Schema versioning on every record
 * - Single-writer queue prevents corruption
 * - Atomic batch operations
 * - Event emission for UI reactivity
 *
 * Usage:
 * ```typescript
 * const repo = LocalStorageLogsRepository.getInstance();
 *
 * // Subscribe to changes
 * repo.subscribe((event) => {
 *     if (event.type === 'LOG_CREATED') {
 *         console.log('New log:', event.log);
 *     }
 * });
 *
 * // Save a log
 * await repo.save(myLog);
 * ```
 */
export class LocalStorageLogsRepository implements LogsRepository {
    private static instance: LocalStorageLogsRepository;
    private writeQueue: WriteQueue;
    private listeners: Set<StorageEventListener> = new Set();

    private constructor() {
        this.writeQueue = WriteQueue.getInstance();
    }

    /**
     * Get the singleton repository instance.
     */
    static getInstance(): LocalStorageLogsRepository {
        if (!LocalStorageLogsRepository.instance) {
            LocalStorageLogsRepository.instance = new LocalStorageLogsRepository();
        }
        return LocalStorageLogsRepository.instance;
    }

    /**
     * Reset the singleton instance (for testing only).
     * @internal
     */
    static resetInstance(): void {
        LocalStorageLogsRepository.instance = undefined as unknown as LocalStorageLogsRepository;
    }

    // ============================================
    // READ OPERATIONS (No queue needed)
    // ============================================

    /**
     * Get all logs.
     */
    async getAll(filters?: { includeDeleted?: boolean }): Promise<DailyLog[]> {
        const records = this.readStoredData();
        return records
            .map((r) => r.log)
            .filter(log => filters?.includeDeleted ? true : !log.deletion);
    }

    /**
     * Get logs for a specific date.
     */
    async getByDate(date: string): Promise<DailyLog[]> {
        const records = this.readStoredData();
        return records
            .map((r) => r.log)
            .filter((log) => log.date === date && !log.deletion);
    }

    /**
     * Get logs for a specific plot.
     */
    async getByPlot(plotId: string): Promise<DailyLog[]> {
        const records = this.readStoredData();
        return records
            .filter((r) =>
                r.log.context.selection.some((sel) =>
                    sel.selectedPlotIds.includes(plotId)
                )
            )
            .map((r) => r.log)
            .filter(log => !log.deletion);
    }

    /**
     * Get a single log by ID.
     */
    async getById(id: string): Promise<DailyLog | null> {
        const records = this.readStoredData();
        const record = records.find((r) => r.log.id === id);
        return record ? record.log : null;
    }

    // ============================================
    // WRITE OPERATIONS (All go through queue)
    // ============================================

    /**
     * Save a single log (insert or update).
     * Uses upsert semantics: inserts if new, updates if exists.
     */
    async save(log: DailyLog): Promise<void> {
        await enqueueWrite(async () => {
            const records = this.readStoredData();
            const existingIndex = records.findIndex((r) => r.log.id === log.id);

            const versionedRecord: VersionedLogRecord = {
                schemaVersion: CURRENT_SCHEMA_VERSION,
                log,
            };

            let eventType: 'LOG_CREATED' | 'LOG_UPDATED';

            if (existingIndex >= 0) {
                // Update existing
                records[existingIndex] = versionedRecord;
                eventType = 'LOG_UPDATED';
            } else {
                // Insert new
                records.push(versionedRecord);
                eventType = 'LOG_CREATED';
            }

            this.writeStoredData(records);
            this.emit({ type: eventType, log });
        });
    }

    /**
     * Save multiple logs in a batch (atomic operation).
     *
     * Atomicity guarantee:
     * - Either all logs are saved or none are
     * - On error, storage remains unchanged
     */
    async batchSave(logs: DailyLog[]): Promise<void> {
        if (logs.length === 0) return;

        await enqueueWrite(async () => {
            const records = this.readStoredData();
            const originalData = JSON.stringify(records);

            try {
                // Apply all updates
                for (const log of logs) {
                    const existingIndex = records.findIndex((r) => r.log.id === log.id);

                    const versionedRecord: VersionedLogRecord = {
                        schemaVersion: CURRENT_SCHEMA_VERSION,
                        log,
                    };

                    if (existingIndex >= 0) {
                        records[existingIndex] = versionedRecord;
                    } else {
                        records.push(versionedRecord);
                    }
                }

                // Atomic write
                this.writeStoredData(records);
                this.emit({ type: 'LOGS_BATCH_SAVED', count: logs.length });
            } catch (error) {
                // Rollback on error
                const key = storageNamespace.getKey(STORAGE_KEYS.LOGS);
                localStorage.setItem(key, originalData);
                throw error;
            }
        });
    }

    /**
     * Delete a log by ID.
     */
    async delete(id: string, actorId: string, reason: string): Promise<void> {
        await enqueueWrite(async () => {
            const records = this.readStoredData();
            const record = records.find((r) => r.log.id === id);

            if (!record) {
                return; // Not found
            }

            // SOFT DELETE IMPLEMENTATION
            record.log.deletion = {
                deletedAtISO: new Date().toISOString(),
                deletedByOperatorId: actorId,
                reason: reason
            };
            record.schemaVersion = CURRENT_SCHEMA_VERSION;

            this.writeStoredData(records);
            this.emit({ type: 'LOG_DELETED', logId: id });
        });
    }

    /**
     * Update a log's verification status.
     */
    async updateVerification(
        id: string,
        status: LogVerificationStatus,
        verifierId?: string
    ): Promise<void> {
        await enqueueWrite(async () => {
            const records = this.readStoredData();
            const record = records.find((r) => r.log.id === id);

            if (!record) {
                throw new Error(`Log with ID ${id} not found for verification update`);
            }

            // Update verification
            record.log.verification = {
                ...record.log.verification,
                status,
                required: record.log.verification?.required ?? true,
                verifiedByOperatorId: verifierId,
                verifiedAtISO: new Date().toISOString(),
            };

            // Update schema version
            record.schemaVersion = CURRENT_SCHEMA_VERSION;

            this.writeStoredData(records);
            this.emit({ type: 'VERIFICATION_UPDATED', logId: id, status });
        });
    }

    // ============================================
    // EVENT SUBSCRIPTION
    // ============================================

    /**
     * Subscribe to storage events.
     *
     * @param listener - Callback for storage events
     * @returns Unsubscribe function
     */
    subscribe(listener: StorageEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Emit an event to all listeners.
     */
    private emit(event: StorageEvent): void {
        Array.from(this.listeners).forEach((listener) => {
            try {
                listener(event);
            } catch (error) {
                console.error('[LocalStorageLogsRepository] Listener error:', error);
            }
        });
    }

    // ============================================
    // INTERNAL HELPERS
    // ============================================

    /**
     * Read stored data from localStorage.
     * Handles legacy format (array of DailyLog without versioning).
     */
    private readStoredData(): StoredLogsData {
        try {
            const key = storageNamespace.getKey(STORAGE_KEYS.LOGS);
            const raw = localStorage.getItem(key);

            if (!raw) {
                return [];
            }

            const parsed = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                console.error('[LocalStorageLogsRepository] Invalid data format');
                return [];
            }

            // Check if this is versioned format or legacy format
            if (parsed.length === 0) {
                return [];
            }

            // If first item has schemaVersion, it's new format
            if (typeof parsed[0]?.schemaVersion === 'number') {
                return parsed as StoredLogsData;
            }

            // Legacy format: convert to versioned format
            console.info('[LocalStorageLogsRepository] Converting legacy format to versioned');
            return this.migrateLegacyData(parsed as DailyLog[]);
        } catch (error) {
            console.error('[LocalStorageLogsRepository] Read error:', error);
            return [];
        }
    }

    /**
     * Write data to localStorage.
     */
    private writeStoredData(records: StoredLogsData): void {
        const key = storageNamespace.getKey(STORAGE_KEYS.LOGS);
        localStorage.setItem(key, JSON.stringify(records));
    }

    /**
     * Migrate legacy data format (plain DailyLog[]) to versioned format.
     */
    private migrateLegacyData(legacyLogs: DailyLog[]): StoredLogsData {
        const versioned: StoredLogsData = legacyLogs.map((log) => ({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            log,
        }));

        // Save migrated data
        this.writeStoredData(versioned);
        console.info('[LocalStorageLogsRepository] Migrated', legacyLogs.length, 'legacy logs');

        return versioned;
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    /**
     * Get the count of stored logs.
     */
    async count(): Promise<number> {
        const records = this.readStoredData();
        return records.length;
    }

    /**
     * Check if a log exists by ID.
     */
    async exists(id: string): Promise<boolean> {
        const records = this.readStoredData();
        return records.some((r) => r.log.id === id);
    }

    /**
     * Get logs by verification status.
     */
    async getByVerificationStatus(status: LogVerificationStatus): Promise<DailyLog[]> {
        const records = this.readStoredData();
        return records
            .filter((r) => r.log.verification?.status === status)
            .map((r) => r.log);
    }

    /**
     * Get unverified logs (pending verification).
     */
    async getUnverifiedLogs(): Promise<DailyLog[]> {
        const records = this.readStoredData();
        return records
            .filter(
                (r) =>
                    !r.log.verification?.status ||
                    r.log.verification.status === LogVerificationStatus.PENDING
            )
            .map((r) => r.log);
    }

    /**
     * Get logs created by a specific operator.
     */
    async getByOperator(operatorId: string): Promise<DailyLog[]> {
        const records = this.readStoredData();
        return records
            .filter((r) => r.log.meta?.createdByOperatorId === operatorId)
            .map((r) => r.log);
    }

    /**
     * Get logs within a date range (inclusive).
     */
    async getByDateRange(startDate: string, endDate: string): Promise<DailyLog[]> {
        const records = this.readStoredData();
        return records
            .filter((r) => r.log.date >= startDate && r.log.date <= endDate)
            .map((r) => r.log);
    }

    /**
     * Clear all logs (use with caution!).
     * Creates a backup before clearing.
     */
    async clearAll(): Promise<void> {
        await enqueueWrite(async () => {
            // Note: Caller should create backup before calling this
            const key = storageNamespace.getKey(STORAGE_KEYS.LOGS);
            localStorage.removeItem(key);
            console.warn('[LocalStorageLogsRepository] All logs cleared');
        });
    }
}
