// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
//
// schedule.owner_message.answer - the farmer's answer to a LOOK AND TELL message of the owner of a schedule his plot follows: one of its exactly two answers. The owner's
// follow-up clip plays after it on the phone. Append-only and idempotent per (farm, plot, message): the first answer is kept. It changes nothing else.
// A NEW name (strict push rule: no key is added to an old payload).
//
//   - `farmId`, `plotId`, `cropCycleId`: the plot-season that answered.
//   - `messageId`: the look message.
//   - `answer`: `first` or `second` of the message's two answers.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const ScheduleOwnerLookAnswerEnum = z.enum(['first', 'second']);

export const ScheduleOwnerMessageAnswerPayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        cropCycleId: ZGuid,
        messageId: ZGuid,
        answer: ScheduleOwnerLookAnswerEnum,
    })
    .strict();

export type ScheduleOwnerMessageAnswerPayloadType = z.infer<typeof ScheduleOwnerMessageAnswerPayload>;
