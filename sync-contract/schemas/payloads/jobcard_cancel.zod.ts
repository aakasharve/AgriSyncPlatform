// T-IGH-02-PAYLOADS: canonical payload schema for jobcard.cancel.
// Mirrors the backend handler's JobCardCancelMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const JobcardCancelPayload = z.object({
    jobCardId: ZGuid,
    reason: z.string().min(1),
});

export type JobcardCancelPayloadType = z.infer<typeof JobcardCancelPayload>;
