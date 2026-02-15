import { AuditEntry, AuditPort } from '../../application/ports/AuditPort';
import { auditRepository } from '../storage/AuditLogRepository';

/**
 * Legacy adapter for audit writes.
 *
 * Note: underlying auditRepository.append is currently a no-op by design.
 * This adapter exists to enforce the application->port->infrastructure boundary.
 */
class LegacyAuditPort implements AuditPort {
    async append(entry: AuditEntry): Promise<void> {
        await auditRepository.append({
            actorId: entry.actorId,
            action: entry.action,
            resourceId: entry.resourceId,
            details: entry.details,
            metadata: entry.metadata
        });
    }
}

export const legacyAuditPort: AuditPort = new LegacyAuditPort();

