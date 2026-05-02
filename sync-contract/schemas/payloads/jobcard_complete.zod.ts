// T-IGH-02-PAYLOADS: canonical payload schema for jobcard.complete.
// Mirrors the backend handler's JobCardCompleteMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const JobCardCompletePayload = z.object({
    jobCardId: ZGuid,
    dailyLogId: ZGuid,
});

export type JobCardCompletePayloadType = z.infer<typeof JobCardCompletePayload>;
