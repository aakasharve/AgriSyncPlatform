import { z } from 'zod';
import { ZGuid, ZIsoDate, ZMoneyMinor } from './_shared.zod';

export const AddCostEntryPayload = z.object({
  costEntryId: ZGuid,
  farmId: ZGuid,
  plotIds: z.array(ZGuid).min(1),
  category: z.string().min(1),
  amount: ZMoneyMinor,
  occurredAt: ZIsoDate,
  notes: z.string().optional(),
});

export type AddCostEntryPayloadType = z.infer<typeof AddCostEntryPayload>;
