// T-IGH-02-PAYLOADS: canonical payload schema for compliance.acknowledge.
// Mirrors the backend handler's ComplianceAcknowledgeMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const ComplianceAcknowledgePayload = z.object({
    signalId: ZGuid,
});

export type ComplianceAcknowledgePayloadType = z.infer<typeof ComplianceAcknowledgePayload>;
