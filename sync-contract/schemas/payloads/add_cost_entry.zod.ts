// DATA_PRINCIPLE_SPINE sub-phase 02.6 — canonical payload schema for the
// add_cost_entry mutation. The shape mirrors the backend handler's
// allowlist (`PushSyncBatchHandler.HandleAddCostEntryAsync` →
// `AddCostEntryMutationPayload`) and the client's
// `AddCostEntryCommand.enqueue` interface, so any divergence here is a
// real contract drift and NOT a "schema we plan to harden later".
//
// History: this file shipped during T-IGH-02-PAYLOADS (Sub-plan 02 Task 8)
// with a forward-looking shape (`plotIds[]`, `ZMoneyMinor` envelope,
// `occurredAt` ISO datetime, free-text `category: string`) that no
// producer or consumer actually emitted. The backend wire shape uses
// `plotId` (singular, optional), `amount: decimal`, `entryDate:
// YYYY-MM-DD`, and after the R0 conflict-resolver verdict
// (decisions-log 2026-05-15) and backend commit e2d5bcf the category
// is now a canonical FK — `categoryId` — drawn from the 13-code
// `ssf.cost_categories` lookup table.
//
// The 13 canonical ids are locked. Adding a 14th requires:
//   1. backend `CostCategorySeed.All` row + migration
//   2. backend `CostCategoryId` parser update
//   3. frontend `src/clients/mobile-web/src/domain/finance/CostCategory.ts`
//   4. THIS file
//   5. AI prompt template (server-side `AiPromptTemplateRegistry`)
// in one bundled wire-break.
//
// CEI-I8 preservation: `labour_payout` is reserved for the
// `CostEntry.CreateLabourPayout(...)` factory invoked from the JobCard
// settlement path. Generic labour expenses originating from this
// payload land as `labour_misc` (see
// `financeCommandService.moneyCategoryToCostCategoryId`). The backend
// `AddCostEntryHandler` enforces this invariant — accepting
// `labour_payout` on this payload from a non-payout source would silently
// violate CEI-I8.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

// The 13 canonical cost-category codes. Order matches:
//   - backend  ssf.cost_categories seed (`CostCategorySeed.All`)
//   - frontend src/clients/mobile-web/src/domain/finance/CostCategory.ts
//     (`COST_CATEGORY_IDS`)
// If you add a 14th code, update ALL three in the same wire-compat bundle.
export const CostCategoryIdEnum = z.enum([
    'labour_payout',
    'labour_misc',
    'seeds',
    'fertilizer',
    'pesticide',
    'irrigation',
    'machinery_rent',
    'equipment',
    'fuel',
    'transport',
    'electricity',
    'packaging',
    'other',
]);

export type CostCategoryIdType = z.infer<typeof CostCategoryIdEnum>;

/**
 * Which way the money moved. THE FARMER'S OWN STATEMENT — never derived.
 *
 * Before this field existed, every money event the farmer recorded travelled
 * as `add_cost_entry` and landed server-side as a `CostEntry`, i.e. an
 * EXPENSE. A ₹50,000 grape sale reconstructed on a new phone as ₹50,000
 * SPENT, and the farmer's profit read back as a loss.
 *
 * `P1` — stated and derived must never impersonate each other. Direction is
 * therefore an explicit field. It is NOT inferred from the sign of `amount`
 * (a negative number is not a direction) and NOT inferred from `categoryId`
 * (a category is not a direction). A producer that does not know the
 * direction must OMIT the field rather than pick one.
 *
 * OPTIONAL on the wire, and absent means UNKNOWN — never "Expense".
 * Every client shipped before this change omits the key entirely, and those
 * clients sent income down this same pipe. Reading their silence as
 * "Expense" would be exactly the guess that caused the defect. `P4` —
 * unknown stays unknown. See the identical reasoning for `scope` in
 * `create_daily_log.zod.ts`.
 */
export const MoneyDirectionEnum = z.enum(['Expense', 'Income']);

export type MoneyDirectionType = z.infer<typeof MoneyDirectionEnum>;

/** How the money changed hands. Mirrors the client `MoneyEvent.paymentMode`. */
export const PaymentModeEnum = z.enum(['Cash', 'UPI', 'Bank', 'Credit']);

export type PaymentModeType = z.infer<typeof PaymentModeEnum>;

const ZLogDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const LocationPayloadSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number(),
    altitude: z.number().optional(),
    capturedAtUtc: z.string().datetime({ offset: true }),
    provider: z.string(),
    permissionState: z.string(),
});

export const AddCostEntryPayload = z.object({
    costEntryId: ZGuid,
    farmId: ZGuid,
    plotId: ZGuid.optional(),
    cropCycleId: ZGuid.optional(),
    categoryId: CostCategoryIdEnum,
    description: z.string(),
    amount: z.number(),
    currencyCode: z.string().min(1),
    entryDate: ZLogDate,
    createdByUserId: ZGuid.optional(),
    location: LocationPayloadSchema.optional(),
    // Which way the money moved. See MoneyDirectionEnum above for why this
    // is a stated field and why absent means UNKNOWN rather than Expense.
    direction: MoneyDirectionEnum.optional(),
    // ── The six fields the client held locally and dropped at the outbox ──
    // boundary. They were on `MoneyEvent` in Dexie and on no wire, so a
    // farmer who reinstalled kept the amount and lost everything that made
    // it checkable: how much of what, at what price, paid how, to whom, and
    // against which photo.
    //
    // Every one is OPTIONAL and absent means NOT STATED. The client must
    // never invent a value to fill the field, and in particular must never
    // compute `amount` from `qty * unitPrice` — a labour expense with no
    // stated total is deliberately not sent rather than multiplied.
    qty: z.number().optional(),
    unit: z.string().optional(),
    unitPrice: z.number().optional(),
    paymentMode: PaymentModeEnum.optional(),
    vendorName: z.string().optional(),
    // Client-side attachment ids the farmer linked to this money event.
    // These are the client's own ids, not server `attachmentId` GUIDs — an
    // attachment may never have been uploaded — so `z.string()`, not ZGuid.
    // An EMPTY array is a statement ("none linked"); absent is "not stated".
    attachments: z.array(z.string()).optional(),
});

export type AddCostEntryPayloadType = z.infer<typeof AddCostEntryPayload>;
