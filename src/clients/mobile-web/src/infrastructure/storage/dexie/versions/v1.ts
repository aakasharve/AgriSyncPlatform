/**
 * Dexie schema v1 — initial 5 stores.
 *
 * Extracted from DexieDatabase.ts (Sub-plan 04 Task 9 file decomposition).
 * Schema string is byte-for-byte identical to the original `this.version(1).stores({...})` call.
 *
 * @module infrastructure/storage/dexie/versions/v1
 */

import type Dexie from 'dexie';

export function applyV1(db: Dexie): void {
    db.version(1).stores({
        // logs: primary key = id, indexes for common queries
        logs: 'id, date, verificationStatus, createdByOperatorId, isDeleted, [date+isDeleted], [createdByOperatorId+isDeleted]',

        // outbox: auto-increment id, indexes for sync processing
        outbox: '++id, idempotencyKey, status, action, [status+createdAt]',

        // auditEvents: primary key = id, indexes for lookups
        auditEvents: 'id, resourceId, action, timestamp, [resourceId+timestamp]',

        // syncCursors: primary key = tableName
        syncCursors: 'tableName',

        // appMeta: key-value store
        appMeta: 'key',
    });
}
