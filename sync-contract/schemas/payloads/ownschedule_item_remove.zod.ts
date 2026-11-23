// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main")
//
// ownschedule.item.remove - takes the work `taskKey` out of the plot-season's own schedule. Its row and every revision stay (P3); saving the key again brings it
// back. Removing a work that is already removed changes nothing and is applied. A key never saved on this season is refused (permanent).
import { z } from 'zod';
import { ScheduleKey } from '../schedule-task.zod';
import { ZGuid } from './_shared.zod';

export const OwnScheduleItemRemovePayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        cropCycleId: ZGuid,
        taskKey: ScheduleKey,
    })
    .strict();

export type OwnScheduleItemRemovePayloadType = z.infer<typeof OwnScheduleItemRemovePayload>;
