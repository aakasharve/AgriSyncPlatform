import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { LocationPayload } from './CreateDailyLogCommand';
import type { CostCategoryId } from '../../../domain/finance/CostCategory';

// DATA_PRINCIPLE_SPINE 02.5 — wire-shape rename: free-text `category`
// becomes a canonical FK `categoryId` (CostCategoryId union). Backend
// commit e2d5bcf renamed the .NET command + DTO; this is the matching
// frontend half so the push payload aligns. The sync-contract zod
// schema at sync-contract/schemas/payloads/add_cost_entry.zod.ts must
// be regenerated to match in the same wire-compat bundle (out of
// scope for implementor-frontend; coordinator owns).
/**
 * Which way the money moved, as the farmer stated it.
 *
 * Mirrors `MoneyDirectionEnum` in the canonical zod schema. Deliberately
 * has NO 'Unknown' member: a producer that does not know the direction must
 * omit the field, not assert a third value. "Unknown" is a property of a
 * READ (a row that never carried a statement), never of a write.
 */
export type MoneyDirection = 'Expense' | 'Income';

export interface AddCostEntryPayload {
     costEntryId: string;
     farmId: string;
     categoryId: CostCategoryId;
     description: string;
     amount: number;
     currencyCode: string;
     entryDate: string;
     /**
      * REQUIRED here, OPTIONAL on the wire — the one deliberate asymmetry
      * between this twin and `add_cost_entry.zod.ts`, guarded explicitly in
      * `__tests__/AddCostEntryPayload.direction.test.ts`.
      *
      * Optional on the wire because clients shipped before this change omit
      * the key and their silence must read as UNKNOWN. Required here because
      * THIS client always knows: every call site starts from a `MoneyEvent`
      * whose `type` is the farmer's stated direction. Making it required is
      * what stops the next money surface from silently re-creating the
      * defect — a new call site will not compile without stating one.
      */
     direction: MoneyDirection;
     plotId?: string;
     cropCycleId?: string;
     location?: LocationPayload;
     // The line detail that used to stop at the outbox boundary. All optional:
     // absent means the farmer did not state it. Never invent a value to fill
     // one, and never derive `amount` from `qty * unitPrice`.
     qty?: number;
     unit?: string;
     unitPrice?: number;
     paymentMode?: 'Cash' | 'UPI' | 'Bank' | 'Credit';
     vendorName?: string;
     /** Client-side attachment ids. `[]` is a statement ("none linked"). */
     attachments?: string[];
}

export class AddCostEntryCommand {
     /**
      * P0.6 — STABLE IDEMPOTENCY KEY, derived from the entry's own identity.
      *
      * A freshly generated UUID per enqueue meant two enqueues of the SAME
      * logical cost entry produced two keys, two queue rows and two entries on
      * the server. Both server dedupe layers key on the client request id, so a
      * random one disarms both. Copies the shape `CreateDailyLogCommand` already
      * uses (`create_daily_log:${dailyLogId}`) — the one command whose contrast
      * test proves the pattern works.
      *
      * WHAT THIS BUYS, STATED ACCURATELY. Retry and replay were ALREADY
      * idempotent: the id is minted once at enqueue and persisted, so every
      * retry re-sends it. This buys a key the crash reconciler can reconstruct
      * from the entry alone, without the queue row — and it collapses a second
      * enqueue of the same entry.
      *
      * WHAT IT DOES NOT BUY: protection from a double TAP on a surface that
      * mints a new `costEntryId` per tap. A stable key cannot fix an unstable
      * identity; that needs the id minted once at intent capture.
      */
     static async enqueue(payload: AddCostEntryPayload): Promise<string> {
          const clientRequestId = `${SyncMutationName.AddCostEntry}:${payload.costEntryId}`;
          return mutationQueue.enqueue(SyncMutationName.AddCostEntry, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
