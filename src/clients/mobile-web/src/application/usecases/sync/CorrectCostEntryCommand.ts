import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

// T-IGH-02-PAYLOADS: aligned with the canonical correct_cost_entry wire
// shape (PushSyncBatchHandler.CorrectCostEntryMutationPayload). The
// previous interface carried `correctionId` and `originalAmount`; both
// were rejected by the server's PayloadHasOnly allow-list and were
// dropped here. Use `financeCorrectionId` (idempotency Guid) instead.
export interface CorrectCostEntryPayload {
     costEntryId: string;
     financeCorrectionId?: string;
     correctedAmount: number;
     currencyCode: string;
     reason: string;
     correctedByUserId?: string;
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
