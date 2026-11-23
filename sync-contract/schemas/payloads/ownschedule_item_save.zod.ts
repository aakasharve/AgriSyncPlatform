// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// ownschedule.item.save - one work of a plot-season's OWN schedule, written WHOLE in the one task format (schedule-task.zod.ts). A NEW name (strict push:
// never a new key in an old payload); refused for a farm the schedule_mechanism switch is not on for.
//
//   - `farmId` / `plotId` / `cropCycleId`: the plot-season. The plot must be the farm's and the season the plot's (E4: the child is checked, not the parent alone).
//   - `task`: the work. Its `taskKey` names it: the first save of a key makes the work, every later save of the same key EDITS it (two phones that saved one key
//     offline make one work, never a refusal). Only key, name, kind, timing and basis are required (P9). The server refuses a key the format does not know.
//
// Saving a work never makes it main and never changes the main schedule or its stage line; after "हेच मुख्य करा" a save moves THAT plot to a new version.
// The owner of the work is the farm's owner, read from the farm row - never a field of this payload (there is none).
import { z } from 'zod';
import { ScheduleTaskContentSchema } from '../schedule-task.zod';
import { ZGuid } from './_shared.zod';

export const OwnScheduleItemSavePayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        cropCycleId: ZGuid,
        task: ScheduleTaskContentSchema.strict(),
    })
    .strict();

export type OwnScheduleItemSavePayloadType = z.infer<typeof OwnScheduleItemSavePayload>;
