// Sub-plan 02 Task 8 scaffold for abandon_schedule.
// Full payload schema is deferred to T-IGH-02-PAYLOADS (filed in Task 12).
// Until then, validate as z.unknown() so MutationQueue.enqueue accepts
// payloads of any shape — backend rejection remains the source of truth.
import { z } from 'zod';

export const AbandonSchedulePayload = z.unknown();
export type AbandonSchedulePayloadType = z.infer<typeof AbandonSchedulePayload>;
