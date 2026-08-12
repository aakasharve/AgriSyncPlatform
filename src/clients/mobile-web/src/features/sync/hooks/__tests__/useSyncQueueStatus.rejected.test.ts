// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T1 — architect defect D6.
 *
 * `failedCount` used to count `status === 'FAILED'` only. `REJECTED_USER_REVIEW`
 * is the DURABLE rejection: the server gave a permanent error, the row is
 * deliberately excluded from auto-retry (`MutationQueue.ts:229-231`), and only
 * an explicit farmer action can clear it. It was the most permanent failure
 * state in the app and it was the one state the badge never showed.
 *
 * The chip's label and its badge must agree. The label now folds durable
 * rejections into NEEDS_FIX (`syncHonestyState.ts`), so the badge has to count
 * them too or the farmer sees "Stuck — check" beside no number at all.
 *
 * Task T3 / ruling R12 tightens the same invariant from the other side.
 * `failedCount` had come to mean `FAILED` + `REJECTED_USER_REVIEW`, which
 * includes rows the worker is still retrying on its own — so ONE sub-cap
 * failure put a RED badge beside the AMBER `फोनवर सेव्ह ✓` label. Both halves
 * true, neither agreeing. `failedCount` now means **rows that need the
 * farmer**, and it is the length of `stuckMutations`, which is the list the
 * drawer must render. A number and its evidence, or neither.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

import { getDatabase, resetDatabase, type MutationQueueStatus } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../../status/syncHonestyState';
import { useSyncQueueStatus } from '../useSyncQueueStatus';

const FROZEN_NOW_ISO = '2026-08-12T09:00:00.000Z';

afterEach(cleanup);

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
}

async function seedMutation(status: MutationQueueStatus, retryCount = 0) {
    const db = getDatabase();
    return db.mutationQueue.add({
        deviceId: 'test-device',
        clientRequestId: `req-${status}-${Math.random().toString(36).slice(2, 8)}`,
        clientCommandId: 'cmd-1',
        mutationType: SyncMutationName.CreateDailyLog,
        payload: { sample: true },
        status,
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount,
    });
}

describe('useSyncQueueStatus — durable rejections are counted (D6)', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('counts a REJECTED_USER_REVIEW row in failedCount', async () => {
        await seedMutation('REJECTED_USER_REVIEW', 1);

        const { result } = renderHook(() => useSyncQueueStatus());

        await waitFor(() => expect(result.current.failedCount).toBe(1));
    });

    it('counts capped failures and durable rejections together', async () => {
        await seedMutation('FAILED', MAX_AUTO_RETRY_COUNT);
        await seedMutation('REJECTED_USER_REVIEW', 1);

        const { result } = renderHook(() => useSyncQueueStatus());

        await waitFor(() => expect(result.current.failedCount).toBe(2));
    });

    it('does not count a row the farmer explicitly discarded', async () => {
        await seedMutation('REJECTED_DROPPED', 1);
        await seedMutation('PENDING');

        const { result } = renderHook(() => useSyncQueueStatus());

        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        expect(result.current.failedCount).toBe(0);
    });

    it('leaves an all-clear queue at zero', async () => {
        await seedMutation('APPLIED');

        const { result } = renderHook(() => useSyncQueueStatus());

        await waitFor(() => expect(result.current.syncedCount).toBe(1));
        expect(result.current.failedCount).toBe(0);
        expect(result.current.pendingCount).toBe(0);
    });
});

describe('useSyncQueueStatus — the red number means "you have to do something" (T3 / R12)', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('a failure the worker is still retrying is pending, not failed', async () => {
        await seedMutation('FAILED', MAX_AUTO_RETRY_COUNT - 1);

        const { result } = renderHook(() => useSyncQueueStatus());

        // This is the whole of R12: an amber "saved on phone" label beside a
        // red 1 for a record nothing has given up on.
        await waitFor(() => expect(result.current.pendingCount).toBe(1));
        expect(result.current.failedCount).toBe(0);
        expect(result.current.stuckMutations).toEqual([]);
    });

    it('a failure past the cap is failed, because nothing will move it without a tap', async () => {
        await seedMutation('FAILED', MAX_AUTO_RETRY_COUNT);

        const { result } = renderHook(() => useSyncQueueStatus());

        await waitFor(() => expect(result.current.failedCount).toBe(1));
        expect(result.current.pendingCount).toBe(0);
    });

    it('counts nothing it cannot also list', async () => {
        await seedMutation('FAILED', MAX_AUTO_RETRY_COUNT);
        await seedMutation('FAILED', 1);
        await seedMutation('REJECTED_USER_REVIEW', 3);

        const { result } = renderHook(() => useSyncQueueStatus());

        // "1 Failed above an empty list" is structurally impossible now: the
        // count is the list's length.
        await waitFor(() => expect(result.current.failedCount).toBe(2));
        expect(result.current.stuckMutations).toHaveLength(result.current.failedCount);
    });

    it('tells the drawer which remedy each stuck row needs', async () => {
        await seedMutation('FAILED', MAX_AUTO_RETRY_COUNT);
        await seedMutation('REJECTED_USER_REVIEW', 2);

        const { result } = renderHook(() => useSyncQueueStatus());

        await waitFor(() => expect(result.current.stuckMutations).toHaveLength(2));
        expect(result.current.stuckMutations.map(s => s.remedy).sort()).toEqual(['NEEDS_REVIEW', 'RETRY']);
    });

    it('a queue full of in-flight work shows no red number at all', async () => {
        await seedMutation('PENDING');
        await seedMutation('SENDING');
        await seedMutation('FAILED', 2);

        const { result } = renderHook(() => useSyncQueueStatus());

        await waitFor(() => expect(result.current.pendingCount).toBe(3));
        expect(result.current.failedCount).toBe(0);
    });
});
