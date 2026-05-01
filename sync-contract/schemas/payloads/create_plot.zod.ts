import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.CreatePlotMutationPayload.
// PayloadHasOnly allow-list: plotId, farmId, name, areaInAcres.
export const CreatePlotPayload = z.object({
  plotId: ZGuid.optional(),
  farmId: ZGuid,
  name: z.string().min(1),
  areaInAcres: z.number().positive(),
});

export type CreatePlotPayloadType = z.infer<typeof CreatePlotPayload>;
