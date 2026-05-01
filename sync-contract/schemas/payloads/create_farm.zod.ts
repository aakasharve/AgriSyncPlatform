import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.CreateFarmMutationPayload
// (apps/ShramSafal/.../UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs).
// PayloadHasOnly allow-list: farmId, name, ownerUserId.
export const CreateFarmPayload = z.object({
  farmId: ZGuid.optional(),
  name: z.string().min(1),
  ownerUserId: ZGuid.optional(),
});

export type CreateFarmPayloadType = z.infer<typeof CreateFarmPayload>;
