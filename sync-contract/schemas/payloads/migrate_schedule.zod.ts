import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors MigrateScheduleCommand (Schedules/MigrateSchedule/MigrateScheduleCommand.cs).
// Sync handler not yet wired (Sub-plan 03). reason is the
// ScheduleMigrationReason enum.
export const MigrateSchedulePayload = z.object({
  farmId: ZGuid,
  plotId: ZGuid,
  cropCycleId: ZGuid,
  newScheduleTemplateId: ZGuid,
  reason: z.enum([
    'BetterFit',
    'WeatherShift',
    'SwitchedCropVariety',
    'OwnerDirective',
    'Other',
  ]),
  reasonText: z.string().optional(),
  actorRole: z.string().optional(),
  clientCommandId: z.string().optional(),
  newSubscriptionId: ZGuid.optional(),
  migrationEventId: ZGuid.optional(),
});

export type MigrateSchedulePayloadType = z.infer<typeof MigrateSchedulePayload>;
