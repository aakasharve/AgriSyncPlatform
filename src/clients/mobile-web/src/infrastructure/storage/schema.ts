/**
 * Storage Schema Constants
 *
 * Central definition of schema versions and storage keys.
 * All storage implementations must reference these constants.
 *
 * @module infrastructure/storage/schema
 */

/**
 * Current schema version for stored records.
 * Increment when making breaking changes to data structure.
 *
 * Version History:
 * - v1: Initial versioned storage implementation (localStorage)
 * - v2: DFES MVP — new verification statuses, Dexie/IndexedDB migration
 */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Storage Namespace for data isolation.
 * - 'user': Real user data (persisted to standard keys)
 * - 'demo': Demo/Training data (persisted to demo_ prefixed keys)
 */
export type Namespace = 'user' | 'demo';

/**
 * Storage key constants for localStorage.
 * Using versioned keys allows safe migrations.
 */
export const STORAGE_KEYS = {
    /** Daily logs storage */
    LOGS: 'agrilog_logs_v1',

    /** Farmer profile storage */
    PROFILE: 'agrilog_profile_v1',

    /** Planned tasks storage */
    TASKS: 'agrilog_tasks_v1',

    /** Schema version metadata */
    SCHEMA_VERSION: 'agrilog_schema_version',

    /** Prefix for backup keys (append timestamp) */
    BACKUP_PREFIX: 'agrilog_backup_',

    /** Sync cursor for offline-first operations */
    SYNC_CURSOR: 'agrilog_sync_cursor_v1',

    /** Outbox for pending sync operations */
    SYNC_OUTBOX: 'agrilog_sync_outbox_v1',
} as const;

/**
 * Type for storage keys to ensure type safety
 */
export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
