// Sub-plan 02 Task 8 scaffold for schedule.publish.
// Full payload schema is deferred to T-IGH-02-PAYLOADS (filed in Task 12).
// Until then, validate as z.unknown() so MutationQueue.enqueue accepts
// payloads of any shape — backend rejection remains the source of truth.
import { z } from 'zod';

export const SchedulePublishPayload = z.unknown();
export type SchedulePublishPayloadType = z.infer<typeof SchedulePublishPayload>;
