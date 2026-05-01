import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors AdoptScheduleCommand (Schedules/AdoptSchedule/AdoptScheduleCommand.cs).
// Sync handler not yet wired (Sub-plan 03). ActorUserId is filled from
// the auth context.
export const AdoptSchedulePayload = z.object({
  farmId: ZGuid,
  plotId: ZGuid,
  cropCycleId: ZGuid,
  scheduleTemplateId: ZGuid,
  actorRole: z.string().optional(),
  clientCommandId: z.string().optional(),
  subscriptionId: ZGuid.optional(),
});

export type AdoptSchedulePayloadType = z.infer<typeof AdoptSchedulePayload>;
