// T-IGH-02-PAYLOADS: canonical payload schema for testinstance.reported.
// Mirrors the backend handler's RecordTestResultMutationPayload record
// (with its inline TestResultMutationPayload child).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

const TestResultPayload = z.object({
    parameterCode: z.string().min(1),
    parameterValue: z.string().min(1),
    unit: z.string().optional(),
    referenceRangeLow: z.number().optional(),
    referenceRangeHigh: z.number().optional(),
});

export const TestinstanceReportedPayload = z.object({
    testInstanceId: ZGuid,
    results: z.array(TestResultPayload).min(1),
    attachmentIds: z.array(ZGuid).optional(),
    clientCommandId: z.string().optional(),
});

export type TestinstanceReportedPayloadType = z.infer<typeof TestinstanceReportedPayload>;
