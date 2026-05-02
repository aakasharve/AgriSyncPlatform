// T-IGH-02-PAYLOADS: canonical payload schema for plan.add.
// Server handler returns MUTATION_TYPE_UNIMPLEMENTED today — see header
// comment in schedule_publish.zod.ts for the rationale behind the
// permissive (passthrough) shape.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const AddPlannedPayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        cropCycleId: ZGuid,
        actorUserId: ZGuid,
        actorRole: z.string().optional(),
        clientCommandId: z.string().optional(),
    })
    .passthrough();

export type AddPlannedPayloadType = z.infer<typeof AddPlannedPayload>;
