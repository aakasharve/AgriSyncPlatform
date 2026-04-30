import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

export const CreateAttachmentPayload = z.object({
  attachmentId: ZGuid,
  ownerType: z.enum(['daily_log', 'cost_entry', 'job_card']),
  ownerId: ZGuid,
  mimeType: z.string().min(1),
  byteLength: z.number().int().positive(),
  uploadIntentToken: z.string().min(1),
  capturedAt: ZIsoDate,
});

export type CreateAttachmentPayloadType = z.infer<typeof CreateAttachmentPayload>;
