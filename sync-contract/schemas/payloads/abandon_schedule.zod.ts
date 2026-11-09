// T-IGH-02-PAYLOADS: canonical payload schema for abandon_schedule.
// Server handler: PushSyncBatchHandler (wired by lane L8b-1) — the schema mirrors the
// AbandonScheduleCommand domain record.
import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

export const AbandonSchedulePayload = z.object({
    farmId: ZGuid,
    plotId: ZGuid,
    cropCycleId: ZGuid,
    actorUserId: ZGuid,
    reasonText: z.string().optional(),
    actorRole: z.string().optional(),
    clientCommandId: z.string().optional(),
    // spec: plr-d10 lane L8b-1 (founder D-73) — when the farmer made this change on the phone (ISO, with offset). Optional:
    // a change made offline while he held "plan work", arriving after it ended, counts inside the late window and is
    // flagged for the owner (MU design §11.2). Without it only "held now" counts (P11: 1.0.17 sends none).
    decidedAtUtc: ZIsoDate.optional(),
    // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - WHICH followed schedule to let go: a plot-season may follow up to 3 outside
    // schedules plus 1 of his own. Optional: absent = the plot-season's one Active schedule (P11: 1.0.17 sends none); several followed
    // and none named is refused (ShramSafal.ScheduleChoiceNeeded), never an arbitrary row.
    subscriptionId: ZGuid.optional(),
});

export type AbandonSchedulePayloadType = z.infer<typeof AbandonSchedulePayload>;
