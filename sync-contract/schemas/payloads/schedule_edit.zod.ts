import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors EditScheduleTemplateCommand (Planning/EditScheduleTemplate).
// The sync handler is not yet wired (Sub-plan 03), so this schema is
// based on the C# command record.
export const ScheduleEditPayload = z.object({
  sourceTemplateId: ZGuid,
  newTemplateId: ZGuid,
  callerRole: z.string().optional(),
  newName: z.string().optional(),
  newStage: z.string().optional(),
  clientCommandId: z.string().optional(),
});

export type ScheduleEditPayloadType = z.infer<typeof ScheduleEditPayload>;
