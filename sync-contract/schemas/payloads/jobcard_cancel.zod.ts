// T-IGH-02-PAYLOADS: canonical payload schema for jobcard.cancel.
// Mirrors the backend handler's JobCardCancelMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const JobCardCancelPayload = z.object({
    jobCardId: ZGuid,
    reason: z.string().min(1),
});

export type JobCardCancelPayloadType = z.infer<typeof JobCardCancelPayload>;
