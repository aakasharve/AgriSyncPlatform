// T-IGH-02-PAYLOADS: canonical payload schema for jobcard.assign.
// Mirrors the backend handler's JobCardAssignMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const JobCardAssignPayload = z.object({
    jobCardId: ZGuid,
    workerUserId: ZGuid,
});

export type JobCardAssignPayloadType = z.infer<typeof JobCardAssignPayload>;
