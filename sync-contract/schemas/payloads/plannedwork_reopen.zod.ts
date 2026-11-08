// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-3 (founder D-24d, P3) — plannedwork.reopen: "this was not done".
// The PRIMARY account holder only, with his reason (required, at most 500 characters), on a work that is Done: it goes back to
// pending and its plots to Pending. Anyone else is refused ('ShramSafal.Forbidden'). The history is the audit row (the step and
// the reason); the reason is the owner's own words.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const PlannedWorkReopenPayload = z.object({
    plannedWorkId: ZGuid,
    farmId: ZGuid,
    reason: z.string().min(1).max(500),
}).strict();

export type PlannedWorkReopenPayloadType = z.infer<typeof PlannedWorkReopenPayload>;
