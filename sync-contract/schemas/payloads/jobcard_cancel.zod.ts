import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.JobCardCancelMutationPayload. The handler
// rejects empty/whitespace reasons.
export const JobcardCancelPayload = z.object({
  jobCardId: ZGuid,
  reason: z.string().min(1),
});

export type JobcardCancelPayloadType = z.infer<typeof JobcardCancelPayload>;
