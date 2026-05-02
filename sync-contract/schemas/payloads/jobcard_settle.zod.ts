// T-IGH-02-PAYLOADS: canonical payload schema for jobcard.settle.
// Mirrors the backend handler's JobCardSettleMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const JobcardSettlePayload = z.object({
    jobCardId: ZGuid,
    actualPayoutAmount: z.number(),
    actualPayoutCurrencyCode: z.string().min(1),
    settlementNote: z.string().optional(),
});

export type JobcardSettlePayloadType = z.infer<typeof JobcardSettlePayload>;
