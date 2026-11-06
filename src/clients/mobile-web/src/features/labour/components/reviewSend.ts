/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The review sheet's ONE write (moved out of `ReviewSheet.tsx` unchanged in lane L4b, for the 800-line gate). Every
 * door of the one approval path (spec plr-d10 I28; founder D-3) ends here, and here ends in the server's one
 * `VerifyLogHandler`:
 *
 *  - मंजूर with its D-44 basis and D-46 version → ONE `verify_log_v2` (decision `verify`; the server walks Draft
 *    itself and refuses a version that moved on with `ShramSafal.LogVersion.Conflict`);
 *  - शंका (needs his reason, D-40 §3), or a मंजूर with no evidence (no session) → `verify_log`: Draft→Confirmed first
 *    when needed (`VerificationStateMachine` has no one-hop Draft→Verified/Disputed), then the target.
 *
 * `BackgroundSyncWorker.pushPendingMutations` sends every pending row in insertion order in one `/sync/push`, and the
 * server applies them one transaction each, so the Confirmed step is durable before the next is judged.
 */
import { VerifyLogCommand, type OwnerConfirmEvidence } from '../../../application/usecases/sync/VerifyLogCommand';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import type { ReviewVerificationStatus } from '../labour.types';

export async function triggerSyncBestEffort(): Promise<void> {
    try {
        await backgroundSyncWorker.triggerNow();
    } catch {
        // Queue persistence is the durable path; the periodic worker retries regardless.
    }
}

/** Enqueues the transition(s) to `finalStatus` WITHOUT triggering a push (a bulk batch triggers once). */
export async function enqueueVerificationSteps(
    dailyLogId: string,
    currentStatus: ReviewVerificationStatus | undefined,
    finalStatus: 'verified' | 'disputed',
    reason?: string,
    evidence?: OwnerConfirmEvidence
): Promise<void> {
    if (finalStatus === 'verified' && evidence) {
        await VerifyLogCommand.enqueueOwnerConfirmation(dailyLogId, evidence);
        return;
    }
    const canGoDirectly = currentStatus === 'Confirmed' || currentStatus === 'Verified';
    if (!canGoDirectly) {
        await VerifyLogCommand.enqueue({ dailyLogId, verificationStatus: 'confirmed' });
    }
    await VerifyLogCommand.enqueue({ dailyLogId, verificationStatus: finalStatus, reason });
}

/** Enqueue, then ONE best-effort push. Callers always pass through the sheet's confirm + undo window first. */
export async function sendVerification(
    dailyLogId: string,
    currentStatus: ReviewVerificationStatus | undefined,
    finalStatus: 'verified' | 'disputed',
    reason?: string,
    evidence?: OwnerConfirmEvidence
): Promise<void> {
    await enqueueVerificationSteps(dailyLogId, currentStatus, finalStatus, reason, evidence);
    await triggerSyncBestEffort();
}
