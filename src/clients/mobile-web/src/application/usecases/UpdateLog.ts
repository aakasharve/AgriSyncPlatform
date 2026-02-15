
import { DailyLog, LogVerificationStatus } from '../../domain/types/log.types';
import { FarmerProfile } from '../../domain/types/farm.types';
import { PatchEvent } from '../../domain/ledger/PatchEvent';
import { LogsRepository } from '../ports';
import { AuthorizationPolicy } from '../policy/AuthorizationPolicy';
// import { AuditLogRepository } from '../../infrastructure/storage/AuditLogRepository'; // Deprecated Fix-07

interface UpdateLogRequest {
    logId: string;
    updatedData: Partial<DailyLog>;
    actorId: string;
    reason: string;
}

interface UpdateLogResponse {
    success: boolean;
    error?: string;
    log?: DailyLog;
}

/**
 * UpdateLog Use-Case
 * 
 * Handles secure updates to execution logs.
 * Enforces "Immutable Verification" rule:
 * - If log is APPROVED, create a PatchEvent and reset status to PENDING.
 * - Always audits the update.
 */
export const updateLog = async (
    request: UpdateLogRequest,
    repo: LogsRepository,
    // auditRepo deprecated (Fix-07)
    actorProfile: FarmerProfile
): Promise<UpdateLogResponse> => {
    try {
        // 1. Authorization
        if (!AuthorizationPolicy.can('EDIT_LOG', actorProfile)) {
            return { success: false, error: 'Permission denied: Cannot edit logs.' };
        }

        // 2. Fetch existing
        const existingLog = await repo.getById(request.logId);
        if (!existingLog) {
            return { success: false, error: 'Log not found.' };
        }

        // 3. Prepare Update Logic
        let finalLog: DailyLog = { ...existingLog, ...request.updatedData };

        // 4. Handle Verification Invariance
        if (existingLog.verification?.status === LogVerificationStatus.APPROVED ||
            existingLog.verification?.status === LogVerificationStatus.AUTO_APPROVED) {

            // Create SNAPSHOT (Patch)
            const patch: PatchEvent = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                actorId: request.actorId,
                reason: request.reason || 'Edit to verified log',
                previousState: {
                    date: existingLog.date,
                    weatherStamp: existingLog.weatherStamp,
                    cropActivities: existingLog.cropActivities,
                    irrigation: existingLog.irrigation,
                    labour: existingLog.labour,
                    inputs: existingLog.inputs,
                    machinery: existingLog.machinery,
                    activityExpenses: existingLog.activityExpenses,
                    observations: existingLog.observations,
                    plannedTasks: existingLog.plannedTasks,
                    disturbance: existingLog.disturbance,
                    verification: existingLog.verification
                }
            };

            // Reset Verification Status
            finalLog.verification = {
                status: LogVerificationStatus.PENDING,
                required: true,
                notes: 'Reset due to edit after verification.'
            };

            // Append Patch
            finalLog.patches = [...(existingLog.patches || []), patch];
        }

        // 5. Persist with Unified Audit (Fix-07)
        await repo.save(finalLog, {
            actorId: request.actorId,
            reason: request.reason,
            action: 'UPDATE_LOG'
        });

        return { success: true, log: finalLog };

    } catch (e: any) {
        console.error('UpdateLog Error:', e);
        return { success: false, error: e.message || 'Unknown error during update' };
    }
};
