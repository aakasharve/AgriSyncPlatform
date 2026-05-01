import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

// T-IGH-02-PAYLOADS: aligned with the canonical set_price_config wire
// shape (PushSyncBatchHandler.SetPriceConfigMutationPayload). The
// previous interface used {configId, category, unitType, effectiveDate}
// and was rejected by the server's PayloadHasOnly allow-list. Replaced
// with the server's field names: priceConfigId / itemName / effectiveFrom
// / version. The optional createdByUserId is filled from the auth context.
export interface SetPriceConfigPayload {
     priceConfigId?: string;
     itemName: string;
     unitPrice: number;
     currencyCode: string;
     effectiveFrom: string;
     version: number;
     createdByUserId?: string;
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
