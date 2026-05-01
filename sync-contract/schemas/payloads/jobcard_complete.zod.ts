import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.JobCardCompleteMutationPayload.
export const JobcardCompletePayload = z.object({
  jobCardId: ZGuid,
  dailyLogId: ZGuid,
});

export type JobcardCompletePayloadType = z.infer<typeof JobcardCompletePayload>;
