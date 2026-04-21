/**
 * MigrationService — DFES V2
 *
 * Orchestrates the one-time migration from localStorage to Dexie/IndexedDB.
 *
 * Migration flow:
 * 1. Check if migration is needed (appMeta.migrationComplete)
 * 2. Read all logs from localStorage
 * 3. Run V1→V2 schema migration on each log
 * 4. Write migrated logs to Dexie
 * 5. Migrate audit events
 * 6. Mark migration complete in appMeta
 * 7. Keep localStorage data for 30 days (configurable), then clean up
 *
 * Safety:
 * - Never deletes localStorage data during migration
 * - Idempotent: safe to run multiple times
 * - Audit trail: records MIGRATE_SCHEMA event
 *
 * @module infrastructure/storage/MigrationService
 */

import { getDatabase, CEI_PHASE1_SCHEMA_VERSION, CEI_PHASE3_SCHEMA_VERSION } from './DexieDatabase';
import { STORAGE_KEYS } from './schema';
import { batchMigrateV1ToV2 } from './migrations/v1ToV2';
import type { DailyLog } from '../../types';
import type { AuditEvent } from './AuditLogRepository';
import { systemClock } from '../../core/domain/services/Clock';
import { idGenerator } from '../../core/domain/services/IdGenerator';

const MIGRATION_KEY = 'dexie_migration_complete';
const MIGRATION_TIMESTAMP_KEY = 'dexie_migration_timestamp';
const LOCALSTORAGE_RETENTION_DAYS = 30;

export interface MigrationResult {
    success: boolean;
    logsMigrated: number;
    logsAlreadyV2: number;
    auditEventsMigrated: number;
    error?: string;
    durationMs: number;
}

export class MigrationService {
    /**
     * Check if migration from localStorage to Dexie has been completed.
     */
    static async isMigrationComplete(): Promise<boolean> {
        const db = getDatabase();
        const entry = await db.appMeta.get(MIGRATION_KEY);
        return entry?.value === true;
    }

    /**
     * Run the full migration from localStorage to Dexie.
     * Idempotent — safe to call multiple times.
     */
    static async migrate(): Promise<MigrationResult> {
        const startTime = systemClock.nowEpoch();

        if (import.meta.env.DEV) {
            console.info(
                `[CEI] Dexie schemaVersion ${CEI_PHASE1_SCHEMA_VERSION} active — CEI Phase 1 migration applied (Task 5.1.1)`
            );
            console.info(
                `[CEI] Dexie schemaVersion ${CEI_PHASE3_SCHEMA_VERSION} RESERVED — CEI Phase 3 compliance signals pending (Task 4.1.1)`
            );
        }

        // Check if already done
        if (await this.isMigrationComplete()) {
            return {
                success: true,
                logsMigrated: 0,
                logsAlreadyV2: 0,
                auditEventsMigrated: 0,
                durationMs: systemClock.nowEpoch() - startTime,
            };
        }

        try {
            const db = getDatabase();

            // 1. Read logs from localStorage
            const rawLogs = this.readLogsFromLocalStorage();
            console.info(`[MigrationService] Found ${rawLogs.length} logs in localStorage`);

            // 2. Run V1→V2 migration
            const { migrated, migratedCount, alreadyV2Count } = batchMigrateV1ToV2(rawLogs);

            // 3. Write to Dexie (in batches to avoid transaction size limits)
            const BATCH_SIZE = 50;
            for (let i = 0; i < migrated.length; i += BATCH_SIZE) {
                const batch = migrated.slice(i, i + BATCH_SIZE);
                await db.transaction('rw', db.logs, async () => {
                    for (const log of batch) {
                        await db.logs.put({
                            id: log.id,
                            schemaVersion: 2,
                            log,
                            date: log.date,
                            verificationStatus: log.verification?.status,
                            createdByOperatorId: log.meta?.createdByOperatorId,
                            isDeleted: log.deletion ? 1 : 0,
                        });
                    }
                });
            }

            // 4. Migrate audit events
            const auditEventsMigrated = await this.migrateAuditEvents();

            // 5. Mark migration complete
            const now = new Date().toISOString();
            await db.appMeta.put({
                key: MIGRATION_KEY,
                value: true,
                updatedAt: now,
            });
            await db.appMeta.put({
                key: MIGRATION_TIMESTAMP_KEY,
                value: now,
                updatedAt: now,
            });

            // 6. Record audit event for the migration itself
            await db.auditEvents.add({
                id: `audit_migration_${idGenerator.generate()}`,
                timestamp: now,
                actorId: 'system',
                action: 'MIGRATE_SCHEMA',
                resourceId: 'localStorage_to_dexie',
                details: `Migrated ${migratedCount} logs (${alreadyV2Count} already V2), ${auditEventsMigrated} audit events`,
            });

            console.info(
                `[MigrationService] Migration complete: ${migratedCount} migrated, ${alreadyV2Count} already V2, ${auditEventsMigrated} audit events`
            );

            return {
                success: true,
                logsMigrated: migratedCount,
                logsAlreadyV2: alreadyV2Count,
                auditEventsMigrated,
                durationMs: systemClock.nowEpoch() - startTime,
            };
        } catch (error) {
            console.error('[MigrationService] Migration failed:', error);
            return {
                success: false,
                logsMigrated: 0,
                logsAlreadyV2: 0,
                auditEventsMigrated: 0,
                error: error instanceof Error ? error.message : 'Unknown error',
                durationMs: systemClock.nowEpoch() - startTime,
            };
        }
    }

    /**
     * Clean up localStorage data after the retention period.
     * Call this periodically (e.g., on app startup after migration).
     */
    static async cleanupLocalStorage(): Promise<boolean> {
        const db = getDatabase();
        const timestampEntry = await db.appMeta.get(MIGRATION_TIMESTAMP_KEY);

        if (!timestampEntry?.value) return false;

        const migrationDate = new Date(timestampEntry.value as string);
        const daysSinceMigration = (systemClock.nowEpoch() - migrationDate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceMigration >= LOCALSTORAGE_RETENTION_DAYS) {
            console.info(
                `[MigrationService] Cleaning up localStorage (${Math.floor(daysSinceMigration)} days since migration)`
            );
            localStorage.removeItem(STORAGE_KEYS.LOGS);
            localStorage.removeItem('agrilog_audit_v1');
            return true;
        }

        return false;
    }

    // ============================================
    // INTERNAL HELPERS
    // ============================================

    /**
     * Read logs from localStorage, handling both legacy and versioned formats.
     */
    private static readLogsFromLocalStorage(): DailyLog[] {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LOGS);
            if (!raw) return [];

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            if (parsed.length === 0) return [];

            // Check if versioned format (VersionedLogRecord[])
            if (typeof parsed[0]?.schemaVersion === 'number') {
                return parsed.map((r: { log: DailyLog }) => r.log);
            }

            // Legacy format (DailyLog[])
            return parsed as DailyLog[];
        } catch (error) {
            console.error('[MigrationService] Failed to read localStorage logs:', error);
            return [];
        }
    }

    /**
     * Migrate audit events from localStorage to Dexie.
     */
    private static async migrateAuditEvents(): Promise<number> {
        try {
            const raw = localStorage.getItem('agrilog_audit_v1');
            if (!raw) return 0;

            const events: AuditEvent[] = JSON.parse(raw);
            if (!Array.isArray(events) || events.length === 0) return 0;

            const db = getDatabase();
            await db.transaction('rw', db.auditEvents, async () => {
                for (const event of events) {
                    await db.auditEvents.put(event);
                }
            });

            return events.length;
        } catch (error) {
            console.error('[MigrationService] Failed to migrate audit events:', error);
            return 0;
        }
    }
}
