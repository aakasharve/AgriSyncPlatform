// T-IGH-02-PAYLOADS: canonical payload schema for adopt_schedule.
// Server handler is registered in PushSyncBatchHandler but currently
// returns MUTATION_TYPE_UNIMPLEMENTED — the schema mirrors the
// AdoptScheduleCommand domain record so it's ready when wiring lands.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const AdoptSchedulePayload = z.object({
    farmId: ZGuid,
    plotId: ZGuid,
    cropCycleId: ZGuid,
    scheduleTemplateId: ZGuid,
    actorUserId: ZGuid,
    actorRole: z.string().optional(),
    clientCommandId: z.string().optional(),
    subscriptionId: ZGuid.optional(),
});

export type AdoptSchedulePayloadType = z.infer<typeof AdoptSchedulePayload>;
