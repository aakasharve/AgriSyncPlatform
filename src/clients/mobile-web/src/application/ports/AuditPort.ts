/**
 * Audit Port
 *
 * Application layer contract for recording auditable events.
 * Infrastructure decides how/where these events are persisted.
 */

export type AuditAction =
    | 'CREATE_LOG'
    | 'UPDATE_LOG'
    | 'DELETE_LOG'
    | 'VERIFY_LOG'
    | 'CONFIRM_LOG'
    | 'DISPUTE_LOG'
    | 'CORRECT_LOG'
    | 'MIGRATE_SCHEMA';

export interface AuditEntry {
    actorId: string;
    action: AuditAction;
    resourceId: string;
    details?: string;
    metadata?: Record<string, unknown>;
}

export interface AuditPort {
    append(entry: AuditEntry): Promise<void>;
}

