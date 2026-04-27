/**
 * Infrastructure Storage Layer
 *
 * Provides versioned, atomic storage implementations for the application.
 *
 * Key components:
 * - LocalStorageLogsRepository: Implements LogsRepository port
 * - WriteQueue: Ensures single-writer semantics for all writes
 * - IntegrityChecker: Validates storage health on startup
 * - BackupService: Backup and restore capabilities
 *
 * Architecture:
 * - All writes go through WriteQueue (serialized, atomic)
 * - Schema versioning enables safe migrations
 * - IntegrityChecker runs on app startup
 * - BackupService enables recovery from corruption
 *
 * @module infrastructure/storage
 */

// Schema constants
export { CURRENT_SCHEMA_VERSION, STORAGE_KEYS } from './schema';
export type { StorageKey } from './schema';

// Write queue for atomicity
export { WriteQueue, enqueueWrite } from './WriteQueue';

// Integrity checking
export {
    IntegrityChecker,
    runStartupIntegrityCheck,
} from './IntegrityChecker';
export type {
    IntegrityCheckResult,
    IntegrityReport,
} from './IntegrityChecker';

// Backup and recovery
export { BackupService } from './BackupService';
export type { BackupMetadata } from './BackupService';

// Repository implementations
export { LocalStorageLogsRepository } from './LocalStorageLogsRepository';
export { DexieLogsRepository } from './DexieLogsRepository';

// Dexie database
export { getDatabase, resetDatabase, AgriLogDatabase } from './DexieDatabase';
export type {
    OutboxEvent,
    MutationQueueItem,
    MutationQueueStatus,
    AttachmentRecord,
    LocalAttachmentStatus,
    UploadQueueItem,
    UploadQueueStatus,
    SyncCursor,
    AppMetaEntry,
    FarmBoundaryCacheRecord,
    FarmCacheRecord,
    PlotAreaCacheRecord,
    PlotCacheRecord,
    DexieLogRecord,
} from './DexieDatabase';

// Migration
export { MigrationService } from './MigrationService';
export type { MigrationResult } from './MigrationService';
export { migrateLogV1ToV2, batchMigrateV1ToV2, toVerificationRecord } from './migrations/v1ToV2';
