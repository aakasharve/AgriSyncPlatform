// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * T-IGH-04-CONFLICT-EDIT — locks the contract for the new
 * `MutationQueue.replacePayload` API used by the edit-and-retry flow.
 *
 * Lives under `features/sync/conflict/__tests__/` (not the
 * `infrastructure/sync/__tests__/` directory) because this task's hard
 * rules restrict edits to that folder + the MutationQueue source.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { MutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

describe('MutationQueue.replacePayload', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('replaces an existing rejected row in place and resets status to PENDING', async () => {
        const queue = MutationQueue.getInstance();
        const db = getDatabase();
        const deviceId = queue.getDeviceId();

        // AddLogTask has a strict zod schema (logTaskId/dailyLogId UUIDs +
        // activityType). Use real UUID v4 values so the validator passes.
        const dailyLogId = '11111111-1111-4111-a111-111111111111';

        const id = await db.mutationQueue.add({
            deviceId,
            clientRequestId: 'req-1',
            clientCommandId: 'cmd-1',
            mutationType: SyncMutationName.AddLogTask,
            payload: { dailyLogId, activityType: 'old' },
            status: 'REJECTED_USER_REVIEW',
            createdAt: '2026-04-01T10:00:00.000Z',
            updatedAt: '2026-04-01T10:00:00.000Z',
            retryCount: 1,
            lastError: 'INVALID_PAYLOAD',
        });

        const newPayload = { dailyLogId, activityType: 'corrected' };

        const ok = await queue.replacePayload('req-1', newPayload);
        expect(ok).toBe(true);

        const updated = await db.mutationQueue.get(id);
        expect(updated?.payload).toEqual(newPayload);
        expect(updated?.status).toBe('PENDING');
        expect(updated?.lastError).toBeUndefined();
        // No duplicate rows.
        const rowCount = await db.mutationQueue.count();
        expect(rowCount).toBe(1);
    });

    it('rejects a malformed payload via the same PayloadValidator the enqueue path uses', async () => {
        const queue = MutationQueue.getInstance();
        const db = getDatabase();
        const deviceId = queue.getDeviceId();

        await db.mutationQueue.add({
            deviceId,
            clientRequestId: 'req-strict',
            clientCommandId: 'cmd-strict',
            mutationType: SyncMutationName.AddCostEntry,
            payload: { stale: true },
            status: 'REJECTED_USER_REVIEW',
            createdAt: '2026-04-01T10:00:00.000Z',
            updatedAt: '2026-04-01T10:00:00.000Z',
            retryCount: 1,
            lastError: 'INVALID_PAYLOAD',
        });

        // AddCostEntry has a strict zod schema — a bad payload must throw
        // and leave the row untouched (still REJECTED_USER_REVIEW).
        await expect(
            queue.replacePayload('req-strict', { amount: 'oops' })
        ).rejects.toThrow(/Payload validation failed/);

        const row = await db.mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([deviceId, 'req-strict'])
            .first();
        expect(row?.status).toBe('REJECTED_USER_REVIEW');
        expect(row?.payload).toEqual({ stale: true });
    });

    it('returns false when no row matches the clientRequestId', async () => {
        const queue = MutationQueue.getInstance();
        const ok = await queue.replacePayload('does-not-exist', { anything: true });
        expect(ok).toBe(false);
    });

    it('throws if clientRequestId is empty', async () => {
        const queue = MutationQueue.getInstance();
        await expect(queue.replacePayload('', { x: 1 })).rejects.toThrow(/clientRequestId/);
    });
});
