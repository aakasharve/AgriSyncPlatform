// T-IGH-02-PAYLOADS: canonical payload schema for create_farm.
// Mirrors the backend handler's CreateFarmMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const CreateFarmPayload = z.object({
    farmId: ZGuid.optional(),
    name: z.string().min(1),
    ownerUserId: ZGuid.optional(),
});

export type CreateFarmPayloadType = z.infer<typeof CreateFarmPayload>;
