// T-IGH-02-PAYLOADS: canonical payload schema for schedule.publish.
//
// Server handler is registered in PushSyncBatchHandler but currently returns
// MUTATION_TYPE_UNIMPLEMENTED — Sub-plan 03 will wire the real handler. No
// domain command record exists yet, so the schema below captures the minimum
// shape we expect any future implementation to share: the schedule template
// being published, the actor identity, and an optional client command id.
//
// `.passthrough()` keeps unknown fields rather than stripping them so the
// future handler doesn't have to coordinate a schema bump with every new
// field. Tighten this to `.strict()` once the wiring lands and the field
// list is final.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const SchedulePublishPayload = z
    .object({
        scheduleTemplateId: ZGuid,
        actorUserId: ZGuid,
        actorRole: z.string().optional(),
        clientCommandId: z.string().optional(),
    })
    .passthrough();

export type SchedulePublishPayloadType = z.infer<typeof SchedulePublishPayload>;
