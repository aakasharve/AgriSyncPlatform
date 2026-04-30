import { z } from 'zod';
import { ZGuid, ZIsoDate, ZClientRequestId } from './_shared.zod';

export const CreateDailyLogPayload = z.object({
  clientRequestId: ZClientRequestId,
  logId: ZGuid,
  farmId: ZGuid,
  plotIds: z.array(ZGuid).min(1),
  capturedAt: ZIsoDate,
  inputMode: z.enum(['voice', 'manual', 'patti', 'imported']),
  voiceTranscript: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateDailyLogPayloadType = z.infer<typeof CreateDailyLogPayload>;
