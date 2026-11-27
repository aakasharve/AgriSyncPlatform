// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9; R2-A item 14 "या प्लॉटला पाण्याची सोय कशी केली आहे?"; founder 27 Nov A9.2: many to many)
//
// farmsetup.plot_water.set - one plot's water arrangement, written WHOLE: the method and every source / motor that waters it. A plot may have many
// sources and motors. A canal by gravity has no motor (`motorId` left out). Every source, motor and the plot must be the SAME farm's (checked on the server).
// `method: 'none'` = the farmer said "पाण्याची सोय नाही"; a plot with no row at all was never asked and shows बाकी. The two are never mixed (P4).
// A NEW name. `baseRevision`: 0 for a plot never answered, else the revision last received.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const PlotWaterMethodEnum = z.enum(['drip', 'flood', 'sprinkler', 'none']);

export const PlotWaterLinkSchema = z
    .object({
        waterSourceId: ZGuid,
        motorId: ZGuid.optional(),
    })
    .strict();

export const FarmsetupPlotWaterSetPayload = z
    .object({
        farmId: ZGuid,
        plotId: ZGuid,
        baseRevision: z.number().int().min(0),
        method: PlotWaterMethodEnum,
        links: z.array(PlotWaterLinkSchema).max(24),
    })
    .strict();

export type FarmsetupPlotWaterSetPayloadType = z.infer<typeof FarmsetupPlotWaterSetPayload>;
