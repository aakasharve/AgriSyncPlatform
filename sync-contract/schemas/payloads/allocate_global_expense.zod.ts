// T-IGH-02-PAYLOADS: canonical payload schema for allocate_global_expense.
// Mirrors the backend handler's AllocateGlobalExpenseMutationPayload record
// (with its inline AllocateGlobalExpenseMutationAllocationPayload child).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

const AllocationPayload = z.object({
    plotId: ZGuid,
    amount: z.number(),
});

export const AllocateGlobalExpensePayload = z.object({
    dayLedgerId: ZGuid.optional(),
    costEntryId: ZGuid,
    allocationBasis: z.string().min(1),
    allocations: z.array(AllocationPayload).min(1),
    createdByUserId: ZGuid.optional(),
});

export type AllocateGlobalExpensePayloadType = z.infer<typeof AllocateGlobalExpensePayload>;
