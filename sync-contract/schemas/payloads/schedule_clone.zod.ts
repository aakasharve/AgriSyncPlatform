import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors CloneScheduleTemplateCommand (Planning/CloneScheduleTemplate).
// The sync handler is not yet wired (Sub-plan 03), so this schema is
// based on the C# command record. newScope is the TenantScope enum
// (Private | Team | Licensed | Public).
export const ScheduleClonePayload = z.object({
  sourceTemplateId: ZGuid,
  newTemplateId: ZGuid,
  callerRole: z.string().optional(),
  newScope: z.enum(['Private', 'Team', 'Licensed', 'Public']),
  reason: z.string().min(1),
  clientCommandId: z.string().optional(),
});

export type ScheduleClonePayloadType = z.infer<typeof ScheduleClonePayload>;
