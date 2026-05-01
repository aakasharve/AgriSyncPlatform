import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.JobCardCreateMutationPayload +
// JobCardLineItemDto. plannedDate is DateOnly on the wire.
const JobCardLineItem = z.object({
  activityType: z.string().min(1),
  expectedHours: z.number().nonnegative(),
  ratePerHourAmount: z.number().nonnegative(),
  ratePerHourCurrencyCode: z.string().min(1),
  notes: z.string().optional(),
});

export const JobcardCreatePayload = z.object({
  farmId: ZGuid,
  plotId: ZGuid,
  cropCycleId: ZGuid.optional(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd'),
  lineItems: z.array(JobCardLineItem).min(1),
});

export type JobcardCreatePayloadType = z.infer<typeof JobcardCreatePayload>;
