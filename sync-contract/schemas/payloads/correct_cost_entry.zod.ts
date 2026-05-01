import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.CorrectCostEntryMutationPayload.
// PayloadHasOnly allow-list: financeCorrectionId, costEntryId,
// correctedAmount, currencyCode, reason, correctedByUserId.
// Amount is decimal on the wire, currencyCode is a separate ISO string —
// not paise-denominated, so kept as primitive number+string rather than
// ZMoneyMinor.
export const CorrectCostEntryPayload = z.object({
  financeCorrectionId: ZGuid.optional(),
  costEntryId: ZGuid,
  correctedAmount: z.number(),
  currencyCode: z.string().min(1),
  reason: z.string().min(1),
  correctedByUserId: ZGuid.optional(),
});

export type CorrectCostEntryPayloadType = z.infer<typeof CorrectCostEntryPayload>;
