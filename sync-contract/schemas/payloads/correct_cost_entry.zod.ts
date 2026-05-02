// T-IGH-02-PAYLOADS: canonical payload schema for correct_cost_entry.
// Mirrors the backend handler's CorrectCostEntryMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const CorrectCostEntryPayload = z.object({
    financeCorrectionId: ZGuid.optional(),
    costEntryId: ZGuid,
    correctedAmount: z.number(),
    currencyCode: z.string().min(1),
    reason: z.string().min(1),
    correctedByUserId: ZGuid.optional(),
});

export type CorrectCostEntryPayloadType = z.infer<typeof CorrectCostEntryPayload>;
