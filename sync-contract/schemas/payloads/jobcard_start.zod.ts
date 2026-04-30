// Sub-plan 02 Task 8 scaffold for jobcard.start.
// Full payload schema is deferred to T-IGH-02-PAYLOADS (filed in Task 12).
// Until then, validate as z.unknown() so MutationQueue.enqueue accepts
// payloads of any shape — backend rejection remains the source of truth.
import { z } from 'zod';

export const JobcardStartPayload = z.unknown();
export type JobcardStartPayloadType = z.infer<typeof JobcardStartPayload>;
