// T-IGH-02-PAYLOADS: canonical payload schema for adopt_schedule.
// Server handler: PushSyncBatchHandler (wired by lane L8b-1) — the schema mirrors the
// AdoptScheduleCommand domain record.
import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

/** YYYY-MM-DD (DateOnly on the server, as create_crop_cycle's dates). */
const ZScheduleDay = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const AdoptSchedulePayload = z.object({
    farmId: ZGuid,
    plotId: ZGuid,
    cropCycleId: ZGuid,
    scheduleTemplateId: ZGuid,
    actorUserId: ZGuid,
    actorRole: z.string().optional(),
    clientCommandId: z.string().optional(),
    subscriptionId: ZGuid.optional(),
    // spec: plr-d10 lane L8b-1 — the plot's day 0 set in "शेड्यूल बदला" (YYYY-MM-DD). Optional and additive: 1.0.17
    // never sends it, and the server then counts from the crop season's start (P11).
    referenceDate: ZScheduleDay.optional(),
    // spec: plr-d10 lane L8b-1 (founder D-73) — when the farmer made this change on the phone (ISO, with offset). Optional:
    // a change made offline while he held "plan work", arriving after it ended, counts inside the late window and is
    // flagged for the owner (MU design §11.2). Without it only "held now" counts (P11: 1.0.17 sends none).
    decidedAtUtc: ZIsoDate.optional(),
});

export type AdoptSchedulePayloadType = z.infer<typeof AdoptSchedulePayload>;
