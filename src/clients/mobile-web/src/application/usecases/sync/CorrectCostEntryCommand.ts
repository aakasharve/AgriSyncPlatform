import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

/**
 * The wire shape the server actually accepts, and nothing else.
 *
 * `PushSyncBatchHandler`'s `PayloadHasOnly` refuses the WHOLE mutation if any
 * property name falls outside its allow-list, so an extra key here is not a
 * tolerated hint — it is a refusal of the farmer's correction. The allow-list
 * is `{financeCorrectionId, costEntryId, correctedAmount, currencyCode, reason,
 * correctedByUserId}` and the canonical shape is
 * `sync-contract/schemas/payloads/correct_cost_entry.zod.ts`.
 *
 * TWO FIELDS THAT USED TO BE HERE, AND WHY NEITHER IS COMING BACK
 * ---------------------------------------------------------------
 * `correctionId` was the right value under a name the server refuses. It is now
 * `financeCorrectionId` — same value, the name the contract validates.
 *
 * `originalAmount` was a hardcoded `0`. It is gone rather than renamed: the
 * previous amount is a fact the SERVER already holds on the cost entry, and a
 * client that does not know it must stay silent rather than assert a zero. A
 * fabricated previous value in a money ledger is the exact defect class this
 * migration exists to remove (`P4`).
 *
 * `correctedByUserId` is deliberately NOT sent. The allow-list tolerates it, but
 * the contract validates it as a bare GUID and this client's call sites carry
 * UI placeholders (`'current_user'`, `'owner'`) rather than user ids. Sending a
 * placeholder would fail validation on-device; sending nothing lets the server
 * attribute the correction from the authenticated caller, which is the only
 * party that actually knows.
 */
export interface CorrectCostEntryPayload {
     costEntryId: string;
     /**
      * BARE UUID — no prefix. Validated as `ZGuid` by `validatePayload` at
      * enqueue time, and `MutationQueue.enqueue` THROWS on a validation failure
      * into a promise the finance service used to leave unobserved. A prefixed
      * id here does not degrade to a server-side rejection; it stops the
      * correction reaching the outbox at all, which is strictly worse. The id
      * shape and this key name are one change and must never be split.
      */
     financeCorrectionId: string;
     correctedAmount: number;
     currencyCode: string;
     reason: string;
}

export class CorrectCostEntryCommand {
     /**
      * P0.6 — stable key on the correction's own id. See `AddCostEntryCommand`
      * for what a stable key does and does not buy: retry and replay were
      * already idempotent because the id is minted once and persisted, so this
      * buys a key the crash reconciler can rebuild from the correction alone,
      * and it collapses a second enqueue of the SAME correction.
      *
      * It does not, by itself, stop a double tap — that needs the id minted once
      * at intent capture rather than per submit. `financeCommandService`
      * `applyAdjustment` now ACCEPTS a caller-minted id for exactly that, but no
      * correction surface passes one yet (`CostCorrectionSheet.tsx`,
      * `MoneyLensDrawer.tsx` — both blocked behind the UI gate). Until they do,
      * the double-tap case is open. Do not describe it as closed.
      */
     static async enqueue(payload: CorrectCostEntryPayload): Promise<string> {
          const clientRequestId = `${SyncMutationName.CorrectCostEntry}:${payload.financeCorrectionId}`;
          return mutationQueue.enqueue(SyncMutationName.CorrectCostEntry, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
