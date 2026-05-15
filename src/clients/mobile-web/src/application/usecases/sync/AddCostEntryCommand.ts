import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import type { LocationPayload } from './CreateDailyLogCommand';
import type { CostCategoryId } from '../../../domain/finance/CostCategory';

// DATA_PRINCIPLE_SPINE 02.5 — wire-shape rename: free-text `category`
// becomes a canonical FK `categoryId` (CostCategoryId union). Backend
// commit e2d5bcf renamed the .NET command + DTO; this is the matching
// frontend half so the push payload aligns. The sync-contract zod
// schema at sync-contract/schemas/payloads/add_cost_entry.zod.ts must
// be regenerated to match in the same wire-compat bundle (out of
// scope for implementor-frontend; coordinator owns).
export interface AddCostEntryPayload {
     costEntryId: string;
     farmId: string;
     categoryId: CostCategoryId;
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
