import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.SetPriceConfigMutationPayload.
// PayloadHasOnly allow-list: priceConfigId, itemName, unitPrice,
// currencyCode, effectiveFrom, version, createdByUserId.
// effectiveFrom is DateOnly (yyyy-MM-dd) on the wire.
export const SetPriceConfigPayload = z.object({
  priceConfigId: ZGuid.optional(),
  itemName: z.string().min(1),
  unitPrice: z.number(),
  currencyCode: z.string().min(1),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd'),
  version: z.number().int(),
  createdByUserId: ZGuid.optional(),
});

export type SetPriceConfigPayloadType = z.infer<typeof SetPriceConfigPayload>;
