// T-IGH-02-PAYLOADS: canonical payload schema for compliance.resolve.
// Mirrors the backend handler's ComplianceResolveMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const ComplianceResolvePayload = z.object({
    signalId: ZGuid,
    note: z.string().optional(),
});

export type ComplianceResolvePayloadType = z.infer<typeof ComplianceResolvePayload>;
