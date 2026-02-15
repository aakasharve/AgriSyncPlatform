/**
 * BackupService - Storage Backup and Recovery
 *
 * Provides backup and restore capabilities for all stored data.
 * Backups are stored in localStorage with timestamp-based keys.
 *
 * Key capabilities:
 * - Create timestamped backups before risky operations
 * - Restore from any available backup
 * - List and manage backup history
 * - Auto-cleanup of old backups (configurable retention)
 *
 * @module infrastructure/storage/BackupService
 */

import { STORAGE_KEYS, CURRENT_SCHEMA_VERSION } from './schema';
import { WriteQueue } from './WriteQueue';

/**
 * Metadata about a backup.
 */
export interface BackupMetadata {
    key: string;
    timestamp: string;
    schemaVersion: number;
    description?: string;
    size: number; // bytes
}

/**
 * Structure of a backup.
 */
interface BackupData {
    meta: {
        timestamp: string;
        schemaVersion: number;
        description?: string;
        appVersion?: string;
    };
    data: {
        logs: string | null;
        profile: string | null;
        tasks: string | null;
    };
}

/**
 * BackupService handles storage backup and restoration.
 *
 * Usage:
 * ```typescript
 * const backup = BackupService.getInstance();
 *
 * // Create backup before migration
 * const backupKey = await backup.createBackup('Pre-migration backup');
 *
 * // If migration fails, restore
 * const restored = await backup.restoreFromBackup(backupKey);
 *
 * // List available backups
 * const backups = backup.listBackups();
 * ```
 */
export class BackupService {
    private static instance: BackupService;
    private writeQueue: WriteQueue;

    /** Maximum number of backups to retain */
    private maxBackups = 10;

    private constructor() {
        this.writeQueue = WriteQueue.getInstance();
    }

    /**
     * Get the singleton BackupService instance.
     */
    static getInstance(): BackupService {
        if (!BackupService.instance) {
            BackupService.instance = new BackupService();
        }
        return BackupService.instance;
    }

    /**
     * Reset the singleton instance (for testing only).
     * @internal
     */
    static resetInstance(): void {
        BackupService.instance = undefined as unknown as BackupService;
    }

    /**
     * Create a backup of all storage data.
     *
     * @param description - Optional description for the backup
     * @returns The backup key (use this to restore)
     */
    async createBackup(description?: string): Promise<string> {
        return this.writeQueue.enqueue(async () => {
            const timestamp = new Date().toISOString();
            const backupKey = `${STORAGE_KEYS.BACKUP_PREFIX}${timestamp}`;

            const backupData: BackupData = {
                meta: {
                    timestamp,
                    schemaVersion: CURRENT_SCHEMA_VERSION,
                    description,
                },
                data: {
                    logs: localStorage.getItem(STORAGE_KEYS.LOGS),
                    profile: localStorage.getItem(STORAGE_KEYS.PROFILE),
                    tasks: localStorage.getItem(STORAGE_KEYS.TASKS),
                },
            };

            localStorage.setItem(backupKey, JSON.stringify(backupData));

            console.info('[BackupService] Created backup:', backupKey);

            // Cleanup old backups if exceeding limit
            await this.cleanupOldBackups();

            return backupKey;
        });
    }

    /**
     * Restore storage from a backup.
     *
     * @param backupKey - The backup key to restore from
     * @returns True if restoration succeeded, false otherwise
     */
    async restoreFromBackup(backupKey: string): Promise<boolean> {
        return this.writeQueue.enqueue(async () => {
            try {
                const backupRaw = localStorage.getItem(backupKey);

                if (!backupRaw) {
                    console.error('[BackupService] Backup not found:', backupKey);
                    return false;
                }

                const backup: BackupData = JSON.parse(backupRaw);

                // Validate backup structure
                if (!backup.meta || !backup.data) {
                    console.error('[BackupService] Invalid backup structure');
                    return false;
                }

                // Warn about version mismatch but don't block
                if (backup.meta.schemaVersion !== CURRENT_SCHEMA_VERSION) {
                    console.warn(
                        '[BackupService] Restoring backup from different schema version:',
                        {
                            backup: backup.meta.schemaVersion,
                            current: CURRENT_SCHEMA_VERSION,
                        }
                    );
                }

                // Restore each storage key
                if (backup.data.logs !== null) {
                    localStorage.setItem(STORAGE_KEYS.LOGS, backup.data.logs);
                } else {
                    localStorage.removeItem(STORAGE_KEYS.LOGS);
                }

                if (backup.data.profile !== null) {
                    localStorage.setItem(STORAGE_KEYS.PROFILE, backup.data.profile);
                } else {
                    localStorage.removeItem(STORAGE_KEYS.PROFILE);
                }

                if (backup.data.tasks !== null) {
                    localStorage.setItem(STORAGE_KEYS.TASKS, backup.data.tasks);
                } else {
                    localStorage.removeItem(STORAGE_KEYS.TASKS);
                }

                console.info('[BackupService] Restored from backup:', backupKey);
                return true;
            } catch (error) {
                console.error('[BackupService] Restore failed:', error);
                return false;
            }
        });
    }

    /**
     * List all available backups with metadata.
     *
     * @returns Array of backup metadata, sorted by timestamp (newest first)
     */
    listBackups(): BackupMetadata[] {
        const backups: BackupMetadata[] = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(STORAGE_KEYS.BACKUP_PREFIX)) {
                try {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;

                    const backup: BackupData = JSON.parse(raw);

                    backups.push({
                        key,
                        timestamp: backup.meta.timestamp,
                        schemaVersion: backup.meta.schemaVersion,
                        description: backup.meta.description,
                        size: raw.length,
                    });
                } catch {
                    // Corrupted backup, skip but log
                    console.warn('[BackupService] Corrupted backup found:', key);
                }
            }
        }

        // Sort by timestamp, newest first
        backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        return backups;
    }

    /**
     * Delete a specific backup.
     *
     * @param backupKey - The backup key to delete
     * @returns True if deletion succeeded
     */
    async deleteBackup(backupKey: string): Promise<boolean> {
        return this.writeQueue.enqueue(async () => {
            if (!backupKey.startsWith(STORAGE_KEYS.BACKUP_PREFIX)) {
                console.error('[BackupService] Invalid backup key:', backupKey);
                return false;
            }

            localStorage.removeItem(backupKey);
            console.info('[BackupService] Deleted backup:', backupKey);
            return true;
        });
    }

    /**
     * Get the most recent backup key.
     *
     * @returns The most recent backup key or null if no backups exist
     */
    getLatestBackup(): string | null {
        const backups = this.listBackups();
        return backups.length > 0 ? backups[0].key : null;
    }

    /**
     * Remove old backups beyond the retention limit.
     */
    private async cleanupOldBackups(): Promise<void> {
        const backups = this.listBackups();

        if (backups.length <= this.maxBackups) {
            return;
        }

        // Delete oldest backups beyond limit
        const toDelete = backups.slice(this.maxBackups);

        for (const backup of toDelete) {
            localStorage.removeItem(backup.key);
            console.info('[BackupService] Cleaned up old backup:', backup.key);
        }
    }

    /**
     * Set the maximum number of backups to retain.
     *
     * @param max - Maximum number of backups
     */
    setMaxBackups(max: number): void {
        this.maxBackups = Math.max(1, max);
    }

    /**
     * Get total size of all backups in bytes.
     */
    getTotalBackupSize(): number {
        return this.listBackups().reduce((total, backup) => total + backup.size, 0);
    }

    /**
     * Export a backup as a downloadable blob.
     * Useful for user-initiated full exports.
     *
     * @param backupKey - The backup key to export
     * @returns Blob containing the backup data
     */
    exportBackup(backupKey: string): Blob | null {
        const raw = localStorage.getItem(backupKey);
        if (!raw) return null;

        return new Blob([raw], { type: 'application/json' });
    }

    /**
     * Import a backup from external data.
     *
     * @param data - JSON string of backup data
     * @param overwriteKey - Optional key to use (otherwise generates new)
     * @returns The backup key if successful, null otherwise
     */
    async importBackup(data: string, overwriteKey?: string): Promise<string | null> {
        return this.writeQueue.enqueue(async () => {
            try {
                // Validate JSON structure
                const parsed: BackupData = JSON.parse(data);

                if (!parsed.meta || !parsed.data) {
                    console.error('[BackupService] Invalid import data structure');
                    return null;
                }

                const key = overwriteKey ||
                    `${STORAGE_KEYS.BACKUP_PREFIX}imported_${new Date().toISOString()}`;

                localStorage.setItem(key, data);
                console.info('[BackupService] Imported backup:', key);

                return key;
            } catch (error) {
                console.error('[BackupService] Import failed:', error);
                return null;
            }
        });
    }
}
