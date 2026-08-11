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

function makeRepo(log: DailyLog): LogsRepository {
    return { getById: vi.fn().mockResolvedValue(log) } as unknown as LogsRepository;
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
