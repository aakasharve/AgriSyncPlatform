import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.JobCardSettleMutationPayload. The handler
// requires actualPayoutAmount > 0 and a non-empty currency code.
export const JobcardSettlePayload = z.object({
  jobCardId: ZGuid,
  actualPayoutAmount: z.number().positive(),
  actualPayoutCurrencyCode: z.string().min(1),
  settlementNote: z.string().optional(),
});

export type JobcardSettlePayloadType = z.infer<typeof JobcardSettlePayload>;
