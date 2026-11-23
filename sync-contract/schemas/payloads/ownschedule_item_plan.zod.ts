// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// ownschedule.item.plan - "plan", then who, on ONE work of the plot-season's own schedule: the farmer's SECOND act (saving a work makes no plan). A NEW name, not
// a new key on plannedwork.create (strict push rule: the old payloads stay as released). The server words the plan with the work's name, puts it on the work's
// plot, links it by the work's stable identity (crop season + task key, never a step id) and dates it when the schedule gives a due day; otherwise the plan
// WAITS. One open occurrence of a work at a time: an open plan of the work is the answer, whatever id is sent (two phones planning offline give one plan).
//
//   - `plannedWorkId`: minted on the phone (best: the UUIDv5 of the own item and the occurrence, so two phones mint the same id).
//   - `farmId`, `plotId`, `cropCycleId`, `taskKey`: the own work (its id is the UUIDv5 of the crop season and the key).
//   - `assigneeUserId`: absent (or the sender) = a reminder for himself; another person = work given to one accountable person.
//   - `note`: his words (optional). `recordedOn`: the farm-local day it was made (yyyy-MM-dd; the server's own day when absent).
import { z } from 'zod';
import { ScheduleKey } from '../schedule-task.zod';
import { ZGuid } from './_shared.zod';

const ZDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd');

export const OwnScheduleItemPlanPayload = z
    .object({
        plannedWorkId: ZGuid,
        farmId: ZGuid,
        plotId: ZGuid,
        cropCycleId: ZGuid,
        taskKey: ScheduleKey,
        assigneeUserId: ZGuid.optional(),
        note: z.string().max(1000).optional(),
        recordedOn: ZDay.optional(),
    })
    .strict();

export type OwnScheduleItemPlanPayloadType = z.infer<typeof OwnScheduleItemPlanPayload>;
