// T-IGH-02-PAYLOADS: canonical payload schema for migrate_schedule.
// Server handler: PushSyncBatchHandler (wired by lane L8b-1) — the schema mirrors the
// MigrateScheduleCommand domain record.
// reason values come from ShramSafal.Domain.Schedules.ScheduleMigrationReason.
import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

/** YYYY-MM-DD (DateOnly on the server, as create_crop_cycle's dates). */
const ZScheduleDay = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const ScheduleMigrationReasonSchema = z.enum([
    'BetterFit',
    'WeatherShift',
    'SwitchedCropVariety',
    'OwnerDirective',
    'Other',
]);

export const MigrateSchedulePayload = z.object({
    farmId: ZGuid,
    plotId: ZGuid,
    cropCycleId: ZGuid,
    newScheduleTemplateId: ZGuid,
    reason: ScheduleMigrationReasonSchema,
    actorUserId: ZGuid,
    reasonText: z.string().optional(),
    actorRole: z.string().optional(),
    clientCommandId: z.string().optional(),
    newSubscriptionId: ZGuid.optional(),
    migrationEventId: ZGuid.optional(),
    // spec: plr-d10 lane L8b-1 — the plot's day 0 set in "शेड्यूल बदला" (YYYY-MM-DD). Optional and additive: 1.0.17
    // never sends it, and the server then counts from the crop season's start (P11).
    referenceDate: ZScheduleDay.optional(),
    // spec: plr-d10 lane L8b-1 (founder D-73) — when the farmer made this change on the phone (ISO, with offset). Optional:
    // a change made offline while he held "plan work", arriving after it ended, counts inside the late window and is
    // flagged for the owner (MU design §11.2). Without it only "held now" counts (P11: 1.0.17 sends none).
    decidedAtUtc: ZIsoDate.optional(),
});

export type MigrateSchedulePayloadType = z.infer<typeof MigrateSchedulePayload>;
