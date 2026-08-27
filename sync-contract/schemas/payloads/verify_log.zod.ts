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
    // NO `targetStatus`. It was permitted here while the server's
    // `PayloadHasOnly` allow-list refused it, and `PayloadHasOnly` rejects the
    // WHOLE mutation on any unknown key — so a producer trusting this schema
    // would have had its verification silently refused at the server. The only
    // thing preventing that was a prose comment in VerifyLogCommand.ts.
    // `targetStatus` is the HTTP verification DTO's field (dtos.ts) and the
    // verify_log_v2 vocabulary; it is not on the v1 sync wire.
    // Guarded by tests/allowlist-parity.test.ts.
    reason: z.string().optional(),
    verifiedByUserId: ZGuid.optional(),
});

export type VerifyLogPayloadType = z.infer<typeof VerifyLogPayload>;
