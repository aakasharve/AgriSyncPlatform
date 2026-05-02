// T-IGH-02-PAYLOADS: canonical payload schema for migrate_schedule.
// Server handler is registered in PushSyncBatchHandler but currently
// returns MUTATION_TYPE_UNIMPLEMENTED — the schema mirrors the
// MigrateScheduleCommand domain record so it's ready when wiring lands.
// reason values come from ShramSafal.Domain.Schedules.ScheduleMigrationReason.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

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
});

export type MigrateSchedulePayloadType = z.infer<typeof MigrateSchedulePayload>;
