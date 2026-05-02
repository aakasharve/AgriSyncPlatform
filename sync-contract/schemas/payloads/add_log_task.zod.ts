// T-IGH-02-PAYLOADS: canonical payload schema for add_log_task.
// Mirrors the backend handler's AddLogTaskMutationPayload record.
// occurredAtUtc is an ISO datetime (DateTime?), not YYYY-MM-DD.
import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

export const AddLogTaskPayload = z.object({
    logTaskId: ZGuid.optional(),
    dailyLogId: ZGuid,
    activityType: z.string().min(1),
    notes: z.string().optional(),
    occurredAtUtc: ZIsoDate.optional(),
});

export type AddLogTaskPayloadType = z.infer<typeof AddLogTaskPayload>;
