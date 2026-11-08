// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24c) — plannedwork.cancel: stop the work.
// Open work stays until it is done or cancelled; a cancel keeps the task (status Cancelled, who and why), it never deletes it.
// Who may: the maker while he still holds what he used to make it, or the primary account holder / "plan work" for someone
// else's task. A cancel that loses a race with an answer changes nothing ('ShramSafal.PlannedWorkState.InvalidCommand').
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const PlannedWorkCancelPayload = z.object({
    plannedWorkId: ZGuid,
    farmId: ZGuid,
    reason: z.string().min(1).max(500).optional(),
}).strict();

export type PlannedWorkCancelPayloadType = z.infer<typeof PlannedWorkCancelPayload>;
