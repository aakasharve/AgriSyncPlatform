import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import type { LocationPayload } from './CreateDailyLogCommand';

export interface AddCostEntryPayload {
     costEntryId: string;
     farmId: string;
     category: string;
     description: string;
     amount: number;
     currencyCode: string;
     entryDate: string;
     plotId?: string;
     cropCycleId?: string;
     location?: LocationPayload;
}

export class AddCostEntryCommand {
     static async enqueue(payload: AddCostEntryPayload): Promise<string> {
          const clientRequestId = idGenerator.generate();
          return mutationQueue.enqueue(SyncMutationName.AddCostEntry, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
