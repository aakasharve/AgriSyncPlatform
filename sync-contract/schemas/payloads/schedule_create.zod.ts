// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN (founder D-74, D-82 = 3): schedule.create - "start blank": make the farm's OWN
// schedule, empty, for a crop the farm grows. Queued like every other change, so it works with no internet; the server decides when it arrives.
//
//   - `scheduleTemplateId`: the schedule's own id, made on the phone: a re-sent request is the same schedule, and an id that already exists is
//     refused (ShramSafal.ScheduleIdTaken.Conflict, permanent), never overwritten.
//   - `farmId`: the farm it belongs to. The farm's owner, or an Active seat holding "पीक वेळापत्रकाचे नमुने" there, may make it (the server asks).
//   - `cropKey` (1..60): a crop ShramSafal knows and the farm grows (any season, past ones too), else ShramSafal.ScheduleCropNotOnFarm.
//   - `name` (1..120): his words for the schedule.
//   - spec: plr-d10 lane SCH-OWN-c (founder D-137, Q10 = 1): `variety` / `soilType` / `region` / `climate` - what it was MADE FOR, four optional TAGS
//     (list codes from ../schedule-made-for.json, PROPOSED; _madeFor.zod.ts). Tags only: the server never refuses a plot a schedule because of them.
//     The variety is checked per crop by the SERVER (the contract accepts the union of every crop's list); a code outside its list answers
//     ShramSafal.ScheduleMadeFor (permanent). Absent = none; null is not accepted (the phone omits the key).
//
// Who made it, when, and its version are the server's. There is no actor field on purpose: the sender is the authenticated person. Whose schedule
// it is (its OWNER) is the farm's owner, read by the server from the farm row (SCH-OWN-c, Q9 = 1) - never sent.
import { z } from 'zod';
import { ZClimate, ZRegion, ZSoilType, ZVariety } from './_madeFor.zod';
import { ZGuid } from './_shared.zod';

export const CreateSchedulePayload = z
    .object({
        scheduleTemplateId: ZGuid,
        farmId: ZGuid,
        cropKey: z.string().min(1).max(60),
        name: z.string().min(1).max(120),
        variety: ZVariety.optional(),
        soilType: ZSoilType.optional(),
        region: ZRegion.optional(),
        climate: ZClimate.optional(),
    })
    .strict();

export type CreateSchedulePayloadType = z.infer<typeof CreateSchedulePayload>;
