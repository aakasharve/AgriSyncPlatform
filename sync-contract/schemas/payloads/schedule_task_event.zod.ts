// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// schedule.task_event - an answer about the sign of ONE "when seen" work of the plot-season's own schedule: `seen` (दिसलं), `not_yet` (अजून नाही) or `unsure`
// (खात्री नाही). Append-only: a later answer never edits an earlier one; the LATEST of seen / not_yet decides, and unsure moves nothing. A sign seen moves the
// plans that wait on it to the day it was seen and keeps the day it was expected; it is never "done".
//
//   - `eventId`: minted on the phone: a re-sent answer is the same answer.
//   - `farmId`, `plotId`, `cropCycleId`, `taskKey`: the own work (never a step id).
//   - `observedOn`: the farm-local day the sign was looked at (yyyy-MM-dd; the server's own day when absent; never after tomorrow).
import { z } from 'zod';
import { ScheduleKey } from '../schedule-task.zod';
import { ZGuid } from './_shared.zod';

const ZDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd');

export const ScheduleSignAnswerEnum = z.enum(['seen', 'not_yet', 'unsure']);

export const ScheduleTaskEventPayload = z
    .object({
        eventId: ZGuid,
        farmId: ZGuid,
        plotId: ZGuid,
        cropCycleId: ZGuid,
        taskKey: ScheduleKey,
        answer: ScheduleSignAnswerEnum,
        observedOn: ZDay.optional(),
    })
    .strict();

export type ScheduleTaskEventPayloadType = z.infer<typeof ScheduleTaskEventPayload>;
