// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
//
// schedule.owner_message.decide - the farmer's decision on a CHANGE message of the owner of a schedule his plot follows. An owner's message never changes the farmer's
// schedule or a job already given by itself: only this decision does, and only for the own-schedule gate holding the planning permission (a worker is refused).
//   - `accept`: for a work in his own schedule, a new revision of his own work with the new content (its origin never changes), then the job made from it if one is
//     open (its trail restarts and the clip travels with it). For a work only followed, the server takes the NEW one into his own schedule (no plan).
//   - `keep_old`: the decision is written and nothing else changes.
//   - `take_back`: after an accept, the revision before and the job are restored; history is kept.
// Append-only: a later decision never edits an earlier one. A NEW name (strict push rule: no key is added to an old payload).
//
//   - `farmId`, `plotId`, `cropCycleId`: the plot-season the decision is about.
//   - `messageId`: the change message.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const ScheduleOwnerDecisionEnum = z.enum(['accept', 'keep_old', 'take_back']);

export const ScheduleOwnerMessageDecidePayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        cropCycleId: ZGuid,
        messageId: ZGuid,
        decision: ScheduleOwnerDecisionEnum,
    })
    .strict();

export type ScheduleOwnerMessageDecidePayloadType = z.infer<typeof ScheduleOwnerMessageDecidePayload>;
