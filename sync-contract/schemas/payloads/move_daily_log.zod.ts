// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; founder TAP-1 + D-61 = 5A) — move a SAVED
// entry to another place ("प्लॉट बदला") and/or another day ("दिवस बदला"), queued like every other change so it
// works with no internet and reaches the server (doctrine P10).
//
// THE NEW PLACE is ONE of:
//   - `newPlotIds`: the plot(s) he chose in the one crop → plot selector (one plot, or several), or
//   - `wholeFarm: true`: संपूर्ण शेत.
// Absent both = the place does not change. `newLogDate` absent = the day does not change. At least one of the
// three must be present (the server and the phone both refuse an empty move).
//
// `dailyLogId` is the key the pull guard reads (`pendingMutations.readPendingLogIds`), so the moved entry is
// left alone by every pull until the server has answered. `baseVersion` is the record version he saw: unlike
// a content revision, a move made from an OLDER version is REFUSED (never applied over a newer change), and
// the phone puts the entry back to the server's version with the reason shown.
//
// The idempotency key is the envelope's `clientRequestId` (the server dedupes every mutation on device +
// request id); it is not repeated here, so the two can never disagree.
//
// `moneyLines` (lane OF-S fix pass 2) — every line of the entry that STATED an amount on this phone, by the same rule
// the save used to make money from it (`LogCommandService.captureMoneyEventsFromLog`): a crew's stated total (its
// engagement id), an input's cost, a machine's rent + fuel, an expense's amount. The server derives each line's money id
// under THIS record's id and refuses the whole move when any of them is not found (money saved the old way, kept on the
// phone, or not arrived yet); its answer lists exactly the money it moved, and the phone moves nothing else. Absent =
// no line stated an amount.
//
// `moneyLinesComplete` (lane OF-S fix pass 3, R2-1) — `true` only when this phone HOLDS the entry's details (it made
// the entry, or took the server's stored document) and `moneyLines` names EVERY line in them that stated an amount,
// expenses included, whether or not it knows that line's money. When the server never held the entry's details as it
// was created and this is not `true`, the move is refused whole: an expense makes no old-style line, so nobody else
// could show its money follows.
import { z } from 'zod';
import { ZGuid, ZIsoDate } from './_shared.zod';

const ZLogDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const ZMoneyLine = z.object({
    kind: z.enum(['labour', 'input', 'machinery', 'activity-expense']),
    lineId: z.string().min(1).max(128),
});

export const MoveDailyLogPayload = z.object({
    dailyLogId: ZGuid,
    baseVersion: z.number().int().min(1),
    newPlotIds: z.array(ZGuid).min(1).max(50).optional(),
    wholeFarm: z.boolean().optional(),
    newLogDate: ZLogDate.optional(),
    reason: z.string().max(400).optional(),
    revisedAtUtc: ZIsoDate,
    moneyLines: z.array(ZMoneyLine).min(1).max(500).optional(),
    moneyLinesComplete: z.boolean().optional(),
});

export type MoveDailyLogPayloadType = z.infer<typeof MoveDailyLogPayload>;
