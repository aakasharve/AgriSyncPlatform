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
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

import { getDatabase, resetDatabase, type MutationQueueStatus } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
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

    it('counts transient failures and durable rejections together', async () => {
        await seedMutation('FAILED', 2);
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
