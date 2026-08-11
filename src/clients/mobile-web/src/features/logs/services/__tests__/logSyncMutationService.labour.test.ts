// spec: 2026-07-13-labour-attendance-approval-design (Labour V1 Task 8.1)
//
// THE GATE THIS LOCKS. The server stages labour as canonical Phase-1 data —
// atomic with the DailyLog — only when the confirm carries a structured
// `labour[]`. With no client producer, every confirmed labour row was written
// in Phase 2, the best-effort side-car, whose failure branches catch the
// exception, log a warning and return success: the log commits, the labour rows
// vanish, and the idempotency early-return hands back the existing log on every
// retry. There is no backfill job in this system. So "the confirm path sends
// structured labour" is not a payload detail, it is the condition that keeps a
// farmer's labour record from silently ceasing to exist — hence a test.
//
// It also pins the ABSENCE of `durationHours`. Absent is how the client says
// "the farmer did not state hours", and the server then honestly records
// Assumed. A `0`, or a key present with value `undefined` that a future
// serializer might coerce, would be a fabricated measurement — the exact thing
// this plan exists to remove — so the assertions below check key PRESENCE via
// `Object.prototype.hasOwnProperty`, not just the value.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DailyLog } from '../../../../types';

const { enqueueCreate, enqueueTask, plotsGet, cropCyclesWhere, triggerNow } = vi.hoisted(() => ({
    enqueueCreate: vi.fn(),
    enqueueTask: vi.fn(),
    plotsGet: vi.fn(),
    cropCyclesWhere: vi.fn(),
    triggerNow: vi.fn(),
}));

vi.mock('../../../../application/usecases/sync/CreateDailyLogCommand', () => ({
    CreateDailyLogCommand: { enqueue: enqueueCreate },
}));

vi.mock('../../../../application/usecases/sync/AddLogTaskCommand', () => ({
    AddLogTaskCommand: { enqueue: enqueueTask },
}));

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        plots: { get: plotsGet },
        cropCycles: { where: cropCyclesWhere },
    }),
}));

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow },
}));

import { enqueueLogsForSync } from '../logSyncMutationService';
// NOT mocked, deliberately — this is the real canonical validator.
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
// The canonical schema pins dailyLogId/farmId/plotId/cropCycleId as ZGuid, so
// the schema-conformance test below needs real UUIDs where production has them.
const LOG_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FARM_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLOT_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CYCLE_UUID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const logWith = (labour: unknown[], id = 'log-1', plotId = 'p1'): DailyLog => ({
    id,
    date: '2026-08-11',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: [plotId] }] },
    cropActivities: [],
    irrigation: [],
    labour,
    inputs: [],
    machinery: [],
    meta: { createdAtISO: '2026-08-11T04:00:00.000Z' },
} as unknown as DailyLog);

const sentLabour = () => enqueueCreate.mock.calls[0][0].labour;

describe('enqueueLogsForSync — structured labour payload (Task 8.1)', () => {
    beforeEach(() => {
        enqueueCreate.mockReset().mockResolvedValue('m1');
        enqueueTask.mockReset().mockResolvedValue('m2');
        triggerNow.mockReset().mockResolvedValue(undefined);
        plotsGet.mockReset().mockResolvedValue({ payload: { id: 'p1', farmId: 'farm-1' } });
        cropCyclesWhere.mockReset().mockReturnValue({
            equals: () => ({
                toArray: async () => [{ payload: { id: 'cc-1', cropName: 'Grapes', modifiedAtUtc: '2026-08-01T00:00:00Z' } }],
            }),
        });
    });

    it('carries every structured field on create_daily_log instead of a free-text note', async () => {
        await enqueueLogsForSync([logWith([{
            id: 'l1',
            labourAssignmentId: UUID_A,
            type: 'CONTRACT',
            engagementType: 'contract_piece',
            count: 6,
            maleCount: 4,
            femaleCount: 2,
            wagePerPerson: 350,
            contractUnit: 'Acre',
            contractQuantity: 2,
            totalCost: 3000,
            shiftId: 'full',
            activity: 'छाटणी',
            notes: 'मुकादमामार्फत',
            durationHours: 6,
        }])]);

        expect(sentLabour()).toEqual([{
            labourAssignmentId: UUID_A,
            engagementType: 'contract_piece',
            maleCount: 4,
            femaleCount: 2,
            workerCount: 6,
            wagePerPerson: 350,
            contractUnit: 'Acre',
            contractQuantity: 2,
            totalCost: 3000,
            shift: 'full',
            task: 'छाटणी',
            notes: 'मुकादमामार्फत',
            durationHours: 6,
        }]);
    });

    it('OMITS durationHours entirely when the farmer did not state hours — never 0, never a present key', async () => {
        await enqueueLogsForSync([logWith([
            { id: 'l1', labourAssignmentId: UUID_A, type: 'HIRED', count: 4, totalCost: 1600 },
            { id: 'l2', labourAssignmentId: UUID_B, type: 'HIRED', count: 2, durationHours: 0 },
        ])]);

        const [unstated, zeroed] = sentLabour();
        expect(Object.prototype.hasOwnProperty.call(unstated, 'durationHours')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(zeroed, 'durationHours')).toBe(false);
        // And it survives the wire, not just the object literal.
        expect(JSON.stringify(sentLabour())).not.toContain('durationHours');
    });

    it('sends a stated duration through as Explicit-eligible when the farmer DID state hours', async () => {
        await enqueueLogsForSync([logWith([
            { id: 'l1', labourAssignmentId: UUID_A, type: 'HIRED', count: 4, durationHours: 5.5 },
        ])]);

        expect(sentLabour()[0].durationHours).toBe(5.5);
    });

    it('folds the legacy HIRED/CONTRACT/SELF type into engagementType — the server passes null for the legacy arg', async () => {
        await enqueueLogsForSync([logWith([
            { id: 'l1', labourAssignmentId: UUID_A, type: 'CONTRACT', count: 3 },
        ])]);

        // Without this fold a contract engagement would silently record as Hired.
        expect(sentLabour()[0].engagementType).toBe('CONTRACT');
    });

    it('never lets a missing labourAssignmentId reach the server, which rejects it and would 400 the whole log', async () => {
        await enqueueLogsForSync([logWith([{ id: 'l1', type: 'HIRED', count: 3 }])]);

        expect(sentLabour()[0].labourAssignmentId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
    });

    it('stops emitting the flattened "Workers: N / Cost: ₹X" log_task note for labour', async () => {
        await enqueueLogsForSync([logWith([
            { id: 'l1', labourAssignmentId: UUID_A, type: 'HIRED', count: 6, totalCost: 3000, activity: 'छाटणी' },
        ])]);

        expect(enqueueTask).not.toHaveBeenCalled();
    });

    it('omits labour entirely (not an empty array) when the log has none', async () => {
        await enqueueLogsForSync([logWith([])]);

        expect(sentLabour()).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Fix round 1 — THE PAYLOAD MUST NEVER BE MALFORMED.
//
// `MutationQueue.enqueue` validates every payload against
// sync-contract/schemas/payloads/create_daily_log.zod.ts and THROWS on failure
// (MutationQueue.ts:58-64). Before this task `create_daily_log` never carried
// labour, so labour numbers were never validated; now they are, against
// `z.number()` (rejects NaN and ±Infinity) and `z.number().int()` (rejects
// 2.5) — verified against the shipped zod 4.3.6, not assumed.
//
// The values arrive unsanitised: DetailSheet writes `totalCost` and
// `contractQuantity` with a bare `parseFloat(e.target.value)` and no fallback
// (`:297`, `:327`, `:338`), and `parseFloat('')` is NaN — so simply CLEARING a
// money field produces one. ManualEntry's negative-cost guard uses
// `l.totalCost || 0`, and NaN is falsy, so it passes silently.
//
// `enqueueLogsForSync` has no try/catch, so a throw would surface as a generic
// "Failed to save logs" with the log already in Dexie but NO mutation row ever
// written — nothing queued, nothing to retry, and on a multi-plot broadcast
// every later log in the batch abandoned. The labour would reach NEITHER Phase
// 1 nor Phase 2: strictly worse than the side-car this task replaced. These
// tests assert the log still ENQUEUES, which is the part that matters.
// ---------------------------------------------------------------------------

describe('enqueueLogsForSync — a malformed labour number must never block the log', () => {
    beforeEach(() => {
        enqueueCreate.mockReset().mockResolvedValue('m1');
        enqueueTask.mockReset().mockResolvedValue('m2');
        triggerNow.mockReset().mockResolvedValue(undefined);
        plotsGet.mockReset().mockResolvedValue({ payload: { id: 'p1', farmId: 'farm-1' } });
        cropCyclesWhere.mockReset().mockReturnValue({
            equals: () => ({
                toArray: async () => [{ payload: { id: 'cc-1', cropName: 'Grapes', modifiedAtUtc: '2026-08-01T00:00:00Z' } }],
            }),
        });
    });

    it('still enqueues the log when totalCost is NaN and maleCount is fractional, dropping only the bad keys', async () => {
        const result = await enqueueLogsForSync([logWith([{
            id: 'l1',
            labourAssignmentId: UUID_A,
            type: 'HIRED',
            maleCount: 2.5,          // "2.5" typed into the type="number" Male Split
            femaleCount: 1,          // valid — must survive
            totalCost: NaN,          // the cleared "Total Paid" field
            contractQuantity: NaN,   // the cleared "Quantity" field
        }])]);

        // THE LOG IS NOT LOST. This is the assertion the regression was about.
        expect(result.queuedLogIds).toEqual(['log-1']);
        expect(result.skippedLogIds).toEqual([]);
        expect(enqueueCreate).toHaveBeenCalledTimes(1);
        expect(triggerNow).toHaveBeenCalledTimes(1);

        const [item] = sentLabour();
        // Bad keys ABSENT, not present-and-invalid.
        expect(Object.prototype.hasOwnProperty.call(item, 'totalCost')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(item, 'contractQuantity')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(item, 'maleCount')).toBe(false);
        // The valid sibling on the same event is untouched.
        expect(item.femaleCount).toBe(1);
        expect(JSON.stringify(sentLabour())).not.toContain('null');
    });

    it('drops ±Infinity on every numeric field the wire schema constrains', async () => {
        await enqueueLogsForSync([logWith([{
            id: 'l1',
            labourAssignmentId: UUID_A,
            type: 'HIRED',
            count: Infinity,
            femaleCount: -Infinity,
            wagePerPerson: Infinity,
            contractQuantity: -Infinity,
            totalCost: Infinity,
            durationHours: Infinity,
        }])]);

        const [item] = sentLabour();
        for (const key of ['workerCount', 'femaleCount', 'wagePerPerson', 'contractQuantity', 'totalCost', 'durationHours']) {
            expect(Object.prototype.hasOwnProperty.call(item, key)).toBe(false);
        }
        // The two required fields still make it, so the row is still valid.
        expect(item.labourAssignmentId).toBe(UUID_A);
        expect(item.engagementType).toBe('HIRED');
    });

    it('never rounds a fractional count into a headcount the farmer did not state', async () => {
        await enqueueLogsForSync([logWith([
            { id: 'l1', labourAssignmentId: UUID_A, type: 'HIRED', count: 2.5, maleCount: 1.5, femaleCount: 0.5 },
        ])]);

        // Key absence proves no value at all was sent for these fields, so
        // silence ("we were not told") is preserved rather than a fabricated
        // rounded headcount, which the server would store as canonical.
        const wire = JSON.stringify(sentLabour());
        expect(wire).not.toContain('workerCount');
        expect(wire).not.toContain('maleCount');
        expect(wire).not.toContain('femaleCount');
    });

    it('always sends the REQUIRED engagementType, which the schema does not allow to be absent', async () => {
        // A legacy Dexie record with neither engagementType nor the legacy
        // `type` would otherwise send `undefined` for a required string and
        // throw at the queue — the same class of bug as the numbers.
        await enqueueLogsForSync([logWith([{ id: 'l1', labourAssignmentId: UUID_A, count: 3 }])]);

        // The server's total map turns anything unrecognised into Hired anyway,
        // so this is byte-identical server state, not an invented engagement.
        expect(sentLabour()[0].engagementType).toBe('hired_daily');
    });

    // THE STRONGEST PROOF IN THIS FILE. Everything above mocks the queue, so it
    // asserts the SHAPE we send. This runs the payload through the REAL
    // `validatePayload` — the same canonical zod schema `MutationQueue.enqueue`
    // uses — so it fails if the contract and this mapper ever drift, rather
    // than only if my idea of the contract drifts.
    it('produces a payload the CANONICAL create_daily_log schema accepts, even from all-malformed input', async () => {
        // Realistic ids: production dailyLogId/farmId/plotId/cropCycleId are all
        // server UUIDs, and the schema pins them as ZGuid.
        plotsGet.mockResolvedValue({ payload: { id: PLOT_UUID, farmId: FARM_UUID } });
        cropCyclesWhere.mockReturnValue({
            equals: () => ({
                toArray: async () => [{ payload: { id: CYCLE_UUID, cropName: 'Grapes', modifiedAtUtc: '2026-08-01T00:00:00Z' } }],
            }),
        });

        await enqueueLogsForSync([logWith([
            { id: 'l1', labourAssignmentId: UUID_A, type: 'HIRED', maleCount: 2.5, totalCost: NaN, contractQuantity: NaN, durationHours: NaN },
            { id: 'l2', type: 'CONTRACT', count: Infinity, wagePerPerson: NaN, contractUnit: 'Acre' },
            { id: 'l3', labourAssignmentId: UUID_B, count: 4, totalCost: 1600, durationHours: 6 },
        ], LOG_UUID, PLOT_UUID)]);

        const payload = enqueueCreate.mock.calls[0][0];

        // (a) the RAW in-memory object, which is exactly what
        //     `MutationQueue.enqueue` passes to `validatePayload` before it
        //     throws — the precise call that the regression tripped.
        expect(validatePayload(SyncMutationName.CreateDailyLog, payload)).toEqual({ ok: true });

        // (b) the JSON round-trip, which is what actually reaches the server
        //     after Dexie and fetch. Worth checking separately: JSON.stringify
        //     turns NaN into `null`, and `z.number()` rejects null too — so an
        //     unsanitised payload fails here even if it somehow passed (a).
        expect(validatePayload(SyncMutationName.CreateDailyLog, JSON.parse(JSON.stringify(payload)))).toEqual({ ok: true });
    });

    it('keeps a whole zero — an explicitly stated 0 is data, not a malformed value', async () => {
        await enqueueLogsForSync([logWith([
            { id: 'l1', labourAssignmentId: UUID_A, type: 'HIRED', maleCount: 0, femaleCount: 0, count: 0, totalCost: 0 },
        ])]);

        const [item] = sentLabour();
        expect(item.maleCount).toBe(0);
        expect(item.femaleCount).toBe(0);
        expect(item.workerCount).toBe(0);
        expect(item.totalCost).toBe(0);
    });
});
