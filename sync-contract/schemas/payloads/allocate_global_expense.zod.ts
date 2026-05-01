import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// Mirrors PushSyncBatchHandler.AllocateGlobalExpenseMutationPayload +
// AllocateGlobalExpenseMutationAllocationPayload. PayloadHasOnly
// allow-list: dayLedgerId, costEntryId, allocationBasis, allocations,
// createdByUserId.
const AllocationDetail = z.object({
  plotId: ZGuid,
  amount: z.number(),
});

export const AllocateGlobalExpensePayload = z.object({
  dayLedgerId: ZGuid.optional(),
  costEntryId: ZGuid,
  allocationBasis: z.string().min(1),
  allocations: z.array(AllocationDetail),
  createdByUserId: ZGuid.optional(),
});

export type AllocateGlobalExpensePayloadType = z.infer<typeof AllocateGlobalExpensePayload>;
