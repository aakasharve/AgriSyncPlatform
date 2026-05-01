import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.JobCardAssignMutationPayload.
export const JobcardAssignPayload = z.object({
  jobCardId: ZGuid,
  workerUserId: ZGuid,
});

export type JobcardAssignPayloadType = z.infer<typeof JobcardAssignPayload>;
