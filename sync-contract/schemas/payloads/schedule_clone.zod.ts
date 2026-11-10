// T-IGH-02-PAYLOADS: canonical payload schema for schedule.clone.
//
// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN (founder D-74, D-82 = 3): the handler is WIRED (it answered
// MUTATION_TYPE_UNIMPLEMENTED before), on the same handler the REST route calls. The permissive `.passthrough()` is dropped: the server refuses a key
// it does not know, and no phone sent this mutation, then or now (so nothing in the field is affected).
//
//   - `sourceScheduleTemplateId`: the schedule to copy. A copy he may not see answers ShramSafal.ScheduleTemplateNotFound.
//   - `newScheduleTemplateId`: the copy's own id, made on the phone: a re-sent request is the same copy; an id that already exists is refused
//     (ShramSafal.ScheduleIdTaken.Conflict, permanent), never overwritten.
//   - `newScope` (default 'Private'): who may use the copy. 'Team' / 'Licensed' need the farm named and the scope's author rule.
//   - `reason` (default 'schedule.clone'): why he copied it.
//   - `farmId` + `intoFarmOwn: true`: copy a CHECKED schedule INTO the farm's own schedule ('Team' only): the copy names that farm and stores the
//     source's days, with no check (D-82 = 3). The farm's owner, or an Active seat holding "पीक वेळापत्रकाचे नमुने" there, may; the server asks.
//   - `actorUserId` / `actorRole` are kept for the phones that send them and read by nobody: the actor is the authenticated person.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// `.strict()`: a key the server does not know is refused by its allow-list, so the contract refuses it too (fix round 1, M005).
export const CloneSchedulePayload = z
    .object({
        sourceScheduleTemplateId: ZGuid,
        newScheduleTemplateId: ZGuid,
        actorUserId: ZGuid,
        actorRole: z.string().optional(),
        clientCommandId: z.string().optional(),
        newScope: z.enum(['Private', 'Team', 'Licensed']).optional(),
        reason: z.string().min(1).max(200).optional(),
        farmId: ZGuid.optional(),
        intoFarmOwn: z.boolean().optional(),
    })
    .strict();

export type CloneSchedulePayloadType = z.infer<typeof CloneSchedulePayload>;
