import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.ComplianceAcknowledgeMutationPayload.
export const ComplianceAcknowledgePayload = z.object({
  signalId: ZGuid,
});

export type ComplianceAcknowledgePayloadType = z.infer<typeof ComplianceAcknowledgePayload>;
