/**
 * VerifyLog Use-Case
 *
 * Orchestrates the verification of DailyLog entries.
 * Verification is part of the DFES Trust Layer.
 *
 * Verification flow:
 * - PENDING: Log created, awaiting verification
 * - APPROVED: Verified by owner/mukadam
 * - DISPUTED: Flagged for review
 *
 * Responsibilities:
 * - Validate verifier has permission
 * - Update verification status
 * - Record verification metadata
 * - Emit events for UI updates
 */

import { DailyLog, LogVerificationStatus, FarmerProfile } from '../../types';
import { LogsRepository } from '../ports';
import { AuthorizationPolicy } from '../policy/AuthorizationPolicy';
import { AuditPort } from '../ports/AuditPort';

/**
 * Input for verifying a single log.
 */
export interface VerifyLogInput {
    logId: string;
    verifierId: string;
    action: 'approve' | 'dispute';
    note?: string;
}

/**
 * Input for batch verification.
 */
export interface BatchVerifyInput {
    logIds: string[];
    verifierId: string;
    action: 'approve';
}

/**
 * Result of verification operation.
 */
export interface VerifyResult {
    success: boolean;
    error?: string;
}

/**
 * Check if an operator can verify logs.
 * @deprecated Use AuthorizationPolicy.can('VERIFY_LOG', ...)
 */
function canVerify(profile: FarmerProfile): boolean {
    return AuthorizationPolicy.can('VERIFY_LOG', profile);
}

/**
 * Use-case for verifying a single log.
 */
export async function verifyLog(
    input: VerifyLogInput,
    repository: LogsRepository,
    auditPort: AuditPort,
    profile: FarmerProfile
): Promise<VerifyResult> {
    try {
        // 1. Check permission
        if (!canVerify(profile)) {
            return {
                success: false,
                error: 'Current operator does not have verification permission'
            };
        }

        // 2. Determine new status
        const newStatus = input.action === 'approve'
            ? LogVerificationStatus.APPROVED
            : LogVerificationStatus.DISPUTED;

        // 3. Update in repository
        await repository.updateVerification(input.logId, newStatus, input.verifierId);

        // 4. Audit
        await auditPort.append({
            actorId: input.verifierId,
            action: 'VERIFY_LOG',
            resourceId: input.logId,
            details: `Status changed to ${newStatus}. Note: ${input.note || ''}`
        });

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error verifying log'
        };
    }
}

/**
 * Use-case for batch verification (approve multiple logs at once).
 */
export async function batchVerifyLogs(
    input: BatchVerifyInput,
    repository: LogsRepository,
    auditPort: AuditPort,
    profile: FarmerProfile
): Promise<VerifyResult> {
    try {
        // 1. Check permission
        if (!canVerify(profile)) {
            return {
                success: false,
                error: 'Current operator does not have verification permission'
            };
        }

        // 2. Update all logs (with Audit)
        await Promise.all(
            input.logIds.map(async id => {
                await repository.updateVerification(id, LogVerificationStatus.APPROVED, input.verifierId);
                await auditPort.append({
                    actorId: input.verifierId,
                    action: 'VERIFY_LOG',
                    resourceId: id,
                    details: 'Batch approved'
                });
            })
        );

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error in batch verification'
        };
    }
}

/**
 * Get logs that need verification (pending, created by others).
 */
export async function getLogsNeedingVerification(
    repository: LogsRepository,
    currentOperatorId: string
): Promise<DailyLog[]> {
    const allLogs = await repository.getAll();

    return allLogs.filter(log => {
        // Created by someone else
        const createdByOther = log.meta?.createdByOperatorId !== currentOperatorId;
        // Still pending
        const isPending = !log.verification ||
            log.verification.status === LogVerificationStatus.PENDING;

        return createdByOther && isPending;
    });
}
