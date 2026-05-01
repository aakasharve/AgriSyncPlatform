import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.CreateCropCycleMutationPayload.
// PayloadHasOnly allow-list: cropCycleId, farmId, plotId, cropName, stage,
// startDate, endDate. Date fields are DateOnly on the server (yyyy-MM-dd).
export const CreateCropCyclePayload = z.object({
  cropCycleId: ZGuid.optional(),
  farmId: ZGuid,
  plotId: ZGuid,
  cropName: z.string().min(1),
  stage: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd')
    .optional(),
});

export type CreateCropCyclePayloadType = z.infer<typeof CreateCropCyclePayload>;
