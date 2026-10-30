import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { systemClock } from '../../../core/domain/services/Clock';

/**
 * PLR-D10 I27 (founder D-44 / D-46) — what an owner's confirmation records besides who and when: whether he heard the
 * original voice or read the text, and the record version he saw (absent = not known on this phone).
 */
export interface OwnerConfirmEvidence {
     verifierUserId: string;
     reviewBasis: 'heard' | 'read';
     logVersion?: number;
}

export interface VerifyLogPayload {
     dailyLogId: string;
     verificationStatus: 'confirmed' | 'verified' | 'disputed' | 'correction_pending';
     reason?: string;
}

/**
 * Wire status values the server's `TryMapVerificationStatus`
 * (`PushSyncBatchHandler.HandleVerifyLogAsync`) accepts on the `status`
 * field: either a direct `VerificationStatus` enum name, matched
 * case-insensitively ("Draft"/"Confirmed"/"Verified"/"Disputed"/
 * "CorrectionPending"), or one of its string aliases ("approved"->Confirmed,
 * "rejected"->Disputed, "pending"->CorrectionPending). `confirmed`/
 * `verified`/`disputed` already match the enum names case-insensitively;
 * `correction_pending` has no direct match (the enum has no underscore) so
 * it goes through the "pending" alias instead.
 */
const WIRE_STATUS: Record<VerifyLogPayload['verificationStatus'], string> = {
     confirmed: 'confirmed',
     verified: 'verified',
     disputed: 'disputed',
     correction_pending: 'pending',
};

export class VerifyLogCommand {
     /**
      * Enqueues a `verify_log` sync mutation (v1 — `verify_log_v2` is
      * catalog-listed but its server handler is not wired yet and returns
      * MUTATION_TYPE_UNIMPLEMENTED; clients must keep using v1 until that
      * changes).
      *
      * WIRE SHAPE (important): the server's `PayloadHasOnly` allow-list for
      * verify_log is exactly {verificationEventId, dailyLogId, status,
      * reason, verifiedByUserId} — `targetStatus` and `verificationStatus`
      * are NOT in it. Any extra property on the JSON payload makes the
      * WHOLE mutation get rejected ("verify_log payload contains
      * unsupported fields."), so the outgoing wire payload is built here
      * with the `status` key regardless of this method's own (more
      * descriptive) `verificationStatus` parameter name.
      */
     static async enqueue(payload: VerifyLogPayload): Promise<string> {
          const clientRequestId = idGenerator.generate();
          return mutationQueue.enqueue(
               SyncMutationName.VerifyLog,
               {
                    dailyLogId: payload.dailyLogId,
                    status: WIRE_STATUS[payload.verificationStatus],
                    reason: payload.reason,
               },
               { clientRequestId, clientCommandId: clientRequestId }
          );
     }

     /**
      * PLR-D10 I27 — the review sheet's मंजूर as ONE `verify_log_v2` (decision `verify`; the server walks a Draft
      * record itself), carrying the D-44 basis and the D-46 version. The server gives "मालकाकडून खात्री" only to the
      * primary owner or a member holding the owner's grant, never on his own record, and refuses a stale version
      * (`ShramSafal.LogVersion.Conflict`) so a changed record is seen before it is confirmed.
      */
     static async enqueueOwnerConfirmation(dailyLogId: string, evidence: OwnerConfirmEvidence): Promise<string> {
          const clientRequestId = idGenerator.generate();
          return mutationQueue.enqueue(
               SyncMutationName.VerifyLogV2,
               {
                    logId: dailyLogId,
                    verifierUserId: evidence.verifierUserId,
                    decision: 'verify',
                    decidedAt: systemClock.nowISO(),
                    reviewBasis: evidence.reviewBasis,
                    ...(typeof evidence.logVersion === 'number' && evidence.logVersion >= 1 && { logVersion: evidence.logVersion }),
               },
               { clientRequestId, clientCommandId: clientRequestId }
          );
     }
}
