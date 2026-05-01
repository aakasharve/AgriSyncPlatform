import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.RecordTestResultMutationPayload +
// TestResultMutationPayload. PayloadHasOnly allow-list:
// testInstanceId, results, attachmentIds, clientCommandId.
const TestResultEntry = z.object({
  parameterCode: z.string().min(1),
  parameterValue: z.string().min(1),
  unit: z.string().optional(),
  referenceRangeLow: z.number().optional(),
  referenceRangeHigh: z.number().optional(),
});

export const TestinstanceReportedPayload = z.object({
  testInstanceId: ZGuid,
  results: z.array(TestResultEntry).min(1),
  attachmentIds: z.array(ZGuid).optional(),
  clientCommandId: z.string().optional(),
});

export type TestinstanceReportedPayloadType = z.infer<typeof TestinstanceReportedPayload>;
