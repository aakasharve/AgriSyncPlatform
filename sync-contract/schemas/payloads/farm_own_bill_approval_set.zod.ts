// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-177; founder 27 Nov B1.4: "an owner switch for each farm; off unless the owner turns it on")
//
// farm.own_bill_approval.set - the farm's switch: may a person who checks money approve a bill he made himself. OFF for every farm unless the
// primary owner turns it on (only he may; anyone else is refused). Decided when an approval ARRIVES at the server. The same value again = saved,
// nothing written. A NEW name.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const FarmOwnBillApprovalSetPayload = z
    .object({
        farmId: ZGuid,
        allowed: z.boolean(),
    })
    .strict();

export type FarmOwnBillApprovalSetPayloadType = z.infer<typeof FarmOwnBillApprovalSetPayload>;
