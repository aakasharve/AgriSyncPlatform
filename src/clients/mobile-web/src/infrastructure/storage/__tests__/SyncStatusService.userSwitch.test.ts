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
import type { SyncHonestyClaim } from '../../../features/sync/status/syncHonestyState';
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
 * A `liveQuery` is asynchronous by nature — the whole point is that it re-runs
 * AFTER a write, not during it — so waiting is unavoidable here. It listens on
 * the service's own subscription rather than polling, so it reacts the instant
 * the claim is published: under a fully parallel suite a 20ms poll plus a tight
 * deadline was the difference between this passing and failing, and a guard on
 * data loss that fails for reasons unrelated to data loss is worse than no
 * guard at all.
 *
 * The budget still exists, because "never arrives" must become a failure with
 * a useful message rather than a hung suite.
 *
 * WHICH MUTATION ACTUALLY TRIPS IT — MEASURED, NOT ASSUMED. This comment used
 * to say "drop the re-subscribe". That was checked and is not right: removing
 * `onActiveDatabaseChanged(...)` fails in 104ms on the SYNCHRONOUS assertion
 * below (`getStatus()` is still `ON_PHONE` where `null` is required), and never
 * reaches this function at all. Good — the cheap guard catches it first. The
 * mutation that genuinely lands here is the narrower one: withdraw the claim
 * but never re-observe (delete `this.observeActiveDatabase()` from
 * `rebindToActiveDatabase`). Every earlier assertion then passes — the chip
 * IS null — and only this budget notices that it stays null forever. Measured
 * at 45 329ms with the message below.
 *
 * ── WHY 45s AND NOT 15s ─────────────────────────────────────────────────────
 *
 * THIS IS NOT A TIMEOUT RAISED TO SILENCE A FAILURE. It is a diagnostic ceiling
 * that had been set FOUR TIMES BELOW the real one, so it fired first and turned
 * load into a red gate.
 *
 * The two numbers do different jobs. The test's own 60s timeout is the
 * CORRECTNESS boundary — past it, the claim genuinely never arrived. This inner
 * budget only exists to replace a silent hang with a sentence naming the claim
 * that never came. At 15s it was doing a third job nobody asked it to do:
 * failing correct runs. Measured on this branch — the suite green 2/2 at
 * `4451aa4e`, then fail/fail/pass at `53534be6` after four React renders were
 * added to an unrelated file. Nothing in this test's import graph reaches the
 * changed code (no drawer, no card, no `useSyncQueueStatus`); what moved was
 * scheduling across 147 parallel files.
 *
 * THE GUARD IS NOT WEAKENED, and that is checked rather than argued — see the
 * measured mutation above. A never-re-observed chip stays null FOREVER, so the
 * budget still fails it; it simply takes 45s to say so instead of 15s. A budget
 * can only be too small, never too large, for a case that never resolves.
 *
 * It stays BELOW the 60s test timeout on purpose: the useful sentence must beat
 * Vitest's bare "test timed out".
 */
async function waitForClaim(expected: SyncHonestyClaim, budgetMs = 45_000): Promise<void> {
    const service = SyncStatusService.getInstance();
    if (service.getStatus() === expected) {
        return;
    }

    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        await new Promise<void>((resolve, reject) => {
            timer = setTimeout(() => {
                reject(new Error(
                    `the chip never reached ${String(expected)} within ${budgetMs}ms; ` +
                    `it is still ${String(service.getStatus())}`
                ));
            }, budgetMs);
            // `subscribe` invokes the listener once immediately with the current
            // claim, which is why the early return above is not just an
            // optimisation — it keeps that first call from racing the executor.
            unsubscribe = service.subscribe(claim => {
                if (claim === expected) {
                    resolve();
                }
            });
        });
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
        unsubscribe?.();
    }
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
        // Generous timeout because this test waits on TWO liveQuery round trips
        // and runs alongside 120 other files. Vitest's 5s default was smaller
        // than the waits themselves.
    }, 60_000);

    it('and farmer A\'s acknowledged row is still sitting in A\'s database', async () => {
        activateDatabaseForUser(FARMER_A);

        const rows = await getDatabase().mutationQueue.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('APPLIED');
    });
});
