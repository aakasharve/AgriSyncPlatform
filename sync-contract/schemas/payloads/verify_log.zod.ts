// T-IGH-02-PAYLOADS: canonical payload schema for verify_log (deprecated;
// new clients should emit verify_log_v2 instead — but the legacy mutation
// is still in the catalog and accepted by the server).
// Mirrors the backend handler's VerifyLogMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const VerifyLogPayload = z.object({
    verificationEventId: ZGuid.optional(),
    dailyLogId: ZGuid,
    status: z.string().optional(),
    targetStatus: z.string().optional(),
    reason: z.string().optional(),
    verifiedByUserId: ZGuid.optional(),
});

export type VerifyLogPayloadType = z.infer<typeof VerifyLogPayload>;
