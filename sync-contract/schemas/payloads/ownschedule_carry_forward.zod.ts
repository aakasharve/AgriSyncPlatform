// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 3)
//
// ownschedule.carry_forward - at the end of a season ("हंगामाच्या शेवटी") the farmer's own schedule becomes next season's own schedule, asking once where the season's
// practice differed. It writes COPIES in the new season (own works, their origins, one answer row each) and NOTHING else: never the main schedule, a plan or a log.
// A NEW name (strict push rule: no key is added to an old payload).
//
//   - `farmId`, `plotId`: the plot. `fromCropCycleId` is the season that ended, `toCropCycleId` the next one (it must start later).
//   - `answers`: what the farmer said about each work he answered: `schedule` ("शेड्यूलप्रमाणे"), `mine` ("मी केलं तसं"), `skip` ("नको"). A work he did not answer is NOT
//     listed: the server carries it as written and says so (an unanswered question never refuses the save, P8).
//   - `planOnly`: work that was only planned and is no longer in the own schedule (a plan of a work he took out), which he picked: carried as it was written.
//     Plan-only work is never copied unless it is named here.
import { z } from 'zod';
import { ScheduleKey } from '../schedule-task.zod';
import { ZGuid } from './_shared.zod';

export const OwnScheduleCarryChoiceEnum = z.enum(['schedule', 'mine', 'skip']);

export const OwnScheduleCarryForwardPayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        fromCropCycleId: ZGuid,
        toCropCycleId: ZGuid,
        answers: z.array(z.object({ taskKey: ScheduleKey, choice: OwnScheduleCarryChoiceEnum }).strict()).max(200),
        planOnly: z.array(z.object({ taskKey: ScheduleKey }).strict()).max(200).optional(),
    })
    .strict();

export type OwnScheduleCarryForwardPayloadType = z.infer<typeof OwnScheduleCarryForwardPayload>;
