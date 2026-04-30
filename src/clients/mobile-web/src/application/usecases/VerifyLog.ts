import { DailyLog, LogVerificationStatus, FarmerProfile } from '../../types';
import { LogsRepository } from '../ports';
import { AuditPort } from '../ports/AuditPort';
import { mutationQueue } from '../../infrastructure/sync/MutationQueue';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';

export interface VerifyLogInput {
    logId: string;
    verifierId: string;
    action: 'approve' | 'dispute';
    note?: string;
}

export interface BatchVerifyInput {
    logIds: string[];
    verifierId: string;
    action: 'approve';
}

export interface VerifyResult {
    success: boolean;
    error?: string;
}

function mapTargetStatus(action: VerifyLogInput['action']): 'Verified' | 'Disputed' {
    return action === 'approve' ? 'Verified' : 'Disputed';
}

function mapCallerRole(profile: FarmerProfile): 'PrimaryOwner' | 'SecondaryOwner' | 'Mukadam' | 'Worker' {
    const operator = profile.operators.find(item => item.id === profile.activeOperatorId);
    switch (operator?.role) {
        case 'PRIMARY_OWNER':
            return 'PrimaryOwner';
        case 'SECONDARY_OWNER':
            return 'SecondaryOwner';
        case 'MUKADAM':
            return 'Mukadam';
        default:
            return 'Worker';
    }
}

async function triggerSyncBestEffort(): Promise<void> {
    try {
        await backgroundSyncWorker.triggerNow();
    } catch {
        // Queue persistence is the durable path; sync retries are periodic.
    }
}

export async function verifyLog(
    input: VerifyLogInput,
    _repository: LogsRepository,
    auditPort: AuditPort,
    profile: FarmerProfile
): Promise<VerifyResult> {
    try {
        await mutationQueue.enqueue(SyncMutationName.VerifyLogV2, {
            dailyLogId: input.logId,
            targetStatus: mapTargetStatus(input.action),
            reason: input.note,
            verifiedByUserId: input.verifierId,
            callerRole: mapCallerRole(profile),
        });

        await auditPort.append({
            actorId: input.verifierId,
            action: 'VERIFY_LOG',
            resourceId: input.logId,
            details: `Queued verify_log_v2 mutation as ${mapTargetStatus(input.action)}.`,
        });

        await triggerSyncBestEffort();
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to queue verify mutation.',
        };
    }
}

export async function batchVerifyLogs(
    input: BatchVerifyInput,
    _repository: LogsRepository,
    auditPort: AuditPort,
    profile: FarmerProfile
): Promise<VerifyResult> {
    try {
        for (const logId of input.logIds) {
            await mutationQueue.enqueue(SyncMutationName.VerifyLogV2, {
                dailyLogId: logId,
                targetStatus: 'Verified',
                verifiedByUserId: input.verifierId,
                callerRole: mapCallerRole(profile),
            });

            await auditPort.append({
                actorId: input.verifierId,
                action: 'VERIFY_LOG',
                resourceId: logId,
                details: 'Queued batch verify_log_v2 mutation.',
            });
        }

        await triggerSyncBestEffort();
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to queue batch verify mutations.',
        };
    }
}

export async function getLogsNeedingVerification(
    repository: LogsRepository,
    currentOperatorId: string
): Promise<DailyLog[]> {
    const allLogs = await repository.getAll();

    return allLogs.filter(log => {
        const createdByOther = log.meta?.createdByOperatorId !== currentOperatorId;
        const status = log.verification?.status;

        const needsReview =
            !status
            || status === LogVerificationStatus.DRAFT
            || status === LogVerificationStatus.CONFIRMED
            || status === LogVerificationStatus.CORRECTION_PENDING
            || status === LogVerificationStatus.PENDING
            || status === LogVerificationStatus.AUTO_APPROVED;

        return createdByOther && needsReview;
    });
}
