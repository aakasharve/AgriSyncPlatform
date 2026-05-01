import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.RecordTestCollectedMutationPayload.
// PayloadHasOnly allow-list: testInstanceId.
export const TestinstanceCollectedPayload = z.object({
  testInstanceId: ZGuid,
});

export type TestinstanceCollectedPayloadType = z.infer<typeof TestinstanceCollectedPayload>;
