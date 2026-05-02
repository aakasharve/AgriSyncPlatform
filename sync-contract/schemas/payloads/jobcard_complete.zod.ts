// T-IGH-02-PAYLOADS: canonical payload schema for jobcard.complete.
// Mirrors the backend handler's JobCardCompleteMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const JobcardCompletePayload = z.object({
    jobCardId: ZGuid,
    dailyLogId: ZGuid,
});

export type JobcardCompletePayloadType = z.infer<typeof JobcardCompletePayload>;
