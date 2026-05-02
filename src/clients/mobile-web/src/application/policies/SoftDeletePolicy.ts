
import { DailyLog, LogVerificationStatus } from '../../domain/types/log.types';

/**
 * SoftDeletePolicy
 *
 * Determines whether a log can be physically deleted or must be soft-deleted.
 *
 * Rule:
 * - If a log has EVER been verified (APPROVED), it is immutable and must be soft-deleted.
 * - If a log is purely local/draft/pending and never verified, it COULD be hard deleted (but we prefer soft).
 * - Currently, we enforce soft-delete for EVERYTHING to be safe.
 */
export class SoftDeletePolicy {

    /**
     * Check if a log must be preserved (soft-deleted).
     */
    static shouldSoftDelete(_log: DailyLog): boolean {
        // For now, ALWAYS soft delete to prevent data loss.
        // In the future, we might allow hard delete for 'draft' logs that were created < 1 hour ago.
        return true;
    }

    /**
     * Check if a specific actor is allowed to delete this log.
     * (This overlaps with AuthorizationPolicy, but this is domain-rule level)
     */
    static canDelete(log: DailyLog, _actorId: string): boolean {
        // Verification status check
        if (log.verification?.status === LogVerificationStatus.APPROVED) {
            // Even if allowed, it will be a soft delete.
            return true;
        }
        return true;
    }
}
