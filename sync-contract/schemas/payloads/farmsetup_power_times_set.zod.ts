// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9)
//
// farmsetup.power_times.set - the farm's power timetable ("वीज कधी असते?"), written WHOLE, one document per farm (the screen edits and saves it whole).
// The values keep the phone's own codes (ElectricityTimingConfiguration in farm.types.ts). The server validates it before it is stored.
// A NEW name. `baseRevision`: 0 when the farm has no timetable yet, else the revision last received; stale is refused, never overwritten.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

const ZClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const PowerOffWindowSchema = z
    .object({
        id: z.string().min(1).max(64),
        startTime: ZClockTime,
        endTime: ZClockTime,
        repeatRule: z.enum(['DAILY', 'WEEKLY', 'ALTERNATE_WEEK']),
        days: z.array(z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])).max(7),
    })
    .strict();

export const PowerPhaseScheduleSchema = z
    .object({
        patternMode: z.enum(['FIXED_WEEKLY', 'CUSTOM_DAILY', 'ROTATIONAL']),
        alternateWeeklyPattern: z.boolean(),
        weekAOffWindows: z.array(PowerOffWindowSchema).max(12),
        weekBOffWindows: z.array(PowerOffWindowSchema).max(12).optional(),
    })
    .strict();

export const FarmsetupPowerTimesSetPayload = z
    .object({
        farmId: ZGuid,
        baseRevision: z.number().int().min(0),
        timetable: z
            .object({
                singlePhase: PowerPhaseScheduleSchema,
                threePhase: PowerPhaseScheduleSchema,
            })
            .strict(),
    })
    .strict();

export type FarmsetupPowerTimesSetPayloadType = z.infer<typeof FarmsetupPowerTimesSetPayload>;
