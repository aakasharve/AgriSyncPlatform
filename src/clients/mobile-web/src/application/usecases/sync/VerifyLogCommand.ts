import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

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
}
