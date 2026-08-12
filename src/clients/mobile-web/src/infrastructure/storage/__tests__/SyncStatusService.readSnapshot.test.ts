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
 * "Sending..." forever regardless of what had really reached the server.
 *
 * `readSyncEvidence` is the Dexie half of the fix. It is exported (rather than
 * left inside `initializeObserver`) precisely so this can be asserted without
 * constructing the `SyncStatusService` singleton — that singleton owns a
 * process-wide `liveQuery` subscription that is never torn down, and this task
 * deliberately does not change that lifetime.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';

import { getDatabase, resetDatabase, type MutationQueueStatus } from '../DexieDatabase';
import { readSyncEvidence } from '../SyncStatusService';
import { SyncMutationName } from '../../sync/SyncMutationCatalog';
import { deriveSyncHonestyState } from '../../../features/sync/status/syncHonestyState';
import {
    noteUnqueueableLogs,
    resetUnqueueableLogs,
} from '../../../features/sync/status/unqueueableLogs';

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

describe('readSyncEvidence — the chip reads the queue that gets answers', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('an undrained db.outbox no longer produces a status at all', async () => {
        // THE ORIGINAL BUG. Three saves, three PENDING outbox rows, nothing
        // queued for /sync/push. Before this task that rendered a permanently
        // amber "Sending...".
        await seedUndrainedOutboxRow();
        await seedUndrainedOutboxRow();
        await seedUndrainedOutboxRow();

        expect(await getDatabase().outbox.count()).toBe(3);

        const { evidence } = await readSyncEvidence();

        expect(evidence.rows).toEqual([]);
        expect(evidence.acknowledgedCount).toBe(0);
    });

    it('and with no acknowledgement on record it makes NO claim, rather than a green receipt', async () => {
        // Review round 1, F1: this is also exactly what a log dropped by
        // `resolveSyncTarget` looks like — an empty queue. It must not read as
        // "sent".
        await seedUndrainedOutboxRow();

        const { evidence } = await readSyncEvidence();

        expect(deriveSyncHonestyState(evidence)).toBeNull();
        expect(deriveSyncHonestyState(evidence)).not.toBe('ON_SERVER');
    });

    it('an acknowledged mutation is what unlocks ON_SERVER', async () => {
        await seedMutation('APPLIED');

        const { evidence } = await readSyncEvidence();

        expect(evidence.acknowledgedCount).toBe(1);
        expect(deriveSyncHonestyState(evidence)).toBe('ON_SERVER');
    });

    it('a queued mutation reads as ON_PHONE even while outbox rows sit there', async () => {
        await seedUndrainedOutboxRow();
        await seedMutation('PENDING');

        const { evidence } = await readSyncEvidence();

        expect(evidence.rows).toHaveLength(1);
        expect(deriveSyncHonestyState(evidence)).toBe('ON_PHONE');
    });

    it('carries retryCount through, so the cap is visible to the derivation', async () => {
        await seedMutation('APPLIED');
        await seedMutation('FAILED', 5);

        const { evidence } = await readSyncEvidence();

        expect(evidence.rows).toEqual([{ status: 'FAILED', retryCount: 5 }]);
        expect(deriveSyncHonestyState(evidence)).toBe('NEEDS_FIX');
    });

    it('surfaces a durable rejection', async () => {
        await seedMutation('APPLIED');
        await seedMutation('REJECTED_USER_REVIEW', 1);

        expect(deriveSyncHonestyState((await readSyncEvidence()).evidence)).toBe('NEEDS_FIX');
    });

    it('skips terminal rows so an old, never-pruned queue stays cheap and quiet', async () => {
        await seedMutation('APPLIED');
        await seedMutation('APPLIED');
        await seedMutation('REJECTED_DROPPED');

        const { evidence } = await readSyncEvidence();

        expect(evidence.rows).toEqual([]);
        expect(evidence.acknowledgedCount).toBe(2);
        expect(deriveSyncHonestyState(evidence)).toBe('ON_SERVER');
    });

    it('does not retain mutation payloads', async () => {
        await seedMutation('PENDING');

        const [only] = (await readSyncEvidence()).evidence.rows;

        expect(Object.keys(only).sort()).toEqual(['retryCount', 'status']);
    });
});

describe('readSyncEvidence — uploads and AI jobs reach the claim (F2)', () => {
    beforeEach(async () => {
        await freshDb();
    });

    async function seedUpload(status: 'pending' | 'uploading' | 'retry_wait' | 'failed' | 'completed') {
        const db = getDatabase();
        return db.uploadQueue.add({
            attachmentId: `att-${status}-${Math.random().toString(36).slice(2, 8)}`,
            status,
            retryCount: status === 'failed' ? 5 : 0,
            createdAt: FROZEN_NOW_ISO,
            updatedAt: FROZEN_NOW_ISO,
        });
    }

    it('a permanently failed upload turns an otherwise settled device into NEEDS_FIX', async () => {
        await seedMutation('APPLIED');
        await seedUpload('failed');
        await seedUpload('failed');

        const { evidence } = await readSyncEvidence();

        expect(evidence.failedUploads).toBe(2);
        // Without this, the chip would render पाठवलं ✓ beside a red "2".
        expect(deriveSyncHonestyState(evidence)).toBe('NEEDS_FIX');
    });

    it('an in-flight upload holds the claim at ON_PHONE', async () => {
        await seedMutation('APPLIED');
        await seedUpload('pending');
        await seedUpload('retry_wait');

        const { evidence } = await readSyncEvidence();

        expect(evidence.pendingUploads).toBe(2);
        expect(deriveSyncHonestyState(evidence)).toBe('ON_PHONE');
    });

    it('a completed upload bears on nothing', async () => {
        await seedMutation('APPLIED');
        await seedUpload('completed');

        const { evidence } = await readSyncEvidence();

        expect(evidence.pendingUploads).toBe(0);
        expect(evidence.failedUploads).toBe(0);
        expect(deriveSyncHonestyState(evidence)).toBe('ON_SERVER');
    });
});

describe('readSyncEvidence — a record that reached no queue reaches the claim (C-1)', () => {
    beforeEach(async () => {
        await freshDb();
        resetUnqueueableLogs();
    });

    afterEach(() => {
        resetUnqueueableLogs();
    });

    it('the reading carries the count, which no Dexie table holds', async () => {
        noteUnqueueableLogs(['log-9']);

        const { evidence } = await readSyncEvidence();

        expect(evidence.unqueueableCount).toBe(1);
        // Proof it is not coming from a table: nothing was written to one.
        expect(await getDatabase().mutationQueue.count()).toBe(0);
        expect(await getDatabase().outbox.count()).toBe(0);
    });

    it('THE BUG: a device with applied mutations stops claiming ON_SERVER once a log is dropped', async () => {
        // The reachable case, walked through the real read path. `APPLIED` rows
        // are never pruned, so this device satisfies `acknowledgedCount > 0`
        // permanently — which is why the earlier guard closed only the
        // fresh-install case.
        await seedMutation('APPLIED');
        await seedMutation('APPLIED');

        expect(deriveSyncHonestyState((await readSyncEvidence()).evidence)).toBe('ON_SERVER');

        noteUnqueueableLogs(['log-just-saved']);

        const { evidence } = await readSyncEvidence();
        expect(evidence.acknowledgedCount).toBe(2);
        expect(deriveSyncHonestyState(evidence)).toBe('ON_PHONE');
        expect(deriveSyncHonestyState(evidence)).not.toBe('ON_SERVER');
    });
});

describe('readSyncEvidence — lastSyncedAt is mirrored, never minted (F6)', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('is undefined when the device has never completed a sync', async () => {
        await seedMutation('APPLIED');

        const { lastSyncedAt } = await readSyncEvidence();

        // The old code stamped `new Date()` on every hop into ON_SERVER, so a
        // farmer opening the app got "last synced: just now" for a sync that
        // never happened.
        expect(lastSyncedAt).toBeUndefined();
    });

    it('reflects the real sync cursor when one exists', async () => {
        const db = getDatabase();
        await db.syncCursors.put({
            tableName: 'shramsafal',
            lastSyncAt: '2026-08-11T04:30:00.000Z',
            version: 1,
        });

        const { lastSyncedAt } = await readSyncEvidence();

        expect(lastSyncedAt?.toISOString()).toBe('2026-08-11T04:30:00.000Z');
    });
});
