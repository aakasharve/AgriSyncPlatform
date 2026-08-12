/**
 * LABOUR_PHASE2 A1 — the push shape must be able to say what the farmer said.
 *
 * THE LANDMINE THIS CLOSES (L3). `CreateDailyLogPayload` in
 * `application/usecases/sync/CreateDailyLogCommand.ts` is a THIRD, hand-written
 * copy of the create_daily_log payload shape. The canonical one is
 * `sync-contract/schemas/payloads/create_daily_log.zod.ts`; the C# record is
 * generated from it; this one is typed by hand and nothing compiles it against
 * either. CI's contract diff gate does not cover it. So the zod schema, the
 * generated C# and the server allow-list can all be correct at the same time
 * while this file silently sends the previous month's shape, and the first
 * signal is a farmer's log being rejected — or worse, accepted with its
 * location assertion missing.
 *
 * TWO INDEPENDENT GUARDS, deliberately:
 *
 *  1. A TYPE-LEVEL assignability check in BOTH directions against the
 *     zod-inferred type. This runs under `tsc --noEmit` (tsconfig includes
 *     `src`, so this file is compiled), and it is the guard that actually
 *     catches drift — the next time either shape gains, loses or renames a
 *     field, TYPECHECK fails here instead of production failing later.
 *  2. A RUNTIME check that all three scopes survive `validatePayload`, which is
 *     what `MutationQueue.enqueue` calls at the offline boundary. A payload
 *     that fails there throws and the record never leaves the phone — the exact
 *     failure the zod file's own history note records.
 *
 * WHAT THIS FILE DOES NOT CLAIM. A1 makes the interface CAPABLE of carrying a
 * scope; it does not make anything PRODUCE one. `logSyncMutationService.ts` is
 * reserved for Phase 2b and still sends `plotId`/`cropCycleId` only. These
 * fixtures are hand-built payloads, not observed output, and are labelled as
 * such.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect } from 'vitest';
import type { CreateDailyLogPayload } from '../CreateDailyLogCommand';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import type { CreateDailyLogPayloadType } from '../../../../../../../../sync-contract/schemas/payloads/create_daily_log.zod';

// ---------------------------------------------------------------------------
// Guard 1 — type-level, enforced by TYPECHECK, zero runtime cost.
//
// 1a. ASSIGNABILITY, both directions. Catches a shared field whose TYPE or
//     OPTIONALITY diverged, and a field the contract REQUIRES that the twin
//     lacks entirely.
// 1b. KEY SETS. Assignability alone is blind to an OPTIONAL field added on one
//     side — which is exactly how `scope`/`plotIds` drifted: the zod schema
//     gained them as `.optional()` and every existing assignability check kept
//     passing. So the key sets are compared directly.
// ---------------------------------------------------------------------------
type Assignable<From, To> = From extends To ? true : never;

const handWrittenSatisfiesContract: Assignable<CreateDailyLogPayload, CreateDailyLogPayloadType> = true;
const contractSatisfiesHandWritten: Assignable<CreateDailyLogPayloadType, CreateDailyLogPayload> = true;

/**
 * The one field the contract names that this twin deliberately does not send.
 *
 * `operatorUserId` is in the zod schema, in the generated C# record and in
 * `PushSyncBatchHandler`'s allow-list — and is then IGNORED: the handler
 * constructs `CreateDailyLogCommand` with `OperatorUserId: actorUserId` taken
 * from the caller's token (`PushSyncBatchHandler.cs:690`), never from the
 * payload. A client that sent it would be making a no-op claim about who did
 * the work, so omitting it is the truthful shape.
 *
 * Anything else that shows up in this gap is DRIFT, and the two constants below
 * fail the build rather than letting it ship.
 */
type DeliberatelyNotSent = 'operatorUserId';

type ContractFieldsMissingFromTwin = Exclude<
    keyof CreateDailyLogPayloadType,
    keyof CreateDailyLogPayload | DeliberatelyNotSent
>;
type TwinFieldsNotInContract = Exclude<keyof CreateDailyLogPayload, keyof CreateDailyLogPayloadType>;

const noContractFieldIsMissing: [ContractFieldsMissingFromTwin] extends [never] ? true : never = true;
const noFieldIsInvented: [TwinFieldsNotInContract] extends [never] ? true : never = true;

const FARM = 'f1111111-1111-4111-8111-111111111111';
const LOG = 'a1111111-1111-4111-8111-111111111111';
const PLOT_A = 'b1111111-1111-4111-8111-111111111111';
const PLOT_B = 'b2222222-2222-4222-8222-222222222222';
const PLOT_C = 'b3333333-3333-4333-8333-333333333333';
const CYCLE = 'c1111111-1111-4111-8111-111111111111';

/** Hand-built, NOT observed output: nothing produces a scope until Phase 2b. */
const plotScoped: CreateDailyLogPayload = {
    dailyLogId: LOG,
    farmId: FARM,
    scope: 'Plot',
    plotIds: [PLOT_A],
    plotId: PLOT_A,
    cropCycleId: CYCLE,
    logDate: '2026-08-12',
};

const multiPlotScoped: CreateDailyLogPayload = {
    dailyLogId: LOG,
    farmId: FARM,
    scope: 'MultiPlot',
    plotIds: [PLOT_A, PLOT_B, PLOT_C],
    logDate: '2026-08-12',
};

const farmScoped: CreateDailyLogPayload = {
    dailyLogId: LOG,
    farmId: FARM,
    scope: 'Farm',
    plotIds: [],
    logDate: '2026-08-12',
};

/** Exactly what `logSyncMutationService` sends today — no scope key at all. */
const preScopeClient: CreateDailyLogPayload = {
    dailyLogId: LOG,
    farmId: FARM,
    plotId: PLOT_A,
    cropCycleId: CYCLE,
    logDate: '2026-08-12',
};

describe('CreateDailyLogPayload — the hand-written twin of the push contract', () => {
    it('is assignable to and from the canonical zod-inferred shape', () => {
        // The assertion is the compile. These two are `true` only if the
        // declarations above type-checked at all.
        expect(handWrittenSatisfiesContract).toBe(true);
        expect(contractSatisfiesHandWritten).toBe(true);
    });

    it('names every field the contract names, and invents none', () => {
        // This is the guard that would have caught the drift: an OPTIONAL
        // field added to the contract is invisible to assignability.
        expect(noContractFieldIsMissing).toBe(true);
        expect(noFieldIsInvented).toBe(true);
    });

    it('carries a Plot log past the offline boundary, exactly as before', () => {
        expect(validatePayload(SyncMutationName.CreateDailyLog, plotScoped)).toEqual({ ok: true });
    });

    it('carries a MultiPlot log — three plots, no plotId, no cropCycleId', () => {
        // The record the client could not express before: the farmer named
        // three plots, and neither a single plotId nor a crop cycle is a
        // truthful answer for it.
        expect(validatePayload(SyncMutationName.CreateDailyLog, multiPlotScoped)).toEqual({ ok: true });
    });

    it('carries a Farm log — the EMPTY plot set is the assertion, not a gap', () => {
        expect(validatePayload(SyncMutationName.CreateDailyLog, farmScoped)).toEqual({ ok: true });
    });

    it('still carries a payload with no scope key at all', () => {
        // Absent scope means `Plot` (create_daily_log.zod.ts:84-89). Every
        // client shipped before P2.2 omits it, and a payload that fails
        // validation throws at MutationQueue.enqueue — the record never leaves
        // the phone. Widening the interface must not break them.
        expect(validatePayload(SyncMutationName.CreateDailyLog, preScopeClient)).toEqual({ ok: true });
    });

    it('rejects a scope the contract does not name', () => {
        // Guards the literal union: the strings are load-bearing
        // (ck_daily_logs_scope compares against these exact three), so a
        // typo has to fail here rather than at the database.
        const bogus = { ...plotScoped, scope: 'Plots' };

        expect(validatePayload(SyncMutationName.CreateDailyLog, bogus).ok).toBe(false);
    });
});
