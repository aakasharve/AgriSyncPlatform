// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1, final fix round, finding C-1.
 *
 * THE WIRING, not the arithmetic. `syncHonestyState.test.ts` proves the claim is
 * derived correctly; this proves it actually REACHES the chip.
 *
 * That is a separate risk with its own failure mode: `SyncStatusService`
 * publishes from a Dexie `liveQuery`, which re-fires only when a table it read
 * changes. A skipped log writes to no table at all — that is the entire defect —
 * so a correct derivation wired only into the liveQuery would sit behind a
 * `पाठवलं ✓` that never refreshes. Nothing else in the suite would notice.
 *
 * This file constructs the singleton, which the sibling `readSnapshot` tests
 * deliberately avoid: it owns a process-wide subscription that is never torn
 * down. That is exactly why the tests below share one instance and one
 * subscription rather than building one each.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { getDatabase, resetDatabase } from '../DexieDatabase';
import { SyncStatusService } from '../SyncStatusService';
import { SyncMutationName } from '../../sync/SyncMutationCatalog';
import {
    noteUnqueueableLogs,
    resetUnqueueableLogs,
} from '../../../features/sync/status/unqueueableLogs';
import type { SyncHonestyClaim } from '../../../features/sync/status/syncHonestyState';

const FROZEN_NOW_ISO = '2026-08-12T09:00:00.000Z';

/**
 * Waits for the liveQuery to deliver, by polling rather than by sleeping a fixed
 * 50ms — a fixed sleep passed alone and failed under a loaded parallel run,
 * which is a flaky test, not a finding.
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 5000) {
    const startedAt = Date.now();
    while (!predicate() && Date.now() - startedAt < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

let published: SyncHonestyClaim = null;

describe('SyncStatusService — the dropped record reaches the chip, not just the derivation', () => {
    beforeAll(async () => {
        const db = getDatabase();
        try {
            await db.delete();
        } catch {
            // first run — nothing to delete
        }
        await resetDatabase();

        // A device that has synced before. `APPLIED` rows are never pruned, so
        // this is every device except a fresh install.
        await getDatabase().mutationQueue.add({
            deviceId: 'test-device',
            clientRequestId: 'req-applied-1',
            clientCommandId: 'cmd-1',
            mutationType: SyncMutationName.CreateDailyLog,
            payload: { sample: true },
            status: 'APPLIED',
            createdAt: FROZEN_NOW_ISO,
            updatedAt: FROZEN_NOW_ISO,
            retryCount: 0,
        });

        SyncStatusService.getInstance().subscribe(claim => {
            published = claim;
        });
        await waitUntil(() => published !== null);
    });

    beforeEach(() => {
        resetUnqueueableLogs();
    });

    it('publishes ON_SERVER for a settled, previously-acknowledged device', () => {
        expect(published).toBe('ON_SERVER');
    });

    it('publishes the drop SYNCHRONOUSLY — no queue write, no tick to wait for', () => {
        // The chip has to be right on the frame the farmer reads the toast, not
        // whenever some later Dexie write happens to wake the query.
        noteUnqueueableLogs(['log-just-saved']);

        expect(published).toBe('ON_PHONE');
    });

    it('publishes ON_PHONE the moment a save reports a record it could not queue', () => {
        // No Dexie write happens here — none is possible, that is the defect.
        // If the registry were not wired into the service, `published` would
        // still read ON_SERVER and the farmer would keep the false receipt.
        noteUnqueueableLogs(['log-just-saved']);

        expect(published).toBe('ON_PHONE');
        expect(SyncStatusService.getInstance().getStatus()).toBe('ON_PHONE');
    });

    it('does not need a queue write to say it, and does not fabricate one', async () => {
        noteUnqueueableLogs(['log-just-saved']);

        expect(published).toBe('ON_PHONE');
        // The queue is untouched: one APPLIED row, nothing else. The chip is
        // reporting something no table knows about, which is the only way this
        // record can be reported at all.
        expect(await getDatabase().mutationQueue.count()).toBe(1);
        expect(await getDatabase().outbox.count()).toBe(0);
    });

    it('returns to ON_SERVER when the dropped records are forgotten', () => {
        // The session-scoped half stated plainly: clearing the registry (a
        // reload does it implicitly) restores the old claim, because nothing
        // durable records the skip. Phase 2 owns making that survive a restart.
        noteUnqueueableLogs(['log-just-saved']);
        expect(published).toBe('ON_PHONE');

        resetUnqueueableLogs();

        expect(published).toBe('ON_SERVER');
    });
});
