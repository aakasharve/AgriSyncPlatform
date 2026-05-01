import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors OverridePlannedActivityCommand
// (Planning/OverridePlannedActivity/OverridePlannedActivityCommand.cs).
// Sync handler not yet wired (Sub-plan 03). At least one of newPlannedDate
// / newActivityName / newStage must be present (server-side invariant);
// schema accepts each as optional.
export const PlanOverridePayload = z.object({
  plannedActivityId: ZGuid,
  farmId: ZGuid,
  newPlannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd')
    .optional(),
  newActivityName: z.string().optional(),
  newStage: z.string().optional(),
  reason: z.string().min(1),
  clientCommandId: z.string().optional(),
});

export type PlanOverridePayloadType = z.infer<typeof PlanOverridePayload>;
