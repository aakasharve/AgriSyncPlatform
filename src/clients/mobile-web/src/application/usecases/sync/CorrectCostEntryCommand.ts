import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export interface CorrectCostEntryPayload {
     costEntryId: string;
     correctionId: string;
     originalAmount: number;
     correctedAmount: number;
     currencyCode: string;
     reason: string;
}

export class CorrectCostEntryCommand {
     /**
      * P0.6 — stable key on the correction's own id. See `AddCostEntryCommand`.
      *
      * The KEY is client-side only, so it is safe to make stable now. The
      * PAYLOAD is not yet fixed and this correction still cannot land: the
      * server allow-list accepts `financeCorrectionId` and refuses both
      * `correctionId` and `originalAmount`, so `PayloadHasOnly` rejects the
      * whole mutation. That rename is deliberately NOT made here, because
      * `financeCorrectionId` is validated as a bare GUID while this id is minted
      * `madj_`-prefixed (`financeCommandService.ts:162`) — renaming the key
      * without changing the id's shape makes the validator throw inside an
      * unawaited promise, so the correction would stop reaching the outbox at
      * all. That is strictly worse than being rejected at the server, and it
      * needs the id-shape decision first.
      */
     static async enqueue(payload: CorrectCostEntryPayload): Promise<string> {
          const clientRequestId = `${SyncMutationName.CorrectCostEntry}:${payload.correctionId}`;
          return mutationQueue.enqueue(SyncMutationName.CorrectCostEntry, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
