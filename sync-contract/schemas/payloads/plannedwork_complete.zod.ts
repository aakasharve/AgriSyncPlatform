// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-3 (founder D-24d, D-30, D-1) — plannedwork.complete: "काम झालं".
// The assignee (or, for a personal reminder, its maker) says the work was done: on which plots, with which logs, and whether
// anything is left. Each named plot becomes Done; the work becomes Done only when nothing is left and every plot is Done.
//   - `plotIds`: the plots done now (each a live plot of the work); empty only for work with no plots.
//   - `dailyLogIds`: the real logs that show it (handed-out work needs at least one, on the plots named); a personal reminder
//     may send none (D-1). The phone sends this AFTER the logs' own create, so a refusal 'ShramSafal.DailyLogNotFound' waits.
//   - `somethingLeft`: true = more remains; the logs are linked and the work stays pending (never Done).
// Who did it and when are the server's. Only words and ids: nothing here is a quantity, a crew, a headcount or a pay.
// Anyone else, and the old assignee after a reassign, is refused ('ShramSafal.Forbidden') and the phone parks the change (P10).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const PlannedWorkCompletePayload = z.object({
    plannedWorkId: ZGuid,
    farmId: ZGuid,
    plotIds: z.array(ZGuid).max(200),
    dailyLogIds: z.array(ZGuid).max(100),
    somethingLeft: z.boolean(),
}).strict();

export type PlannedWorkCompletePayloadType = z.infer<typeof PlannedWorkCompletePayload>;
