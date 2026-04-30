import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

export const VerifyLogV2Payload = z.object({
  logId: ZGuid,
  verifierUserId: ZGuid,
  decision: z.enum(['confirm', 'verify', 'dispute', 'request_correction']),
  reason: z.string().max(500).optional(),
  decidedAt: ZIsoDate,
});

export type VerifyLogV2PayloadType = z.infer<typeof VerifyLogV2Payload>;
