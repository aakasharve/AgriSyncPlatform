import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

export const VerifyLogV2Payload = z.object({
  logId: ZGuid,
  verifierUserId: ZGuid,
  decision: z.enum(['confirm', 'verify', 'dispute', 'request_correction']),
  reason: z.string().max(500).optional(),
  decidedAt: ZIsoDate,
  // spec: plr-d10-redesign-real-integration-2026-10-25 (I27), founder D-44 / D-46 — how the
  // confirmer reviewed it ('heard' = he played the original voice, 'read' = he confirmed from
  // the text) and which version of the record he saw. Both OPTIONAL: absent = not stated, which
  // is what every older client sends (P11). A version that no longer matches the record is
  // refused (ShramSafal.LogVersion.Conflict) so a changed record is seen before it is confirmed.
  // RELEASE GATE: an older server refuses unknown keys, so the server ships first.
  reviewBasis: z.enum(['heard', 'read']).optional(),
  logVersion: z.number().int().min(1).optional(),
});

export type VerifyLogV2PayloadType = z.infer<typeof VerifyLogV2Payload>;
