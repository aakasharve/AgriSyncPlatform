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

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const logWith = (labour: unknown[]): DailyLog => ({
    id: 'log-1',
    date: '2026-08-11',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'] }] },
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
