import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

export interface CorrectCostEntryPayload {
     costEntryId: string;
     correctionId: string;
     originalAmount: number;
     correctedAmount: number;
     currencyCode: string;
     reason: string;
}

export class CorrectCostEntryCommand {
     static async enqueue(payload: CorrectCostEntryPayload): Promise<string> {
          const clientRequestId = idGenerator.generate();
          return mutationQueue.enqueue(SyncMutationName.CorrectCostEntry, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
