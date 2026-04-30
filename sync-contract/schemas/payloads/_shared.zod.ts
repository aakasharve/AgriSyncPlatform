import { z } from 'zod';

export const ZIsoDate = z.string().datetime({ offset: true });

export const ZGuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'must be a UUID v4 string'
);

export const ZMoneyMinor = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.literal('INR'),
});

export const ZClientRequestId = z.string().min(1).max(64);
