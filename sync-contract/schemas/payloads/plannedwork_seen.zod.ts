// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24c) — plannedwork.seen: the assignee has SEEN the task (stamped once).
// Only the assignee may; anyone else (the old assignee after a reassign included) is refused ('ShramSafal.Forbidden') and the
// phone keeps the change, parked and visible (P10). Who answered and when are the server's.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const PlannedWorkSeenPayload = z.object({
    plannedWorkId: ZGuid,
    farmId: ZGuid,
}).strict();

export type PlannedWorkSeenPayloadType = z.infer<typeof PlannedWorkSeenPayload>;
