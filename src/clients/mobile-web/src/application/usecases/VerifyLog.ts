import { DailyLog, LogVerificationStatus, FarmerProfile } from '../../types';
import { LogsRepository } from '../ports';
import { AuditPort } from '../ports/AuditPort';
import { mutationQueue } from '../../infrastructure/sync/MutationQueue';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';
import { systemClock } from '../../core/domain/services/Clock';

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

// The canonical verify_log_v2 contract (sync-contract/schemas/payloads/verify_log_v2.zod.ts)
// is {logId, verifierUserId, decision, reason?, decidedAt}. Authority is
// NEVER read from the wire on the server: it derives the caller's role
// itself from the DB, and refuses any payload that tries to declare its
// own authority (e.g. a callerRole field). Do not add one back.
function mapDecision(action: VerifyLogInput['action']): 'verify' | 'dispute' {
    return action === 'approve' ? 'verify' : 'dispute';
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
    _profile: FarmerProfile
): Promise<VerifyResult> {
    try {
        const decision = mapDecision(input.action);
        await mutationQueue.enqueue(SyncMutationName.VerifyLogV2, {
            logId: input.logId,
            verifierUserId: input.verifierId,
            decision,
            reason: input.note,
            decidedAt: systemClock.nowISO(),
        });

        await auditPort.append({
            actorId: input.verifierId,
            action: 'VERIFY_LOG',
            resourceId: input.logId,
            details: `Queued verify_log_v2 mutation as ${decision}.`,
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
    _profile: FarmerProfile
): Promise<VerifyResult> {
    try {
        for (const logId of input.logIds) {
            await mutationQueue.enqueue(SyncMutationName.VerifyLogV2, {
                logId,
                verifierUserId: input.verifierId,
                decision: 'verify',
                decidedAt: systemClock.nowISO(),
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
