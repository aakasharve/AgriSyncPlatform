/**
 * The money wire must be able to say WHICH WAY the money moved.
 *
 * THE DEFECT THIS CLOSES. Every money event the farmer recorded — income and
 * expense alike — went to the server as `add_cost_entry`, and the server's
 * `AddCostEntryHandler` creates a `CostEntry`: an EXPENSE. There was no
 * direction anywhere in the chain, so a farmer who sold ₹50,000 of grapes had
 * that reconstructed, on a new phone, as ₹50,000 he SPENT. His profit read back
 * as a loss.
 *
 * THE LANDMINE, restated (see `CreateDailyLogPayload.scope.test.ts`, which
 * closes the same one for create_daily_log). `AddCostEntryPayload` in
 * `AddCostEntryCommand.ts` is a hand-written THIRD copy of the wire shape. The
 * canonical one is `sync-contract/schemas/payloads/add_cost_entry.zod.ts`; the
 * C# record is generated from it; this one is typed by hand and nothing
 * compiles it against either. So the zod schema, the generated C# and the
 * server allow-list can all agree while this file silently sends last month's
 * shape.
 *
 * TWO INDEPENDENT GUARDS, deliberately:
 *
 *  1. TYPE-LEVEL key-set + assignability checks against the zod-inferred type.
 *     These run under `tsc --noEmit`, and they are what actually catches drift.
 *  2. RUNTIME checks through the real `validatePayload` — what
 *     `MutationQueue.enqueue` calls at the offline boundary. A payload that
 *     fails there throws and the record never leaves the phone.
 *
 * WHAT THIS FILE DOES NOT CLAIM. It proves the SHAPE can carry a direction and
 * that both values survive the boundary. It does not prove the server persists
 * it; that is asserted elsewhere. The payload fixtures below are hand-built,
 * not observed output, and are labelled as such.
 *
 * spec: 2026-08-14-FOUNDER-DECISIONS-launch-cohort-and-scope
 */
import { describe, it, expect } from 'vitest';
import type { AddCostEntryPayload } from '../AddCostEntryCommand';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import type { AddCostEntryPayloadType } from '../../../../../../../../sync-contract/schemas/payloads/add_cost_entry.zod';

// ---------------------------------------------------------------------------
// Guard 1 — type-level, enforced by TYPECHECK, zero runtime cost.
// ---------------------------------------------------------------------------
type Assignable<From, To> = From extends To ? true : never;

/**
 * The ONE deliberate asymmetry between this twin and the canonical schema.
 *
 * `direction` is OPTIONAL in zod and REQUIRED here. Optional on the wire
 * because every client shipped before this change omits the key and their
 * silence has to read as UNKNOWN — reading it as "Expense" is the exact guess
 * that produced the defect. Required in the twin because THIS client always
 * knows: every call site starts from a `MoneyEvent` whose `type` is the
 * farmer's own statement. A new money surface must not compile without saying
 * which way the money went.
 *
 * Anything else that diverges is DRIFT and fails the build below.
 */
type WireWithDirectionStated = AddCostEntryPayloadType &
    Required<Pick<AddCostEntryPayloadType, 'direction'>>;

// 1a. ASSIGNABILITY, both directions (with the stated asymmetry applied).
//     Catches a shared field whose TYPE diverged.
const twinSatisfiesContract: Assignable<AddCostEntryPayload, AddCostEntryPayloadType> = true;
const contractSatisfiesTwin: Assignable<WireWithDirectionStated, AddCostEntryPayload> = true;

// 1b. KEY SETS. Assignability alone is blind to an OPTIONAL field added on one
//     side — which is precisely how six fields sat in the local model and on no
//     wire for months. So the key sets are compared directly.
type ContractFieldsMissingFromTwin = Exclude<
    keyof AddCostEntryPayloadType,
    keyof AddCostEntryPayload
>;
type TwinFieldsNotInContract = Exclude<
    keyof AddCostEntryPayload,
    keyof AddCostEntryPayloadType
>;

const noContractFieldIsMissing: [ContractFieldsMissingFromTwin] extends [never] ? true : never = true;
const noFieldIsInvented: [TwinFieldsNotInContract] extends [never] ? true : never = true;

// 1c. `direction` must not acquire an 'Unknown' member. Unknown is a property
//     of a READ — a row that never carried a statement — never of a write.
type DirectionCannotSayUnknown = 'Unknown' extends AddCostEntryPayload['direction'] ? never : true;
const directionHasNoUnknownMember: DirectionCannotSayUnknown = true;

const FARM = 'f1111111-1111-4111-8111-111111111111';
const ENTRY = 'a1111111-1111-4111-8111-111111111111';
const PLOT = 'b1111111-1111-4111-8111-111111111111';

/** Hand-built, NOT observed output. */
const base: AddCostEntryPayload = {
    costEntryId: ENTRY,
    farmId: FARM,
    plotId: PLOT,
    categoryId: 'fertilizer',
    description: 'Urea, two bags',
    amount: 1200,
    currencyCode: 'INR',
    entryDate: '2026-08-15',
    direction: 'Expense',
};

const income: AddCostEntryPayload = { ...base, direction: 'Income', amount: 50000 };

const fullyDetailed: AddCostEntryPayload = {
    ...base,
    qty: 12,
    unit: 'kg',
    unitPrice: 90,
    paymentMode: 'UPI',
    vendorName: 'Patil Agro Centre',
    attachments: ['att-1'],
};

/** Exactly what a client shipped before this change sends: no direction key. */
const preDirectionClient = {
    costEntryId: ENTRY,
    farmId: FARM,
    plotId: PLOT,
    categoryId: 'fertilizer',
    description: 'Urea, two bags',
    amount: 1200,
    currencyCode: 'INR',
    entryDate: '2026-08-15',
};

describe('AddCostEntryPayload — the hand-written twin of the money wire', () => {
    it('is assignable to and from the canonical zod-inferred shape', () => {
        // The assertion is the compile. These are `true` only if the
        // declarations above type-checked at all.
        expect(twinSatisfiesContract).toBe(true);
        expect(contractSatisfiesTwin).toBe(true);
    });

    it('names every field the contract names, and invents none', () => {
        expect(noContractFieldIsMissing).toBe(true);
        expect(noFieldIsInvented).toBe(true);
    });

    it('cannot express an "Unknown" direction on a write', () => {
        expect(directionHasNoUnknownMember).toBe(true);
    });

    it('carries an Expense past the offline boundary', () => {
        expect(validatePayload(SyncMutationName.AddCostEntry, base)).toEqual({ ok: true });
    });

    it('carries an Income past the offline boundary', () => {
        expect(validatePayload(SyncMutationName.AddCostEntry, income)).toEqual({ ok: true });
    });

    it('makes an Income payload distinguishable from an Expense one', () => {
        // ₹50,000 earned and ₹50,000 spent are opposite facts. Before
        // `direction` they serialised identically.
        expect(JSON.stringify(base)).not.toEqual(
            JSON.stringify({ ...income, amount: base.amount }),
        );
    });

    it('carries all six line-detail fields past the offline boundary', () => {
        expect(validatePayload(SyncMutationName.AddCostEntry, fullyDetailed)).toEqual({ ok: true });
    });

    it('still carries a payload with no direction key at all', () => {
        // Absent means UNKNOWN, and validation must not reject it: a payload
        // that fails here throws at MutationQueue.enqueue and the record never
        // leaves the phone. Widening the contract must not strand old clients.
        expect(validatePayload(SyncMutationName.AddCostEntry, preDirectionClient)).toEqual({ ok: true });
    });

    it('rejects a direction the contract does not name', () => {
        // Guards the literal union. `Unknown` is the important case: it is a
        // read-side state, and a producer must never assert it.
        expect(validatePayload(SyncMutationName.AddCostEntry, { ...base, direction: 'Unknown' }).ok).toBe(false);
        expect(validatePayload(SyncMutationName.AddCostEntry, { ...base, direction: 'expense' }).ok).toBe(false);
    });

    it('rejects a paymentMode the contract does not name', () => {
        expect(validatePayload(SyncMutationName.AddCostEntry, { ...base, paymentMode: 'Cheque' }).ok).toBe(false);
    });
});
