import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors RemovePlannedActivityCommand
// (Planning/OverridePlannedActivity/RemovePlannedActivityCommand.cs).
// Sync handler not yet wired (Sub-plan 03).
export const PlanRemovePayload = z.object({
  plannedActivityId: ZGuid,
  farmId: ZGuid,
  reason: z.string().min(1),
  clientCommandId: z.string().optional(),
});

export type PlanRemovePayloadType = z.infer<typeof PlanRemovePayload>;
