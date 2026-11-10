// T-IGH-02-PAYLOADS: canonical payload schema for schedule.edit.
//
// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN (founder D-74, D-82 = 3; D7): the handler is WIRED (it answered
// MUTATION_TYPE_UNIMPLEMENTED before), on the same handler the REST route calls. The permissive `.passthrough()` is dropped: the server refuses a key
// it does not know, and no phone sent this mutation, then or now.
//
//   - `scheduleTemplateId`: the schedule (version) he is changing; `newScheduleTemplateId`: the NEXT version's own id, made on the phone (a re-sent
//     request is the same version; an id that already exists is refused, ShramSafal.ScheduleIdTaken.Conflict, permanent). The version before is
//     never rewritten (P3).
//   - `farmId`: required for a Team / Licensed schedule, and for the farm's own schedule it must be THE farm that schedule belongs to.
//   - `newName` / `newStage`: the old edit (a rename). With neither `stages` nor `activities` this is all it does.
//   - `stages` (+ `activities`): the next version WRITTEN WHOLE, as sent: exactly these stages and exactly these works; a work left out is gone, none is
//     carried over silently. `activities` without `stages` is refused. Every day rule is the import's (ShramSafal.ScheduleImport*).
//     `part` is irrigation | nutrition | spray | work; `frequencyMode` one_time | every_n_days | per_week (`intervalDays` = every N days, or times a week).
//     `operationKey` is WORK-ID's op_* key when the phone knows it; otherwise the server proposes one from the name.
//   - `actorUserId` / `actorRole` are kept for the phones that send them and read by nobody: the actor is the authenticated person.
import { z } from 'zod';
import { ZClimate, ZRegion, ZSoilType, ZVariety } from './_madeFor.zod';
import { ZGuid } from './_shared.zod';

export const EditScheduleStageItem = z
    .object({
        name: z.string().min(1).max(80),
        startDay: z.number().int().min(0).max(3650),
        endDay: z.number().int().min(0).max(3650),
    })
    .strict();

export const EditScheduleActivityItem = z
    .object({
        name: z.string().min(1).max(120),
        part: z.enum(['irrigation', 'nutrition', 'spray', 'work']),
        // op_ + lower case, at most 40: the width of the column (fix round 1, M002). The server refuses the same shape.
        operationKey: z
            .string()
            .min(1)
            .max(40)
            .regex(/^op_[a-z0-9_]+$/)
            .optional(),
        startDay: z.number().int().min(0).max(3650),
        endDay: z.number().int().min(0).max(3650),
        frequencyMode: z.enum(['one_time', 'every_n_days', 'per_week']),
        intervalDays: z.number().int().min(1).max(3650),
    })
    .strict();

// `.strict()`: a key the server does not know is refused by its allow-list, so the contract refuses it too (fix round 1, M005).
// spec: plr-d10 lane SCH-OWN-c (founder D-137, Q10 = 1): `variety` / `soilType` / `region` / `climate` - the made-for TAGS of the version written WHOLE,
// as sent (absent = none; the version before keeps its own, P3). Only with `stages`: a rename carries the tags before it and never rewrites them (the
// server refuses a tag without `stages`). List codes from ../schedule-made-for.json (PROPOSED); the variety is checked per crop by the server. Tags only:
// never a refusal of a follow.
export const EditSchedulePayload = z
    .object({
        scheduleTemplateId: ZGuid,
        newScheduleTemplateId: ZGuid,
        actorUserId: ZGuid,
        actorRole: z.string().optional(),
        clientCommandId: z.string().optional(),
        newName: z.string().min(1).max(120).optional(),
        newStage: z.string().min(1).max(80).optional(),
        farmId: ZGuid.optional(),
        stages: z.array(EditScheduleStageItem).min(1).max(40).optional(),
        activities: z.array(EditScheduleActivityItem).max(300).optional(),
        variety: ZVariety.optional(),
        soilType: ZSoilType.optional(),
        region: ZRegion.optional(),
        climate: ZClimate.optional(),
    })
    .strict();

export type EditSchedulePayloadType = z.infer<typeof EditSchedulePayload>;
