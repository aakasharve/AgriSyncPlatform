// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main")
//
// ownschedule.make_main - "हेच मुख्य करा", the ONLY act that makes the farmer's own schedule main (SM-6). In ONE transaction the server freezes a version from the
// season's works, writes its day works as stored activities for old phones, switches the plot's own place to it and carries the reminders he moved.
//
//   - `name`: optional; absent = the name of the version the plot follows from these works (a first one is called "माझे वेळापत्रक").
//   - `stageLine`: optional; absent = the stages of that version. A first make-main needs it. Days are STORED days (shown day 1 = stored 0; a stage starts on
//     stored day 0 or later), LISTED IN DAY ORDER (the server refuses another order). `endSign`: the stage ends on a sign, and `endDay` is then the EXPECTED
//     end - the stage stays open until its sign. A work's `stageIndex` names a stage by its place in this day-ordered list, the same in every version.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Plain strings (no refine), so the generated C# record keeps their types; the server refuses a blank one and a stage that ends before it starts.
export const OwnScheduleStageLineItem = z
    .object({
        name: z.string().min(1).max(80),
        startDay: z.number().int().min(0).max(3650),
        endDay: z.number().int().min(0).max(3650),
        startSign: z.string().min(1).max(160).optional(),
        endSign: z.string().min(1).max(160).optional(),
    })
    .strict();

export const OwnScheduleMakeMainPayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        cropCycleId: ZGuid,
        name: z.string().min(1).max(120).optional(),
        stageLine: z.array(OwnScheduleStageLineItem).min(1).max(40).optional(),
    })
    .strict();

export type OwnScheduleMakeMainPayloadType = z.infer<typeof OwnScheduleMakeMainPayload>;
