// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who
// and when"). A reviewer's मंजूर on ONE bill (a cost entry), queued like every other change so it works with no internet;
// the server decides when it arrives (doctrine P10).
//
//   - `approvalId`: the stamp's own id, made on the phone: a re-sent approval is the same stamp.
//   - `costEntryId`: the bill.
//   - `farmId`: the bill's farm (the server refuses a bill of any other farm, E4; the phone's outbox reads it).
//   - `billVersion`: the version of the bill he SAW (the pull's `billVersion`). The server refuses a version that moved on
//     (`ShramSafal.LogVersion.Conflict`, the L4b exact-version code) so a changed bill is seen before it is approved.
//
// Who approves is the authenticated sender, never a payload field. When is the server's clock. The server checks, in code:
// the sender holds "पैशांच्या नोंदी तपासणे व दुरुस्त करणे" (ReviewMoney) on the bill's farm or is its primary account
// holder, may see the bill (audience, PRV) and covers its plot (MU-4).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const ApproveCostEntryPayload = z.object({
    approvalId: ZGuid,
    costEntryId: ZGuid,
    farmId: ZGuid,
    billVersion: z.number().int().min(1),
}).strict();

export type ApproveCostEntryPayloadType = z.infer<typeof ApproveCostEntryPayload>;
