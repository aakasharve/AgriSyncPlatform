import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Deprecated by verify_log_v2. Mirrors
// PushSyncBatchHandler.VerifyLogMutationPayload — accepts either `status`
// or `targetStatus` (the server's TryMapVerificationStatus normalizes
// both). All Guid fields except dailyLogId are optional on the wire
// (the server fills VerifiedByUserId from the auth context).
export const VerifyLogPayload = z.object({
  verificationEventId: ZGuid.optional(),
  dailyLogId: ZGuid,
  status: z.string().optional(),
  targetStatus: z.string().optional(),
  reason: z.string().optional(),
  verifiedByUserId: ZGuid.optional(),
});

export type VerifyLogPayloadType = z.infer<typeof VerifyLogPayload>;
