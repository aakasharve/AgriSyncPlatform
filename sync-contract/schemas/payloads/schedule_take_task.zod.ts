// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9, "One take with origin kept"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// schedule.take_task - ONE tap ("माझ्या वेळापत्रकात घ्या") puts one work of a schedule the plot FOLLOWS into the farmer's OWN schedule, and keeps where it came from. It
// writes the own work and its origin, and NOTHING else: no plan, no assignee, and the main schedule is never changed ("plan", then who, is the farmer's second act:
// ownschedule.item.plan). A NEW name (strict push rule: no key is added to an old payload).
//
//   - `farmId`, `plotId`, `cropCycleId`: the plot-season the work goes into.
//   - `sourceVersionId`: the version of the schedule the work is taken from. The plot must follow it now, and it must not be withdrawn.
//   - `taskKey`: the work in that version (its key is also the key of the own work, so the same work taken from two schedules is ONE work).
//   - `dose`: when the work has several doses, the one the farmer picked (the dose as written in the source, a line of the work's own dose or its products).
import { z } from 'zod';
import { ScheduleKey } from '../schedule-task.zod';
import { ZGuid } from './_shared.zod';

export const ScheduleTakeTaskPayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        cropCycleId: ZGuid,
        sourceVersionId: ZGuid,
        taskKey: ScheduleKey,
        dose: z.string().min(1).max(2000).optional(),
    })
    .strict();

export type ScheduleTakeTaskPayloadType = z.infer<typeof ScheduleTakeTaskPayload>;
