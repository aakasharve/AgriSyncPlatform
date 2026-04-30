import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
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
          return mutationQueue.enqueue(SyncMutationName.AllocateGlobalExpense, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
