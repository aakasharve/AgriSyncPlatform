/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S) — with the switch on, a worker-count / hours change on a
 * saved entry is QUEUED as `correct_labour_assignment` (sent later) instead of POSTed now, so it works with no internet
 * (P10). It carries what his phone SAW (so a newer change on the server refuses it, never gets overwritten), the
 * record versions this phone now expects move on one per queued correction (the server moves them too), and nothing
 * is claimed as "reached your farm records" until the server has answered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnqueue = vi.fn(async (_type: string, _payload: unknown, options?: { clientRequestId?: string }) => options?.clientRequestId ?? 'id');
vi.mock('../../../infrastructure/sync/MutationQueue', () => ({
    mutationQueue: {
        enqueue: (type: string, payload: unknown, options?: { clientRequestId?: string }) => mockEnqueue(type, payload, options),
        // lane OF-S fix 1 (B001): a worker count is queued as a change he can make again after a refusal.
        enqueueRepeatable: (type: string, payload: unknown, options?: { clientRequestId?: string }) => mockEnqueue(type, payload, options),
    },
}));
const mockPostCorrection = vi.fn();
vi.mock('../../../features/labour/data/labourCorrectionsClient', () => ({
    postLabourCorrection: (...args: unknown[]) => mockPostCorrection(...args),
}));
vi.mock('../../../features/logs/services/logSyncMutationService', () => ({
    resolveLogFarmId: async () => 'farm-1',
    wholeOrOmitted: (value: number | undefined) => (typeof value === 'number' && Number.isInteger(value) ? value : undefined),
    finiteOrOmitted: (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined),
}));

import { updateLog } from '../UpdateLog';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { DailyLog, LabourEvent } from '../../../domain/types/log.types';
import type { FarmerProfile } from '../../../domain/types/farm.types';
import type { LogsRepository } from '../../ports';

const ASSIGNMENT = '11111111-1111-1111-1111-111111111111';
const labour = (over: Partial<LabourEvent> = {}): LabourEvent =>
    ({ id: 'lab-0', type: 'HIRED', labourAssignmentId: ASSIGNMENT, count: 8, durationHours: 8, ...over }) as LabourEvent;
const entry = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: 'log-1', date: '2026-10-29', context: { selection: [] }, dayOutcome: 'WORK_RECORDED',
    cropActivities: [], irrigation: [], labour: [labour()], inputs: [], machinery: [], contentVersion: 2,
    ...over,
} as unknown as DailyLog);
const repo = (log: DailyLog) => ({ getById: vi.fn().mockResolvedValue(log), save: vi.fn().mockResolvedValue(undefined) }) as unknown as LogsRepository & { save: ReturnType<typeof vi.fn> };
const actor = { id: 'me' } as unknown as FarmerProfile;
const queued = (type: string) => mockEnqueue.mock.calls.filter(c => c[0] === type).map(c => c[1] as Record<string, unknown>);

beforeEach(() => { vi.clearAllMocks(); });

describe('lane OF-S — a worker count is queued, not posted', () => {
    it('8 -> 6 queues one correction with what he saw; nothing is posted; the version this phone expects moves on', async () => {
        const r = repo(entry());
        const result = await updateLog({ logId: 'log-1', updatedData: { labour: [labour({ count: 6 })] }, actorId: 'me', reason: 'मोजले' }, r, actor);

        expect(result.success).toBe(true);
        expect(mockPostCorrection).not.toHaveBeenCalled();
        const [payload] = queued(SyncMutationName.CorrectLabourAssignment);
        expect(payload).toMatchObject({
            labourAssignmentId: ASSIGNMENT, dailyLogId: 'log-1', farmId: 'farm-1',
            quantity: { workerCount: 6 }, seen: { workerCount: 8, durationHours: 8 }, reason: 'मोजले',
        });
        expect(payload).not.toHaveProperty('durationHours'); // silence about hours is not a correction
        expect(result.persistedLabourCorrections).toBe(0); // queued is not "reached your farm records" (P10)
        expect(result.hasUnsentChanges).toBe(false); // it WILL be sent
        expect((r.save.mock.calls[0][0] as DailyLog).contentVersion).toBe(3);
        expect((r.save.mock.calls[0][0] as DailyLog).labour[0].count).toBe(6); // shows on the entry at once
    });

    it('a count and a content change together: the content revision names the version after the count', async () => {
        const r = repo(entry());
        await updateLog({
            logId: 'log-1',
            updatedData: { labour: [labour({ count: 6 })], irrigation: [{ id: 'w', method: 'Drip', durationHours: 2 }] as never },
            actorId: 'me', reason: 'x',
        }, r, actor);

        const [revision] = queued(SyncMutationName.ReviseLogContent);
        expect(revision).toMatchObject({ dailyLogId: 'log-1', baseVersion: 3 });
        expect((r.save.mock.calls[0][0] as DailyLog).contentVersion).toBe(4);
        // queued in this order: the count first, then the content
        expect(mockEnqueue.mock.calls.map(c => c[0])).toEqual([SyncMutationName.CorrectLabourAssignment, SyncMutationName.ReviseLogContent]);
    });

    it('pressing again for the same change queues the SAME request (one id), never a second correction', async () => {
        const once = { logId: 'log-1', updatedData: { labour: [labour({ count: 6 })] }, actorId: 'me', reason: 'x' };
        await updateLog(once, repo(entry()), actor);
        await updateLog(once, repo(entry()), actor);
        const ids = mockEnqueue.mock.calls.map(c => c[2]?.clientRequestId);
        expect(ids).toHaveLength(2);
        expect(ids[0]).toBe(ids[1]);
        // …but the same numbers from a NEWER version are a new correction (8 -> 6 -> 8 -> 6 is never mistaken for a repeat)
        await updateLog(once, repo(entry({ contentVersion: 4 })), actor);
        expect(mockEnqueue.mock.calls[2][2]?.clientRequestId).not.toBe(ids[0]);
    });
});
