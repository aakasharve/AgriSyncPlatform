// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — an edit to what Sathi understood
// (crop work, water, inputs, notes, machinery, expenses, planned work), sent to the server so it
// stops living on one phone (doctrine P10). The server appends a NEW record version — the earlier
// one stays as history (P3) — and a material change re-opens a confirmed day (lane L6).
//
// `dailyLogId` is the key the pull guard reads (`pendingMutations.readPendingLogIds`), so the
// edited log is left alone by every pull until the server has accepted this mutation.
// `baseVersion` is the record version the editor saw; an older one is ACCEPTED and recorded
// (both versions are kept), never dropped. Labour keeps its own correction route.
import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';
import { LogContentSchema } from './_log_content.zod';

export const ReviseLogContentPayload = z.object({
    dailyLogId: ZGuid,
    baseVersion: z.number().int().min(1),
    content: LogContentSchema,
    reason: z.string().max(400).optional(),
    revisedAtUtc: ZIsoDate,
});

export type ReviseLogContentPayloadType = z.infer<typeof ReviseLogContentPayload>;
