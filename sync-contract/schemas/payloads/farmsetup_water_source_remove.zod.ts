// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9)
//
// farmsetup.water_source.remove - a farm's water source and its motors move to the removed state (rows are never deleted); their plot links are
// removed in the same save, so a plot never keeps a dead name (it shows बाकी). A NEW name. `baseRevision` must equal the stored revision, else refused.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const FarmsetupWaterSourceRemovePayload = z
    .object({
        farmId: ZGuid,
        waterSourceId: ZGuid,
        baseRevision: z.number().int().min(1),
    })
    .strict();

export type FarmsetupWaterSourceRemovePayloadType = z.infer<typeof FarmsetupWaterSourceRemovePayload>;
