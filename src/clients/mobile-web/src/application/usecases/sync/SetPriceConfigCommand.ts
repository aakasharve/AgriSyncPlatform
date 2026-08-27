import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export interface SetPriceConfigPayload {
     configId: string;
     category: string;
     unitPrice: number;
     currencyCode: string;
     unitType: string;
     effectiveDate: string;
}

export class SetPriceConfigCommand {
     /** P0.6 — stable key on the config's own id. See `AddCostEntryCommand`. */
     static async enqueue(payload: SetPriceConfigPayload): Promise<string> {
          const clientRequestId = `${SyncMutationName.SetPriceConfig}:${payload.configId}`;
          return mutationQueue.enqueue(SyncMutationName.SetPriceConfig, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
