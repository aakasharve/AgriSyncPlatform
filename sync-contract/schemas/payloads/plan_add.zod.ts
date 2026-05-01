import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors AddLocalPlannedActivityCommand
// (Planning/OverridePlannedActivity/AddLocalPlannedActivityCommand.cs).
// Sync handler not yet wired (Sub-plan 03). PlannedDate is DateOnly.
export const PlanAddPayload = z.object({
  newActivityId: ZGuid,
  cropCycleId: ZGuid,
  farmId: ZGuid,
  activityName: z.string().min(1),
  stage: z.string().min(1),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd'),
  reason: z.string().min(1),
  clientCommandId: z.string().optional(),
});

export type PlanAddPayloadType = z.infer<typeof PlanAddPayload>;
