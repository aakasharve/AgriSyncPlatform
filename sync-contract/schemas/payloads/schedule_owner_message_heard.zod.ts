// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
//
// schedule.owner_message.heard - the farmer played a message of the owner of a schedule his plot follows to its end, for the first time. Append-only and idempotent per
// (farm, plot, message): a second play or a re-sent row writes nothing. "Heard" is its own count, never "done". It changes nothing else (a message changes nothing by itself).
// A NEW name (strict push rule: no key is added to an old payload).
//
//   - `farmId`, `plotId`: the plot that heard it.
//   - `messageId`: the owner's message (tip, change or look).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const ScheduleOwnerMessageHeardPayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        messageId: ZGuid,
    })
    .strict();

export type ScheduleOwnerMessageHeardPayloadType = z.infer<typeof ScheduleOwnerMessageHeardPayload>;
