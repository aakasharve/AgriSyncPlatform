import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.JobCardIdMutationPayload (used for
// both jobcard.start and jobcard.cancel-without-reason in earlier
// drafts; jobcard.cancel now requires a reason).
export const JobcardStartPayload = z.object({
  jobCardId: ZGuid,
});

export type JobcardStartPayloadType = z.infer<typeof JobcardStartPayload>;
