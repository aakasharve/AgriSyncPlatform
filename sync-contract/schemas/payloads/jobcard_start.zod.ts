// T-IGH-02-PAYLOADS: canonical payload schema for jobcard.start.
// Mirrors the backend handler's JobCardIdMutationPayload record
// (jobcard.start carries only the job-card identifier).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const JobcardStartPayload = z.object({
    jobCardId: ZGuid,
});

export type JobcardStartPayloadType = z.infer<typeof JobcardStartPayload>;
