// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM; founder 27 Nov follow-up 2: "पैशांच्या नोंदी फक्त मला दिसू दे")
//
// farm.money_private.set - the farm's switch: while it is ON, every NEW money record (a bill, a खर्च, the money a work record states) is seen only by
// the farm's registrant and the person who made it. Records made before keep the audience they had (follow-up 1: new records only). Only the farm's
// registrant may set it; anyone else is refused. The same value again = saved, nothing written. A NEW name.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const FarmMoneyPrivateSetPayload = z
    .object({
        farmId: ZGuid,
        isPrivate: z.boolean(),
    })
    .strict();

export type FarmMoneyPrivateSetPayloadType = z.infer<typeof FarmMoneyPrivateSetPayload>;
