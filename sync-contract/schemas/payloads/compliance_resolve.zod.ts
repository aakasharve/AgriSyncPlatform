import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.ComplianceResolveMutationPayload.
// The handler requires `note` to be non-empty; schema enforces min(1).
export const ComplianceResolvePayload = z.object({
  signalId: ZGuid,
  note: z.string().min(1),
});

export type ComplianceResolvePayloadType = z.infer<typeof ComplianceResolvePayload>;
