// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T1.
 *
 * The regression test for the actual bug: the sync chip's label used to be
 * computed from `db.outbox`, a table with FOUR writers and ZERO senders. Rows
 * went in at `PENDING` and nothing ever moved them, so the chip claimed
 * "Sending..." forever for every farmer regardless of what had really reached
 * the server.
 *
 * `readSyncQueueSnapshot` is the Dexie half of the fix. It is exported (rather
 * than left inside `initializeObserver`) precisely so this can be asserted
 * without constructing the `SyncStatusService` singleton — that singleton owns
 * a process-wide `liveQuery` subscription that is never torn down, and this
 * task deliberately does not change that lifetime.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { getDatabase, resetDatabase, type MutationQueueStatus } from '../DexieDatabase';
import { readSyncQueueSnapshot } from '../SyncStatusService';
import { SyncMutationName } from '../../sync/SyncMutationCatalog';
import { deriveSyncHonestyState } from '../../../features/sync/status/syncHonestyState';

const FROZEN_NOW_ISO = '2026-08-12T09:00:00.000Z';

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
        clientRequestId: `req-${status}-${retryCount}-${Math.random().toString(36).slice(2, 8)}`,
        clientCommandId: 'cmd-1',
        mutationType: SyncMutationName.CreateDailyLog,
        payload: { sample: true },
        status,
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount,
    });
}

/** Mirrors exactly what `DexieLogsRepository.save()` writes today. */
async function seedUndrainedOutboxRow() {
    const db = getDatabase();
    return db.outbox.add({
        idempotencyKey: `log-1_CREATE_LOG_${Math.random().toString(36).slice(2, 8)}`,
        action: 'CREATE_LOG',
        resourceId: 'log-1',
        payload: { id: 'log-1' },
        status: 'PENDING',
        createdAt: FROZEN_NOW_ISO,
        retryCount: 0,
    });
}

describe('readSyncQueueSnapshot — the chip reads the queue that gets answers', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('an undrained db.outbox no longer produces a status at all', async () => {
        // THE BUG. Three saves, three PENDING outbox rows, nothing queued for
        // /sync/push. Before this task that rendered a permanently amber
        // "Sending...". It must now render the honest "everything settled".
        await seedUndrainedOutboxRow();
        await seedUndrainedOutboxRow();
        await seedUndrainedOutboxRow();

        expect(await getDatabase().outbox.count()).toBe(3);

        const snapshot = await readSyncQueueSnapshot();

        expect(snapshot).toEqual([]);
        expect(deriveSyncHonestyState(snapshot)).toBe('ON_SERVER');
    });

    it('a queued mutation reads as ON_PHONE even while outbox rows sit there', async () => {
        await seedUndrainedOutboxRow();
        await seedMutation('PENDING');

        const snapshot = await readSyncQueueSnapshot();

        expect(snapshot).toHaveLength(1);
        expect(deriveSyncHonestyState(snapshot)).toBe('ON_PHONE');
    });

    it('carries retryCount through, so the cap is visible to the derivation', async () => {
        await seedMutation('FAILED', 5);

        const snapshot = await readSyncQueueSnapshot();

        expect(snapshot).toEqual([{ status: 'FAILED', retryCount: 5 }]);
        expect(deriveSyncHonestyState(snapshot)).toBe('NEEDS_FIX');
    });

    it('surfaces a durable rejection', async () => {
        await seedMutation('REJECTED_USER_REVIEW', 1);

        expect(deriveSyncHonestyState(await readSyncQueueSnapshot())).toBe('NEEDS_FIX');
    });

    it('skips terminal rows so an old, never-pruned queue stays cheap and quiet', async () => {
        await seedMutation('APPLIED');
        await seedMutation('APPLIED');
        await seedMutation('REJECTED_DROPPED');

        const snapshot = await readSyncQueueSnapshot();

        expect(snapshot).toEqual([]);
        expect(deriveSyncHonestyState(snapshot)).toBe('ON_SERVER');
    });

    it('does not retain mutation payloads', async () => {
        await seedMutation('PENDING');

        const [only] = await readSyncQueueSnapshot();

        expect(Object.keys(only).sort()).toEqual(['retryCount', 'status']);
    });
});
