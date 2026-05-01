import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PublishScheduleTemplateCommand (Planning/PublishScheduleTemplate).
// The sync handler is not yet wired (Sub-plan 03), so this schema is
// based on the C# command record. CallerUserId / CallerRole are filled
// from the auth context, so they're not required on the wire.
export const SchedulePublishPayload = z.object({
  templateId: ZGuid,
  callerRole: z.string().optional(),
  clientCommandId: z.string().optional(),
});

export type SchedulePublishPayloadType = z.infer<typeof SchedulePublishPayload>;
