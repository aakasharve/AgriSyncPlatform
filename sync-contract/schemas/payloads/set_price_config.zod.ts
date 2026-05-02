// T-IGH-02-PAYLOADS: canonical payload schema for set_price_config.
// Mirrors the backend handler's SetPriceConfigMutationPayload record.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

const ZLogDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const SetPriceConfigPayload = z.object({
    priceConfigId: ZGuid.optional(),
    itemName: z.string().min(1),
    unitPrice: z.number(),
    currencyCode: z.string().min(1),
    effectiveFrom: ZLogDate,
    version: z.number().int().nonnegative(),
    createdByUserId: ZGuid.optional(),
});

export type SetPriceConfigPayloadType = z.infer<typeof SetPriceConfigPayload>;
