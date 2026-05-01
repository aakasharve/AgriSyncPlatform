import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

// Mirrors PushSyncBatchHandler.AddLogTaskMutationPayload.
// PayloadHasOnly allow-list: logTaskId, dailyLogId, activityType, notes,
// occurredAtUtc.
export const AddLogTaskPayload = z.object({
  logTaskId: ZGuid.optional(),
  dailyLogId: ZGuid,
  activityType: z.string().min(1),
  notes: z.string().optional(),
  occurredAtUtc: ZIsoDate.optional(),
});

export type AddLogTaskPayloadType = z.infer<typeof AddLogTaskPayload>;
