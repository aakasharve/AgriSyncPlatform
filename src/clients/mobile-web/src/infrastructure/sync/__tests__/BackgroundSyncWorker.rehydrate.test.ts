// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T3 — finding R3, third defect.
 *
 * `ConflictBadge` is the ONLY route to `OfflineConflictPage`, the only screen
 * that can resolve a durable rejection. It renders from
 * `snapshot.context.rejectedMutations.length` (`ConflictBadge.tsx:17-20`) — an
 * array that starts `[]` (`syncMachine.ts:90`) and was only ever appended to by
 * a `MUTATION_REJECTED` event fired in the SAME session. Nothing read it back
 * from Dexie.
 *
 * So on the second launch after a rejection: the chip said `अडकलं — तपासा`, the
 * drawer showed a count above an empty list, and the badge that leads to the
 * fix returned `null`. Every door was painted on.
 *
 * This file uses the REAL sync actor — no `RootStore` mock — so the assertions
 * are made against the exact expression the badge selects.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-08-12T09:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn().mockResolvedValue({ serverTimeUtc: '2026-08-12T09:00:00.000Z', results: [] }),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-08-12T09:00:00.000Z',
        nextCursorUtc: '2026-08-12T09:00:00.000Z',
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

vi.mock('../SyncPullReconciler', () => ({ reconcileSyncPull: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../PayloadValidator', () => ({ validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }) }));
vi.mock('../AiJobWorker', () => ({ AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) } }));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { SyncMutationName } from '../SyncMutationCatalog';
import { getRootStore, resetRootStore } from '../../../app/state/RootStore';
import { ConflictResolutionService } from '../../../features/sync/conflict/ConflictResolutionService';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
}

/** Exactly what `ConflictBadge` selects. If this is 0, the badge renders null. */
function badgeCount(): number {
    return getRootStore().sync.getSnapshot().context.rejectedMutations.length;
}

async function seedRejectedRow(clientRequestId: string, lastError = 'CLIENT_TOO_OLD') {
    const requestId = await mutationQueue.enqueue(
        SyncMutationName.CreateDailyLog,
        { sample: true },
        { clientRequestId },
    );
    const row = await getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([mutationQueue.getDeviceId(), requestId])
        .first();
    await mutationQueue.markRejectedUserReview(row!.id as number, lastError);
    return requestId;
}

describe('a restart must not hide the only remedy (R3)', () => {
    beforeEach(async () => {
        await freshDb();
        resetRootStore();
    });

    afterEach(() => {
        backgroundSyncWorker.stop();
        resetRootStore();
    });

    it('THE BUG: a fresh actor knows nothing about a rejection already in Dexie', async () => {
        await seedRejectedRow('req-restart-1');

        // This is the second launch, before rehydration runs. Dexie has the
        // row; the badge — and therefore the route to the fix — does not.
        expect(await mutationQueue.getRejectedUserReview()).toHaveLength(1);
        expect(badgeCount()).toBe(0);
    });

    it('rehydration makes the conflict surface reachable again', async () => {
        await seedRejectedRow('req-restart-2');

        await backgroundSyncWorker.rehydrateRejectedMutations();

        expect(badgeCount()).toBe(1);
        expect(getRootStore().sync.getSnapshot().value).toBe('conflict');
    });

    it('carries the server reason through, so the conflict screen is not blank', async () => {
        await seedRejectedRow('req-restart-3', 'MUTATION_TYPE_UNIMPLEMENTED');

        await backgroundSyncWorker.rehydrateRejectedMutations();

        const [rejection] = getRootStore().sync.getSnapshot().context.rejectedMutations;
        expect(rejection.mutationId).toBe('req-restart-3');
        expect(rejection.reason).toBe('MUTATION_TYPE_UNIMPLEMENTED');
    });

    it('rehydrates every outstanding rejection, not just the first', async () => {
        await seedRejectedRow('req-restart-4');
        await seedRejectedRow('req-restart-5');
        await seedRejectedRow('req-restart-6');

        await backgroundSyncWorker.rehydrateRejectedMutations();

        expect(badgeCount()).toBe(3);
    });

    it('is idempotent — a second boot pass does not double the badge', async () => {
        await seedRejectedRow('req-restart-7');

        await backgroundSyncWorker.rehydrateRejectedMutations();
        await backgroundSyncWorker.rehydrateRejectedMutations();

        expect(badgeCount()).toBe(1);
    });

    it('ignores rows the farmer already discarded', async () => {
        const requestId = await seedRejectedRow('req-restart-8');
        await ConflictResolutionService.discard(requestId);
        resetRootStore();

        await backgroundSyncWorker.rehydrateRejectedMutations();

        expect(badgeCount()).toBe(0);
    });

    it('says nothing when there is nothing to say', async () => {
        await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });

        await backgroundSyncWorker.rehydrateRejectedMutations();

        expect(badgeCount()).toBe(0);
        expect(getRootStore().sync.getSnapshot().value).not.toBe('conflict');
    });

    it('the worker does it on boot, not only when a test asks nicely', async () => {
        await seedRejectedRow('req-restart-9');

        backgroundSyncWorker.start();

        await vi.waitFor(() => expect(badgeCount()).toBe(1));
    });

    it('and the rehydrated route actually resolves the row', async () => {
        const requestId = await seedRejectedRow('req-restart-10');
        await backgroundSyncWorker.rehydrateRejectedMutations();
        expect(badgeCount()).toBe(1);

        // What OfflineConflictPage does when the farmer taps discard.
        await ConflictResolutionService.discard(requestId);

        expect(badgeCount()).toBe(0);
        const row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), requestId])
            .first();
        expect(row?.status).toBe('REJECTED_DROPPED');
    });
});
