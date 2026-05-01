import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors AbandonScheduleCommand (Schedules/AbandonSchedule/AbandonScheduleCommand.cs).
// Sync handler not yet wired (Sub-plan 03).
export const AbandonSchedulePayload = z.object({
  farmId: ZGuid,
  plotId: ZGuid,
  cropCycleId: ZGuid,
  reasonText: z.string().optional(),
  actorRole: z.string().optional(),
  clientCommandId: z.string().optional(),
});

export type AbandonSchedulePayloadType = z.infer<typeof AbandonSchedulePayload>;
