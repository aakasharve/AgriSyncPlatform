// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 review B002 — THE BADGE MUST COME BACK DOWN.
 *
 * Box 2d promoted cap-exhausted `FAILED` rows into `ConflictResolutionService`
 * and into the badge, which was the requirement. It also created a new painted
 * door pointing the other way, and this file is where that is nailed shut.
 *
 * The path that broke: a row exhausts the cap -> badge reads 1 ->
 * `stuckMutations.toStuckMutationView` gives that row `remedy: 'RETRY'`, so the
 * drawer offers exactly the button designed for it -> the farmer taps "Retry
 * All" -> the row applies -> **the badge still reads 1** for the rest of the
 * session, and tapping it opens a page saying everything is synced.
 * `syncMachine` dropped an entry only on `CONFLICT_RESOLVED`, which only
 * `ConflictResolutionService` emitted; the drawer path emitted nothing.
 *
 * This test uses the REAL `syncMachine` through the REAL `RootStore` — the same
 * selector `ConflictBadge` reads — because the defect lived precisely in the
 * seam between the worker and that actor, and a mocked store cannot see it.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-08-15T09:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-08-15T09:00:00.000Z', nextCursorUtc: '2026-08-15T09:00:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [],
        costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [],
        plannedActivities: [], auditEvents: [],
    }),
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return { ...actual, agriSyncClient: { pushSyncBatch: pushBatchMock, pullSyncChanges: pullChangesMock } };
});

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'test-user', accessToken: 'test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

vi.mock('../AiJobWorker', () => ({ AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../PayloadValidator', () => ({ validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }) }));

// NOT mocked, deliberately: `../../../app/state/RootStore`.

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { MAX_AUTO_RETRY_COUNT } from '../retryCap';
import { SyncMutationName } from '../SyncMutationCatalog';
import { getRootStore, resetRootStore } from '../../../app/state/RootStore';
import { ConflictResolutionService } from '../../../features/sync/conflict/ConflictResolutionService';

/** Exactly what `ConflictBadge.tsx:17-20` selects. */
function badgeCount(): number {
    return getRootStore().sync.getSnapshot().context.rejectedMutations.length;
}

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

function respondApplied() {
    pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
        serverTimeUtc: FROZEN_NOW_ISO,
        results: request.mutations.map(m => ({
            clientRequestId: m.clientRequestId,
            mutationType: m.mutationType,
            status: 'applied' as const,
        })),
    }));
}

async function seedCapExhausted(): Promise<string> {
    const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
    const row = await getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([mutationQueue.getDeviceId(), requestId])
        .first();
    await getDatabase().mutationQueue.update(row!.id as number, {
        status: 'FAILED',
        retryCount: MAX_AUTO_RETRY_COUNT,
        lastError: 'Request failed with status code 400',
    });
    return requestId;
}

describe('§P0.7 review B002 — the conflict badge clears within the session', () => {
    beforeEach(async () => {
        resetRootStore();
        await freshDb();
        pushBatchMock.mockReset();
        respondApplied();
    });

    it('B002_Retry_All_on_a_cap_exhausted_row_takes_the_badge_back_to_zero', async () => {
        const requestId = await seedCapExhausted();

        // Boot: the badge lights up, which is box 2d working as specified.
        await backgroundSyncWorker.rehydrateRejectedMutations();
        expect(badgeCount()).toBe(1);
        expect(await ConflictResolutionService.list()).toHaveLength(1);

        // The farmer taps the drawer's "Retry All" — the remedy `stuckMutations`
        // assigns this row. The server accepts it.
        const outcome = await backgroundSyncWorker.retryAllFailed();

        expect(outcome.mutations).toBe(1);
        expect((await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), requestId])
            .first())?.status).toBe('APPLIED');

        // THE FIX. Before it, this read 1 for the rest of the session and the
        // page behind it said everything was synced.
        expect(badgeCount()).toBe(0);
        expect(await ConflictResolutionService.list()).toHaveLength(0);
    });

    it('B002_the_per_row_Retry_in_the_drawer_clears_it_too', async () => {
        const requestId = await seedCapExhausted();
        await backgroundSyncWorker.rehydrateRejectedMutations();
        expect(badgeCount()).toBe(1);

        await backgroundSyncWorker.retryFailed(requestId);

        expect(badgeCount()).toBe(0);
    });

    it('B002_a_retry_that_fails_again_leaves_the_badge_up_where_it_belongs', async () => {
        const requestId = await seedCapExhausted();
        await backgroundSyncWorker.rehydrateRejectedMutations();
        pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId,
                mutationType: m.mutationType,
                status: 'failed' as const,
                errorCode: undefined,
                errorMessage: 'still broken',
            })),
        }));

        await backgroundSyncWorker.retryAllFailed();

        // Nothing was resolved, so nothing is cleared. The badge is not being
        // hidden; it is being kept honest in both directions.
        expect(badgeCount()).toBe(1);
        expect((await ConflictResolutionService.list()).map(r => r.mutationId)).toEqual([requestId]);
    });

    it('M2_one_query_failing_does_not_cost_the_badge_the_other_set', async () => {
        // The first version read both sets under one `Promise.all` in one `try`,
        // so a throw from the new query took the old one down with it — and this
        // method is the only thing that makes the badge survive a restart.
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        const row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), requestId])
            .first();
        await mutationQueue.markRejectedUserReview(row!.id as number, 'FORBIDDEN');

        const boom = vi.spyOn(mutationQueue, 'getCapExhaustedFailed')
            .mockRejectedValue(new Error('Dexie is having a day'));
        try {
            await backgroundSyncWorker.rehydrateRejectedMutations();
        } finally {
            boom.mockRestore();
        }

        // The durable rejection still reached the badge.
        expect(badgeCount()).toBe(1);
    });

    it('B002_a_durable_rejection_still_clears_only_through_the_conflict_screen', async () => {
        // Regression guard on the path that already worked, since the fix adds a
        // second emitter of CONFLICT_RESOLVED.
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        const row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), requestId])
            .first();
        await mutationQueue.markRejectedUserReview(row!.id as number, 'FORBIDDEN');
        await backgroundSyncWorker.rehydrateRejectedMutations();
        expect(badgeCount()).toBe(1);

        // "Retry All" deliberately does not touch REJECTED_USER_REVIEW, so the
        // badge must stay lit.
        await backgroundSyncWorker.retryAllFailed();
        expect(badgeCount()).toBe(1);

        await ConflictResolutionService.discard(requestId);
        expect(badgeCount()).toBe(0);
    });
});
