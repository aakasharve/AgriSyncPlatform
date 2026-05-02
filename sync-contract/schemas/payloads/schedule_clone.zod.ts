// T-IGH-02-PAYLOADS: canonical payload schema for schedule.clone.
// Server handler returns MUTATION_TYPE_UNIMPLEMENTED today — see header
// comment in schedule_publish.zod.ts for the rationale behind the
// permissive (passthrough) shape.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const ScheduleClonePayload = z
    .object({
        sourceScheduleTemplateId: ZGuid,
        actorUserId: ZGuid,
        actorRole: z.string().optional(),
        clientCommandId: z.string().optional(),
    })
    .passthrough();

export type ScheduleClonePayloadType = z.infer<typeof ScheduleClonePayload>;
