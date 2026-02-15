
import { LogsRepository } from '../ports';
import { FarmerProfile } from '../../domain/types/farm.types';
import { AuthorizationPolicy } from '../policy/AuthorizationPolicy';
import { SoftDeletePolicy } from '../../domain/ledger/SoftDeletePolicy';
import { AuditPort } from '../ports/AuditPort';

interface DeleteLogRequest {
    logId: string;
    actorId: string;
    reason: string;
}

interface DeleteLogResponse {
    success: boolean;
    error?: string;
}

/**
 * DeleteLog Use-Case
 * 
 * Handles secure deletion of logs.
 * Enforces Soft Delete policy and Audit requirements.
 */
export const deleteLog = async (
    request: DeleteLogRequest,
    repo: LogsRepository,
    auditPort: AuditPort,
    actorProfile: FarmerProfile
): Promise<DeleteLogResponse> => {
    try {
        // 1. Authorization
        if (!AuthorizationPolicy.can('DELETE_LOG', actorProfile)) {
            return { success: false, error: 'Permission denied: Cannot delete logs.' };
        }

        // 2. Fetch existing to check policy
        const existingLog = await repo.getById(request.logId);
        if (!existingLog) {
            return { success: false, error: 'Log not found.' };
        }

        // 3. Domain Policy Check
        if (!SoftDeletePolicy.canDelete(existingLog, request.actorId)) {
            return { success: false, error: 'Domain policy prevents deletion of this log.' };
        }

        // 4. Perform Delete (Repository handles Soft vs Hard implementation, but our policy says explicit soft delete logic is inside repo now)
        await repo.delete(request.logId, request.actorId, request.reason);

        // 5. Audit
        await auditPort.append({
            actorId: request.actorId,
            action: 'DELETE_LOG',
            resourceId: request.logId,
            details: `Deleted log. Reason: ${request.reason}`
        });

        return { success: true };

    } catch (e: any) {
        console.error('DeleteLog Error:', e);
        return { success: false, error: e.message || 'Unknown error during delete' };
    }
};
