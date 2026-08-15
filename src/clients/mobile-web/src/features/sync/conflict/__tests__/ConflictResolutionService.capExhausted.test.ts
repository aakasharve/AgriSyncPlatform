// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 box 2d — THE CHIP POINTED AT A DOOR THAT WAS NOT THERE.
 *
 * `syncHonestyState` renders `NEEDS_FIX` for a `FAILED` row at or over the
 * auto-retry cap, and `stuckMutations.needsFarmerAction` agrees. But
 * `ConflictResolutionService.list()` read only `REJECTED_USER_REVIEW`, so the
 * farmer followed the alarm to a screen that said "सर्व नोंदी सिंक झाल्या आहेत"
 * — everything is synced — about a record the app had given up on.
 *
 * Telling a farmer there is a fix and then not providing one is worse than
 * saying nothing, because it teaches them the app's alarms mean nothing.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase, type MutationQueueStatus } from '../../../../infrastructure/storage/DexieDatabase';
import { systemClock } from '../../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-08-15T09:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

vi.mock('../../../../app/state/RootStore', () => ({
    getRootStore: () => ({ sync: { send: vi.fn() } }),
}));

import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { MAX_AUTO_RETRY_COUNT } from '../../../../infrastructure/sync/retryCap';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { ConflictResolutionService } from '../ConflictResolutionService';
import { needsFarmerAction } from '../../status/stuckMutations';
import { DEPENDENCY_PARENT_UNRESOLVED_CODE } from '../../../../infrastructure/sync/MutationDependency';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

async function seed(
    clientRequestId: string,
    status: MutationQueueStatus,
    retryCount: number,
    lastError?: string,
): Promise<void> {
    await getDatabase().mutationQueue.add({
        deviceId: mutationQueue.getDeviceId(),
        clientRequestId,
        clientCommandId: clientRequestId,
        mutationType: SyncMutationName.CreateDailyLog,
        payload: { dailyLogId: clientRequestId },
        status,
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount,
        lastError,
    });
}

describe('ConflictResolutionService.list — §P0.7 box 2d', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('a_cap_exhausted_FAILED_row_appears_on_the_screen_the_chip_sends_the_farmer_to', async () => {
        await seed('cap-exhausted', 'FAILED', MAX_AUTO_RETRY_COUNT, 'Request failed with status code 400');

        const list = await ConflictResolutionService.list();

        expect(list.map(row => row.mutationId)).toEqual(['cap-exhausted']);
        expect(list[0].reason).toBe('Request failed with status code 400');
        expect(list[0].hint).toBeTruthy();
    });

    it('a_FAILED_row_the_worker_is_still_retrying_stays_off_the_screen', async () => {
        // Below the cap the worker will try again unaided. Listing it would ask
        // the farmer to act on something that needs no action — the mirror
        // image of the defect, and just as dishonest.
        await seed('still-trying', 'FAILED', MAX_AUTO_RETRY_COUNT - 1, 'connection reset by peer');

        expect(await ConflictResolutionService.list()).toHaveLength(0);
    });

    it('the_screen_lists_exactly_the_rows_the_drawer_and_the_chip_call_stuck', async () => {
        // An independent oracle: `needsFarmerAction` is the predicate the chip
        // and the drawer already agree on. The conflict screen must show the
        // same set, or the three surfaces describe different worlds again.
        await seed('rejected', 'REJECTED_USER_REVIEW', 1, 'FORBIDDEN');
        await seed('cap-exhausted', 'FAILED', MAX_AUTO_RETRY_COUNT, 'HTTP 400');
        await seed('still-trying', 'FAILED', 1, 'blip');
        await seed('pending', 'PENDING', 0);
        await seed('applied', 'APPLIED', 0);
        await seed('dropped', 'REJECTED_DROPPED', 1, 'FORBIDDEN');

        const listed = (await ConflictResolutionService.list()).map(row => row.mutationId).sort();
        const stuck = (await getDatabase().mutationQueue.toArray())
            .filter(row => needsFarmerAction(row))
            .map(row => row.clientRequestId)
            .sort();

        expect(listed).toEqual(stuck);
        expect(listed).toEqual(['cap-exhausted', 'rejected']);
    });

    it('retry_actually_moves_a_cap_exhausted_row_so_the_door_opens_onto_something', async () => {
        await seed('cap-exhausted', 'FAILED', MAX_AUTO_RETRY_COUNT + 3, 'HTTP 400');

        await ConflictResolutionService.retry('cap-exhausted');

        const row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), 'cap-exhausted'])
            .first();
        // `retryFailed` ignores the cap by design, so the row is genuinely back
        // in play rather than merely re-listed.
        expect(row?.status).not.toBe('FAILED');
    });

    it('discard_works_on_a_cap_exhausted_row_too', async () => {
        await seed('cap-exhausted', 'FAILED', MAX_AUTO_RETRY_COUNT, 'HTTP 400');

        await ConflictResolutionService.discard('cap-exhausted');

        const row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), 'cap-exhausted'])
            .first();
        expect(row?.status).toBe('REJECTED_DROPPED');
        expect(await ConflictResolutionService.list()).toHaveLength(0);
    });

    it('a_dependency_rejection_gets_a_hint_that_points_at_the_parent_log', async () => {
        await seed(
            'orphan-child',
            'REJECTED_USER_REVIEW',
            1,
            `${DEPENDENCY_PARENT_UNRESOLVED_CODE}: the server has no daily log abc-123, ...`,
        );

        const list = await ConflictResolutionService.list();

        expect(list[0].reason).toContain('abc-123');
        expect(list[0].hint).toContain('दैनंदिन नोंदीशी');
    });
});
