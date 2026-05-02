
import { LogsRepository } from '../ports';
import { FarmerProfile } from '../../domain/types/farm.types';
import { SoftDeletePolicy } from '../policies/SoftDeletePolicy';
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
    _actorProfile: FarmerProfile
): Promise<DeleteLogResponse> => {
    try {
        // 1. Fetch existing to check policy
        const existingLog = await repo.getById(request.logId);
        if (!existingLog) {
            return { success: false, error: 'Log not found.' };
        }

        // 2. Domain Policy Check
        if (!SoftDeletePolicy.canDelete(existingLog, request.actorId)) {
            return { success: false, error: 'Domain policy prevents deletion of this log.' };
        }

        // 3. Perform Delete (Repository handles soft-delete semantics)
        await repo.delete(request.logId, request.actorId, request.reason);

        // 4. Audit
        await auditPort.append({
            actorId: request.actorId,
            action: 'DELETE_LOG',
            resourceId: request.logId,
            details: `Deleted log. Reason: ${request.reason}`
        });

        return { success: true };

    } catch (e: unknown) {
        console.error('DeleteLog Error:', e);
        const message = e instanceof Error ? e.message : 'Unknown error during delete';
        return { success: false, error: message };
    }
};
