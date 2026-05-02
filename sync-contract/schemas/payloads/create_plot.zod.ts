// T-IGH-02-PAYLOADS: canonical payload schema for create_plot.
// Mirrors the backend handler's CreatePlotMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const CreatePlotPayload = z.object({
    plotId: ZGuid.optional(),
    farmId: ZGuid,
    name: z.string().min(1),
    areaInAcres: z.number().nonnegative(),
});

export type CreatePlotPayloadType = z.infer<typeof CreatePlotPayload>;
