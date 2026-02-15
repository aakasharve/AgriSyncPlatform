
/**
 * AuditAction — all auditable actions in the system.
 * V2 adds CONFIRM_LOG, DISPUTE_LOG, CORRECT_LOG, MIGRATE_SCHEMA.
 */
export type AuditAction =
    | 'CREATE_LOG'
    | 'UPDATE_LOG'
    | 'DELETE_LOG'
    | 'VERIFY_LOG'
    | 'CONFIRM_LOG'     // DFES V2: operator confirms own log
    | 'DISPUTE_LOG'     // DFES V2: owner flags issue
    | 'CORRECT_LOG'     // DFES V2: operator corrects after dispute
    | 'MIGRATE_SCHEMA'; // DFES V2: schema migration event

export interface AuditEvent {
    id: string;
    timestamp: string;
    actorId: string;
    action: AuditAction;
    resourceId: string;
    details?: string;
    metadata?: Record<string, unknown>;
}

const STORAGE_KEY = 'agrilog_audit_v1';

/**
 * @deprecated Fix-07: Legacy Audit implementation.
 * Read-only access to legacy logs. New logs go to DexieLogsRepository.
 */
export class AuditLogRepository {
    private getAll(): AuditEvent[] {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.error("Failed to parse audit logs", e);
            return [];
        }
    }

    private saveAll(events: AuditEvent[]): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
        } catch (e) {
            console.error("Failed to save audit logs", e);
        }
    }

    /**
     * @deprecated Fix-07: Use LogsRepository.save(log, { ...audit }) instead.
     * This method is now a no-op to prevent split-brain audit logs.
     */
    async append(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
        console.warn('AuditLogRepository.append is deprecated. Use LogsRepository.save() with audit context.');
        // No-op
    }

    async getByResource(resourceId: string): Promise<AuditEvent[]> {
        const all = this.getAll();
        return all.filter(e => e.resourceId === resourceId);
    }
}

export const auditRepository = new AuditLogRepository();
