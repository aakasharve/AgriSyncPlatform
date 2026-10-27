/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * WHO CALLS THIS, AND WHAT IT SWITCHES ON (rewritten for PLR-D10 I13, 2026-10-26 — this header used to say,
 * in capitals, that nothing may call it; two things changed and one did not).
 *
 * 1. THE SERVER NOW ACCEPTS WHAT THIS QUEUES. `verify_log_v2` used to answer `MUTATION_TYPE_UNIMPLEMENTED`
 *    (permanent, so every row landed in `REJECTED_USER_REVIEW`). `PushSyncBatchHandler.HandleVerifyLogV2Async`
 *    (dfes wave-1.4) applies it now, through the pipeline-wrapped `VerifyLogHandler` (its authorizer runs
 *    `EnsureCanVerify` = `LabourManagementGate`: owner tier, or a member the owner granted labour rights), and
 *    `DailyLog.VerifyReachingTarget` walks Draft -> Confirmed -> Verified by the caller's own edges, so a
 *    single "approve" on a Draft log no longer fails.
 *
 * 2. THE CALLERS. The voice result screen's "पक्कं आहे" (`features/logs/components/voiceResult/
 *    useRecordingTrust.ts`), for a voice log the phone auto-saved as Draft (spec I13: his confirm IS the verify
 *    act), shown only to whoever the server lets verify and only for a log on its way to the server. The labour
 *    review sheet already sent verify into the same server handler.
 *
 * 3. UNCHANGED — "success" HERE MEANS "QUEUED", NOT "ACCEPTED". Both functions return success the moment
 *    `mutationQueue.enqueue` resolves. A caller may render HIS act off it ("तुम्ही पक्कं केलं"), never a server
 *    outcome it has not been told (spec §P-D, "No optimistic success").
 *
 * 4. UNCHANGED — THE MONEY HOOK. `VerifyLogHandler` runs `OnLogVerifiedAutoVerifyJobCard` on every successful
 *    Verified: a job card LINKED to the log moves `Completed -> VerifiedForPayout` (then `PaidOut`). A voice
 *    log confirmed on its result screen seconds after he spoke has no job card linked yet, so in practice this
 *    does not fire there; but a self-confirm of a log that IS linked would switch that payout step on. Whether a
 *    farmer's own confirm may do that is an OPEN founder decision (raised with I13), not settled by this file.
 *    (`application/usecases/sync/VerifyLogCommand.ts`, the v1 `verify_log`, reaches the same handler.)
 *
 * `getLogsNeedingVerification` below is a pure read and is unaffected by any of the above.
 */

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
