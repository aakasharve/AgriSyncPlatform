// Sub-plan 02 Task 8 scaffold for create_crop_cycle.
// Full payload schema is deferred to T-IGH-02-PAYLOADS (filed in Task 12).
// Until then, validate as z.unknown() so MutationQueue.enqueue accepts
// payloads of any shape — backend rejection remains the source of truth.
import { z } from 'zod';

export const CreateCropCyclePayload = z.unknown();
export type CreateCropCyclePayloadType = z.infer<typeof CreateCropCyclePayload>;
