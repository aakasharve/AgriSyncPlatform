/**
 * UpdateLog — Labour V1 Task 12b.7 + 12b.7b,
 * spec: 2026-07-13-labour-attendance-approval-design
 *
 * Two things this file locks:
 *
 * 1. 12b.7 — the LABOUR portion of an edit reaches the Task 12b correction
 *    route, with only the CHANGED fields on the body and unstated ones omitted.
 *
 * 2. 12b.7b — editing a log enqueues NO `add_log_task` mutation. That enqueue
 *    was permanently rejected server-side (`PayloadHasOnly(payload, "logTaskId",
 *    "dailyLogId", "activityType", "notes", "occurredAtUtc")` versus a payload
 *    of `{dailyLogId, action, updatedData, reason, actorId}` — four unknown
 *    keys, three required ones missing), so every log edit a farmer made queued
 *    a mutation that could only ever fail. This is the regression test that
 *    stops it coming back underneath a correction call that now works.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnqueue = vi.fn();
vi.mock('../../../infrastructure/sync/MutationQueue', () => ({
    mutationQueue: { enqueue: (...args: unknown[]) => mockEnqueue(...args) },
}));

const mockPostCorrection = vi.fn();
vi.mock('../../../features/labour/data/labourCorrectionsClient', () => ({
    postLabourCorrection: (...args: unknown[]) => mockPostCorrection(...args),
}));

const mockResolveFarmId = vi.fn();
vi.mock('../../../features/logs/services/logSyncMutationService', () => ({
    resolveLogFarmId: (...args: unknown[]) => mockResolveFarmId(...args),
    wholeOrOmitted: (value: number | undefined) =>
        typeof value === 'number' && Number.isInteger(value) ? value : undefined,
    finiteOrOmitted: (value: number | undefined) =>
        typeof value === 'number' && Number.isFinite(value) ? value : undefined,
}));

import { updateLog, buildLabourCorrections } from '../UpdateLog';
import type { DailyLog, LabourEvent } from '../../../domain/types/log.types';
import type { FarmerProfile } from '../../../domain/types/farm.types';
import type { LogsRepository } from '../../ports';

const FARM_ID = 'farm-1';
const ASSIGNMENT_ID = '11111111-1111-1111-1111-111111111111';

function makeLabour(overrides: Partial<LabourEvent> = {}): LabourEvent {
    return {
        id: 'lab-0',
        type: 'HIRED',
        labourAssignmentId: ASSIGNMENT_ID,
        count: 8,
        ...overrides,
    };
}

function makeLog(labour: LabourEvent[]): DailyLog {
    return {
        id: 'log-1',
        date: '2026-08-10',
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour,
        inputs: [],
        machinery: [],
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            grandTotal: 0,
        },
    } as unknown as DailyLog;
}

/**
 * LABOUR_PHASE2 PHASE 4 — `save` is now part of this use case's contract, so the
 * double is no longer a bare `getById`. `calls` order matters to one test below
 * and is asserted through `mock.invocationCallOrder`.
 */
function makeRepo(log: DailyLog): LogsRepository & { save: ReturnType<typeof vi.fn> } {
    return {
        getById: vi.fn().mockResolvedValue(log),
        save: vi.fn().mockResolvedValue(undefined),
    } as unknown as LogsRepository & { save: ReturnType<typeof vi.fn> };
}

const actor = { id: 'user-1' } as unknown as FarmerProfile;

beforeEach(() => {
    vi.clearAllMocks();
    mockResolveFarmId.mockResolvedValue(FARM_ID);
    mockPostCorrection.mockResolvedValue({
        labourAssignmentId: ASSIGNMENT_ID,
        workerCount: 6,
        maleCount: null,
        femaleCount: null,
        durationHours: 8,
        timeBasis: 'Assumed',
        attributedFieldOperatorIds: [],
        correctionsRecorded: 1,
        alreadyApplied: false,
    });
});

describe('updateLog — Task 12b.7 labour corrections', () => {
    it('sends the labour portion of an edit to the correction route and enqueues NO add_log_task', async () => {
        const existing = makeLog([makeLabour({ count: 8 })]);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'user-1',
                reason: 'मोजून पाहिलं',
            },
            makeRepo(existing),
            actor,
        );

        expect(result.success).toBe(true);
        expect(mockPostCorrection).toHaveBeenCalledTimes(1);

        // Labour Phase 2 / T2 (review round 1, finding B2) — the caller's ONLY
        // evidence that anything reached a server. `success: true` is returned
        // just as readily by an edit that persisted nothing, so without this
        // number `useLogCommands` cannot tell the two apart and tells a farmer
        // whose correction the server ACCEPTED that it "is not saved anywhere".
        // A false alarm on a real success is as damaging as a false success.
        expect(result.persistedLabourCorrections).toBe(1);

        const [farmId, assignmentId, request] = mockPostCorrection.mock.calls[0];
        expect(farmId).toBe(FARM_ID);
        expect(assignmentId).toBe(ASSIGNMENT_ID);
        expect(request.quantity).toEqual({ workerCount: 6 });
        expect(request.clientRequestId).toEqual(expect.any(String));
        expect(request.reason).toBe('मोजून पाहिलं');
        // Silence about hours must not travel — omitting the key is what leaves
        // the server's `Assumed` duration untouched.
        expect(request).not.toHaveProperty('durationHours');

        // 12b.7b — the permanently-rejected mutation is gone and must stay gone.
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('reports failure instead of a success toast when the correction cannot be persisted', async () => {
        mockPostCorrection.mockRejectedValue(new Error('Request failed with status code 403'));
        const existing = makeLog([makeLabour({ count: 8 })]);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'user-1',
                reason: 'edit',
            },
            makeRepo(existing),
            actor,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('403');
    });

    it('refuses to claim success when the log has no resolvable farm', async () => {
        mockResolveFarmId.mockResolvedValue(null);
        const existing = makeLog([makeLabour({ count: 8 })]);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'user-1',
                reason: 'edit',
            },
            makeRepo(existing),
            actor,
        );

        expect(result.success).toBe(false);
        expect(mockPostCorrection).not.toHaveBeenCalled();
    });

    it('posts nothing when the labour did not change', async () => {
        const existing = makeLog([makeLabour({ count: 8 })]);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 8 })] },
                actorId: 'user-1',
                reason: 'edit',
            },
            makeRepo(existing),
            actor,
        );

        expect(result.success).toBe(true);
        expect(mockPostCorrection).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
        // Nothing was POSTed. Zero is what forbids the caller claiming a SERVER
        // outcome — it says nothing about the local write, which happens either
        // way (see the Phase 4 block below).
        expect(result.persistedLabourCorrections).toBe(0);
    });

    it('counts every accepted correction, so the caller can name the real number', async () => {
        // T2 / B2 — two engagements, both changed, both accepted. Locks the
        // count to what was actually POSTed rather than to a boolean.
        const second = '33333333-3333-3333-3333-333333333333';
        const existing = makeLog([
            makeLabour({ count: 8 }),
            makeLabour({ id: 'lab-1', labourAssignmentId: second, count: 4 }),
        ]);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: {
                    labour: [
                        makeLabour({ count: 6 }),
                        makeLabour({ id: 'lab-1', labourAssignmentId: second, count: 3 }),
                    ],
                },
                actorId: 'user-1',
                reason: 'edit',
            },
            makeRepo(existing),
            actor,
        );

        expect(result.success).toBe(true);
        expect(mockPostCorrection).toHaveBeenCalledTimes(2);
        expect(result.persistedLabourCorrections).toBe(2);
    });

    it('reports no persisted corrections when the POST failed', async () => {
        // T2 / B2 — a rejected correction must never leave a count behind that
        // a caller could read as evidence.
        mockPostCorrection.mockRejectedValue(new Error('Request failed with status code 403'));
        const existing = makeLog([makeLabour({ count: 8 })]);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'user-1',
                reason: 'edit',
            },
            makeRepo(existing),
            actor,
        );

        expect(result.success).toBe(false);
        expect(result.persistedLabourCorrections).toBeUndefined();
    });
});

/**
 * LABOUR_PHASE2 PHASE 4 (§A7.1) — the correction must reach Dexie.
 *
 * Until Phase 4 this use case called `repo.getById` and never `repo.save`, and
 * its caller's `setHistory` is React state with no persist subscriber. A farmer
 * corrected 8 to 6, the server accepted it, and the next reload showed 8 again.
 */
describe('updateLog — Phase 4: the edit reaches the local ledger', () => {
    it('writes the corrected record to the repository', async () => {
        const existing = makeLog([makeLabour({ count: 8 })]);
        const repo = makeRepo(existing);

        await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'user-1',
                reason: 'मोजून पाहिलं',
            },
            repo,
            actor,
        );

        expect(repo.save).toHaveBeenCalledTimes(1);
        const [saved] = repo.save.mock.calls[0];
        expect(saved.id).toBe('log-1');
        expect(saved.labour[0].count).toBe(6);
    });

    it('carries the actor and the reason, so the audit row can say who and why', async () => {
        // `P3` — a correction is never a silent mutation.
        // `DexieLogsRepository.save` turns this context into one append-only
        // `db.auditEvents` row, in the same transaction as the record write.
        const existing = makeLog([makeLabour({ count: 8 })]);
        const repo = makeRepo(existing);

        await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'mukadam-7',
                reason: 'मोजून पाहिलं',
            },
            repo,
            actor,
        );

        expect(repo.save.mock.calls[0][1]).toEqual({
            actorId: 'mukadam-7',
            reason: 'मोजून पाहिलं',
        });
    });

    it('persists an edit that changed no labour at all', async () => {
        // The edit that used to evaporate with nothing said about it: a farmer
        // fixes an irrigation figure, there is no correction to POST, and before
        // Phase 4 the whole edit died on the next reload.
        const existing = makeLog([makeLabour({ count: 8 })]);
        const repo = makeRepo(existing);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: { date: '2026-08-11' },
                actorId: 'user-1',
                reason: 'edit',
            },
            repo,
            actor,
        );

        expect(result.success).toBe(true);
        expect(mockPostCorrection).not.toHaveBeenCalled();
        expect(repo.save).toHaveBeenCalledTimes(1);
        expect(repo.save.mock.calls[0][0].date).toBe('2026-08-11');
    });

    it('saves AFTER the server answered, never before it', async () => {
        // Order is load-bearing. Saving first would leave 6 on the phone while
        // the server still held 8 whenever the POST was refused — the same
        // divergence §A7.1 exists to end, with the signs flipped.
        const existing = makeLog([makeLabour({ count: 8 })]);
        const repo = makeRepo(existing);

        await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'user-1',
                reason: 'edit',
            },
            repo,
            actor,
        );

        expect(mockPostCorrection.mock.invocationCallOrder[0])
            .toBeLessThan(repo.save.mock.invocationCallOrder[0]);
    });

    it('writes NOTHING locally when the correction was refused', async () => {
        mockPostCorrection.mockRejectedValue(new Error('Request failed with status code 403'));
        const existing = makeLog([makeLabour({ count: 8 })]);
        const repo = makeRepo(existing);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'user-1',
                reason: 'edit',
            },
            repo,
            actor,
        );

        expect(result.success).toBe(false);
        expect(repo.save).not.toHaveBeenCalled();
    });

    it('writes nothing locally when the log has no resolvable farm', async () => {
        // The early return above the POST loop. A correction that cannot even be
        // addressed must not leave the phone claiming it landed.
        mockResolveFarmId.mockResolvedValue(null);
        const existing = makeLog([makeLabour({ count: 8 })]);
        const repo = makeRepo(existing);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'user-1',
                reason: 'edit',
            },
            repo,
            actor,
        );

        expect(result.success).toBe(false);
        expect(repo.save).not.toHaveBeenCalled();
    });

    it('reports failure, not success, when the local write itself throws', async () => {
        const existing = makeLog([makeLabour({ count: 8 })]);
        const repo = makeRepo(existing);
        repo.save.mockRejectedValue(new Error('QuotaExceededError'));

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'user-1',
                reason: 'edit',
            },
            repo,
            actor,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('QuotaExceededError');
    });

    it('P7: correcting attribution alone never changes the reported headcount', async () => {
        // Eight workers with three people named is still eight. Attribution is
        // an overlay on a reported quantity, never a replacement — naming people
        // must not shrink the number, in the POST or in what is written locally.
        const existing = makeLog([makeLabour({ count: 8, attributedOperators: [] })]);
        const repo = makeRepo(existing);

        const result = await updateLog(
            {
                logId: 'log-1',
                updatedData: {
                    labour: [makeLabour({
                        count: 8,
                        attributedOperators: [
                            { fieldOperatorId: 'op-a', displayNameAtAttach: 'रमेश' },
                            { fieldOperatorId: 'op-b', displayNameAtAttach: 'सीता' },
                            { fieldOperatorId: 'op-c', displayNameAtAttach: 'गणेश' },
                        ],
                    })],
                },
                actorId: 'user-1',
                reason: 'नावं जोडली',
            },
            repo,
            actor,
        );

        expect(result.success).toBe(true);
        // No quantity changed, so no quantity correction travels.
        expect(mockPostCorrection).not.toHaveBeenCalled();
        const [saved] = repo.save.mock.calls[0];
        expect(saved.labour[0].count).toBe(8);
        expect(saved.labour[0].attributedOperators).toHaveLength(3);
    });

    it('P3: appends to the patch history of a verified log and overwrites none of it', async () => {
        // The before-snapshot is history; the record is current truth. Editing a
        // verified log must add to the first without disturbing what is already
        // there.
        const existing = makeLog([makeLabour({ count: 8 })]);
        (existing as unknown as { verification: unknown }).verification = {
            status: 'APPROVED',
            required: true,
        };
        (existing as unknown as { patches: unknown[] }).patches = [
            { id: 'older-patch', timestamp: '2026-08-01T00:00:00.000Z', actorId: 'x', reason: 'r', previousState: {} },
        ];
        const repo = makeRepo(existing);

        await updateLog(
            {
                logId: 'log-1',
                updatedData: { labour: [makeLabour({ count: 6 })] },
                actorId: 'mukadam-7',
                reason: 'मोजून पाहिलं',
            },
            repo,
            actor,
        );

        const [saved] = repo.save.mock.calls[0];
        expect(saved.patches).toHaveLength(2);
        expect(saved.patches[0].id).toBe('older-patch');

        const appended = saved.patches[1];
        // What it WAS, who changed it, and when.
        expect(appended.previousState.labour[0].count).toBe(8);
        expect(appended.actorId).toBe('mukadam-7');
        expect(appended.reason).toBe('मोजून पाहिलं');
        expect(Date.parse(appended.timestamp)).not.toBeNaN();
        // And what it IS now, on the record itself.
        expect(saved.labour[0].count).toBe(6);
    });
});

describe('buildLabourCorrections', () => {
    it('sends a stated duration and omits an unstated one', () => {
        const before = makeLog([makeLabour({ count: 8 })]);
        const after = makeLog([makeLabour({ count: 8, durationHours: 4 })]);

        const corrections = buildLabourCorrections(before, after);

        expect(corrections).toHaveLength(1);
        expect(corrections[0].request.durationHours).toBe(4);
        expect(corrections[0].request).not.toHaveProperty('quantity');
    });

    it('treats a cleared duration as silence, not as zero hours worked', () => {
        const before = makeLog([makeLabour({ count: 8, durationHours: 6 })]);
        const after = makeLog([makeLabour({ count: 8, durationHours: 0 })]);

        expect(buildLabourCorrections(before, after)).toHaveLength(0);
    });

    it('never emits a quantity section when every headcount box was cleared', () => {
        const before = makeLog([makeLabour({ count: 8 })]);
        const after = makeLog([makeLabour({ count: undefined, durationHours: 4 })]);

        const corrections = buildLabourCorrections(before, after);

        // Clearing the count is silence, not "nobody worked". The duration still
        // travels; the quantity section must not, or the server would be asked to
        // NULL a known headcount. (The server refuses that anyway — this is the
        // belt to its braces.)
        expect(corrections).toHaveLength(1);
        expect(corrections[0].request).not.toHaveProperty('quantity');
        expect(corrections[0].request.durationHours).toBe(4);
    });

    it('drops a fractional headcount rather than rounding it into the record', () => {
        const before = makeLog([makeLabour({ count: 8 })]);
        const after = makeLog([makeLabour({ count: 8, maleCount: 2.5 })]);

        // 2.5 is not a whole number of people, so it is omitted — and with
        // nothing else changed there is nothing to correct.
        expect(buildLabourCorrections(before, after)).toHaveLength(0);
    });

    it('ignores engagements with no labourAssignmentId and newly added ones', () => {
        const before = makeLog([makeLabour({ count: 8 })]);
        const after = makeLog([
            makeLabour({ count: 8 }),
            makeLabour({ id: 'lab-1', labourAssignmentId: undefined, count: 3 }),
            makeLabour({
                id: 'lab-2',
                labourAssignmentId: '22222222-2222-2222-2222-222222222222',
                count: 4,
            }),
        ]);

        expect(buildLabourCorrections(before, after)).toHaveLength(0);
    });
});
