// T-IGH-02-PAYLOADS: canonical payload schema for abandon_schedule.
// Server handler is registered in PushSyncBatchHandler but currently
// returns MUTATION_TYPE_UNIMPLEMENTED — the schema mirrors the
// AbandonScheduleCommand domain record so it's ready when wiring lands.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const AbandonSchedulePayload = z.object({
    farmId: ZGuid,
    plotId: ZGuid,
    cropCycleId: ZGuid,
    actorUserId: ZGuid,
    reasonText: z.string().optional(),
    actorRole: z.string().optional(),
    clientCommandId: z.string().optional(),
});

export type AbandonSchedulePayloadType = z.infer<typeof AbandonSchedulePayload>;
