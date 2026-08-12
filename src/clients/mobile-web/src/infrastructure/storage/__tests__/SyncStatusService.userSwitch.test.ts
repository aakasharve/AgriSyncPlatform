// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE ONE SUBSCRIPTION THAT OUTLIVES A CHANGE OF FARMER
 * =====================================================
 *
 * Almost nothing in this app has to be told that the active database changed:
 * all 104 call sites call `getDatabase()` inside a function body, so the next
 * call lands on the new handle, and every component-level `liveQuery` is torn
 * down anyway because `DataSourceProvider` unmounts its children while it
 * re-initialises.
 *
 * `SyncStatusService` is the exception, and it says so about itself: a
 * process-wide singleton whose `liveQuery` is never unsubscribed. A `liveQuery`
 * observes the database it was BUILT on. Left alone across a switch it would go
 * on reporting the previous farmer's queue — into the sync chip, the most
 * prominent control on the screen — and would never update again once that
 * handle closed.
 *
 * This file lives apart from the other proofs on purpose: constructing the
 * singleton starts a subscription that cannot be stopped, so it must not be
 * done in a file that then wants to delete databases underneath it.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeAll } from 'vitest';

import { getDatabase, resetDatabase } from '../DexieDatabase';
import { SyncStatusService } from '../SyncStatusService';
import { activateDatabaseForUser } from '../activateUserDatabase';
import { LEGACY_DATABASE_NAME } from '../userDatabaseName';
import { getActiveDatabaseName } from '../activeDatabaseName';
import { SyncMutationName } from '../../sync/SyncMutationCatalog';
import {
    getUnqueueableLogCount,
    noteUnqueueableLogs,
} from '../../../features/sync/status/unqueueableLogs';

const FARMER_A = 'switch-user-a';
const FARMER_B = 'switch-user-b';
const DB_FOR_B = `AgriLogDB_u_${encodeURIComponent(FARMER_B)}`;
const FROZEN_NOW = '2026-08-12T09:00:00.000Z';

async function seedMutation(status: 'PENDING' | 'APPLIED') {
    return getDatabase().mutationQueue.add({
        deviceId: 'device-1',
        clientRequestId: `req-${status}-${Math.random().toString(36).slice(2, 8)}`,
        clientCommandId: 'cmd-1',
        mutationType: SyncMutationName.CreateDailyLog,
        payload: { sample: true },
        status,
        createdAt: FROZEN_NOW,
        updatedAt: FROZEN_NOW,
        retryCount: 0,
    });
}

/**
 * Waits for the chip's published claim to reach `expected`.
 *
 * A `liveQuery` is asynchronous by nature — the point of the whole mechanism is
 * that it re-runs after a write, not during it — so a poll is the honest way to
 * observe it. The deadline is what turns "never arrives" into a failure with a
 * useful message instead of a hung suite.
 */
async function waitForClaim(expected: string | null, budgetMs = 4000): Promise<void> {
    const service = SyncStatusService.getInstance();
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
        if (service.getStatus() === expected) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(service.getStatus()).toBe(expected);
}

describe('the sync chip follows the farmer, and takes nothing with it', () => {
    beforeAll(async () => {
        await resetDatabase();
        for (const name of [LEGACY_DATABASE_NAME, DB_FOR_B]) {
            await Dexie.delete(name);
        }
        localStorage.clear();
        await resetDatabase();
    });

    it('re-reads the new farmer\'s queue instead of latching on the previous one', async () => {
        activateDatabaseForUser(FARMER_A);
        expect(getActiveDatabaseName()).toBe(LEGACY_DATABASE_NAME);

        // Farmer A has an acknowledged mutation, so the chip earns ON_SERVER.
        await seedMutation('APPLIED');
        SyncStatusService.getInstance();
        await waitForClaim('ON_SERVER');

        // A session-scoped fact about one of A's logs, which B must not inherit.
        noteUnqueueableLogs(['a-log-that-reached-no-queue']);
        expect(getUnqueueableLogCount()).toBe(1);

        // Farmer B signs in.
        activateDatabaseForUser(FARMER_B);
        expect(getActiveDatabaseName()).toBe(DB_FOR_B);

        // Synchronously, before any query can resolve: the claim about someone
        // else's records is withdrawn. `null` is NO CLAIM — the honest state for
        // a device that has not yet read this farmer's queue.
        expect(SyncStatusService.getInstance().getStatus()).toBeNull();
        expect(getUnqueueableLogCount()).toBe(0);

        // A's acknowledgement must not resurface once B's first reading lands —
        // B's database is empty, so there is nothing to claim.
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(SyncStatusService.getInstance().getStatus()).toBeNull();

        // And the subscription is genuinely LIVE on B's database, not merely
        // silenced: a write B makes moves the chip.
        await seedMutation('PENDING');
        await waitForClaim('ON_PHONE');
    });

    it('and farmer A\'s acknowledged row is still sitting in A\'s database', async () => {
        activateDatabaseForUser(FARMER_A);

        const rows = await getDatabase().mutationQueue.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('APPLIED');
    });
});
