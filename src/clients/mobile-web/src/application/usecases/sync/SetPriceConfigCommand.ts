import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

export interface SetPriceConfigPayload {
     configId: string;
     category: string;
     unitPrice: number;
     currencyCode: string;
     unitType: string;
     effectiveDate: string;
}

export class SetPriceConfigCommand {
     static async enqueue(payload: SetPriceConfigPayload): Promise<string> {
          const clientRequestId = idGenerator.generate();
          return mutationQueue.enqueue(SyncMutationName.SetPriceConfig, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
