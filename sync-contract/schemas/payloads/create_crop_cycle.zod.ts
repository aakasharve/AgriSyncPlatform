// T-IGH-02-PAYLOADS: canonical payload schema for create_crop_cycle.
// Mirrors the backend handler's CreateCropCycleMutationPayload record.
// LogDate fields are YYYY-MM-DD strings (DateOnly serialisation), not ISO datetimes.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

const ZLogDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const CreateCropCyclePayload = z.object({
    cropCycleId: ZGuid.optional(),
    farmId: ZGuid,
    plotId: ZGuid,
    cropName: z.string().min(1),
    stage: z.string().min(1),
    startDate: ZLogDate,
    endDate: ZLogDate.optional(),
});

export type CreateCropCyclePayloadType = z.infer<typeof CreateCropCyclePayload>;
