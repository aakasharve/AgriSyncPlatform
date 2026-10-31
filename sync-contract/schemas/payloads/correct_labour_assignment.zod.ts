// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; founder TAP-1) — a worker-count / hours
// correction on a SAVED entry, queued like every other change so it works with no internet (doctrine P10).
// The server runs it through the SAME handler as the online route
// (`POST /farms/{farmId}/labour/assignments/{id}/corrections`, `CorrectLabourHandler`): the same authority,
// the same "silence is not a correction" rule, the same history rows.
//
//   - `quantity` and `durationHours` mean exactly what they mean on the online route: an absent section says
//     nothing; a count left out inside `quantity` stays "not stated" (never 0, P4).
//   - `seen` is what he SAW before changing it — only the values his phone knew. The server refuses the
//     correction when the engagement no longer says that (someone changed it meanwhile): a stale correction
//     never overwrites a newer one; the phone puts the entry back to the server's version and says why.
//   - `dailyLogId` is the key the pull guard reads, so the entry keeps his change until the server answers;
//     the server also checks the engagement belongs to that log.
//
// The idempotency key is the envelope's `clientRequestId` (device + request id), not repeated here.
import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

const ZCount = z.number().int().min(0);

export const CorrectLabourAssignmentPayload = z.object({
    labourAssignmentId: ZGuid,
    dailyLogId: ZGuid,
    farmId: ZGuid,
    quantity: z.object({
        workerCount: ZCount.optional(),
        maleCount: ZCount.optional(),
        femaleCount: ZCount.optional(),
    }).optional(),
    durationHours: z.number().positive().optional(),
    seen: z.object({
        workerCount: ZCount.optional(),
        maleCount: ZCount.optional(),
        femaleCount: ZCount.optional(),
        durationHours: z.number().positive().optional(),
    }),
    reason: z.string().max(400).optional(),
    correctedAtUtc: ZIsoDate,
});

export type CorrectLabourAssignmentPayloadType = z.infer<typeof CorrectLabourAssignmentPayload>;
