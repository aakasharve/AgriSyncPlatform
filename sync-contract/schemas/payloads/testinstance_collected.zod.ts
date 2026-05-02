// T-IGH-02-PAYLOADS: canonical payload schema for testinstance.collected.
// Mirrors the backend handler's RecordTestCollectedMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const TestinstanceCollectedPayload = z.object({
    testInstanceId: ZGuid,
});

export type TestinstanceCollectedPayloadType = z.infer<typeof TestinstanceCollectedPayload>;
