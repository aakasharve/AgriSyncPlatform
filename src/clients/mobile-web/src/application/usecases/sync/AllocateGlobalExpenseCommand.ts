import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

export interface AllocationDetailPayload {
     plotId: string;
     amount: number;
}

export interface AllocateGlobalExpensePayload {
     dayLedgerId?: string;
     costEntryId: string;
     allocationBasis: 'equal' | 'by_acreage' | 'custom';
     allocations: AllocationDetailPayload[];
}

export class AllocateGlobalExpenseCommand {
     static async enqueue(payload: AllocateGlobalExpensePayload): Promise<string> {
          const clientRequestId = idGenerator.generate();
          return mutationQueue.enqueue('allocate_global_expense', payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
