// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec R-11 (c) (pre-launch repair, founder N-1: "Stop treating subscription refusal as a temporary
 * network failure … After activation, resume eligible pending uploads without duplicates").
 *
 * A row the server refuses with `entitlement.subscriptionexpired` is HELD: it stays on the phone,
 * is never charged toward the five-retry cap, is never a conflict for the farmer, is not re-sent
 * before the slow recheck timer, and goes by itself — the SAME row, the SAME client ids, once —
 * when the server allows the farm again.
 *
 * Real BackgroundSyncWorker + MutationQueue + Dexie (fake-indexeddb); only the network boundary is
 * mocked — the same harness as BackgroundSyncWorker.durability.test.ts.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-04-01T12:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-04-01T12:00:00.000Z',
        nextCursorUtc: '2026-04-01T12:00:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [],
        financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
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
const { syncSendMock } = vi.hoisted(() => ({ syncSendMock: vi.fn() }));
vi.mock('../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: syncSendMock } }) }));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue, HELD_RECHECK_MS, MAX_AUTO_RETRY_COUNT } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { ConflictResolutionService } from '../../../features/sync/conflict/ConflictResolutionService';
import { SyncMutationName } from '../SyncMutationCatalog';
import { countHeldRows } from '../../../features/sync/hooks/useHeldWorkCount';
import { SessionStore } from '../../storage/SessionStore';

type PushRequest = { mutations: Array<{ clientRequestId: string; clientCommandId: string; mutationType: string }> };

const HELD_CODE = 'entitlement.subscriptionexpired';
const OPEN_FARM = 'farm-open';

function refuseAllAsExpired() {
    pushBatchMock.mockImplementation(async (request: PushRequest) => ({
        serverTimeUtc: FROZEN_NOW_ISO,
        results: request.mutations.map(m => ({
            clientRequestId: m.clientRequestId,
            mutationType: m.mutationType,
            status: 'failed' as const,
            errorCode: HELD_CODE,
            errorMessage: 'Farm subscription has expired. Renew to continue.',
        })),
    }));
}

function applyAll() {
    pushBatchMock.mockImplementation(async (request: PushRequest) => ({
        serverTimeUtc: FROZEN_NOW_ISO,
        results: request.mutations.map(m => ({
            clientRequestId: m.clientRequestId,
            mutationType: m.mutationType,
            status: 'applied' as const,
        })),
    }));
}

async function rowFor(requestId: string) {
    return getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([mutationQueue.getDeviceId(), requestId])
        .first();
}

function sentIds(): string[] {
    return pushBatchMock.mock.calls.flatMap(call => (call[0] as PushRequest).mutations.map(m => m.clientRequestId));
}

let nowMs = Date.parse(FROZEN_NOW_ISO);

describe('BackgroundSyncWorker — HELD for the farm\'s trial / plan (spec R-11 c)', () => {
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* ignore */ }
        await resetDatabase();
        pushBatchMock.mockReset();
        syncSendMock.mockReset();
        nowMs = Date.parse(FROZEN_NOW_ISO);
        vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
        SessionStore.setCurrentFarmId(OPEN_FARM);
    });

    afterEach(() => {
        vi.mocked(Date.now).mockRestore();
    });

    it('keeps the row, charges nothing, stores the code, and never calls it a conflict', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        refuseAllAsExpired();

        await backgroundSyncWorker.triggerNow();

        const row = await rowFor(requestId);
        expect(row?.status).toBe('FAILED');
        expect(row?.retryCount).toBe(0);
        expect(row?.errorCode).toBe(HELD_CODE);
        expect(row?.nextRetryAfterMs).toBe(nowMs + HELD_RECHECK_MS);
        expect(await ConflictResolutionService.list()).toHaveLength(0);
        expect(syncSendMock.mock.calls.some(c => c[0]?.type === 'MUTATION_REJECTED')).toBe(false);
        expect(countHeldRows(await getDatabase().mutationQueue.toArray(), OPEN_FARM)).toBe(1);
    });

    it('is not re-sent before the recheck timer', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        refuseAllAsExpired();
        await backgroundSyncWorker.triggerNow();
        expect(sentIds()).toEqual([requestId]);

        nowMs += HELD_RECHECK_MS - 1000;
        await backgroundSyncWorker.triggerNow();

        expect(sentIds()).toEqual([requestId]);
    });

    it('never burns the five-retry cap, however long the farm stays refused', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        refuseAllAsExpired();

        for (let cycle = 0; cycle < MAX_AUTO_RETRY_COUNT * 3; cycle++) {
            await backgroundSyncWorker.triggerNow();
            nowMs += HELD_RECHECK_MS + 1;
        }

        const row = await rowFor(requestId);
        expect(sentIds().length).toBe(MAX_AUTO_RETRY_COUNT * 3);
        expect(row?.status).toBe('FAILED');
        expect(row?.retryCount).toBe(0);
        expect(await mutationQueue.getCapExhaustedFailed()).toHaveLength(0);
        expect(await ConflictResolutionService.list()).toHaveLength(0);
    });

    it('resumes by itself once the farm is allowed again — the same row, the same ids, once', async () => {
        const first = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { n: 1 });
        const second = await mutationQueue.enqueue(SyncMutationName.AddCostEntry, { n: 2 });
        refuseAllAsExpired();
        await backgroundSyncWorker.triggerNow();
        const commandIdsWhenHeld = (pushBatchMock.mock.calls[0][0] as PushRequest).mutations.map(m => m.clientCommandId);

        // The owner gets an access extension; nothing on the phone is touched.
        applyAll();
        nowMs += HELD_RECHECK_MS + 1;
        await backgroundSyncWorker.triggerNow();

        const rows = await getDatabase().mutationQueue.toArray();
        expect(rows).toHaveLength(2);
        expect(rows.every(r => r.status === 'APPLIED')).toBe(true);
        expect(rows.every(r => r.errorCode === undefined)).toBe(true);
        expect(countHeldRows(rows, OPEN_FARM)).toBe(0);

        const resent = pushBatchMock.mock.calls[1][0] as PushRequest;
        expect(resent.mutations.map(m => m.clientRequestId).sort()).toEqual([first, second].sort());
        expect(resent.mutations.map(m => m.clientCommandId).sort()).toEqual([...commandIdsWhenHeld].sort());

        // Nothing is sent a third time.
        nowMs += HELD_RECHECK_MS + 1;
        await backgroundSyncWorker.triggerNow();
        expect(sentIds().filter(id => id === first)).toHaveLength(2);
    });

    it('brings a row already at the cap back below it, so it goes by itself (M1)', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        // An older app charged this row for the same refusal until it sat at the cap.
        await getDatabase().mutationQueue.update((await rowFor(requestId))!.id!, {
            status: 'FAILED', retryCount: MAX_AUTO_RETRY_COUNT, lastError: 'Farm subscription has expired.',
        });
        expect(await mutationQueue.getCapExhaustedFailed()).toHaveLength(1);

        // One send (the farmer's tap) is refused as HELD by this app.
        refuseAllAsExpired();
        await backgroundSyncWorker.retryAllFailed();

        const held = await rowFor(requestId);
        expect(held?.status).toBe('FAILED');
        expect(held?.retryCount).toBeLessThan(MAX_AUTO_RETRY_COUNT);
        expect(await mutationQueue.getCapExhaustedFailed()).toHaveLength(0);

        // The farm is allowed again: the worker sends it by itself on the recheck timer.
        applyAll();
        nowMs += HELD_RECHECK_MS + 1;
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(requestId))?.status).toBe('APPLIED');
        expect(sentIds().filter(id => id === requestId)).toHaveLength(2);
    });

    it('a held row is counted only on the farm it was made on (M2)', async () => {
        await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });           // made on the open farm
        await mutationQueue.enqueue(SyncMutationName.AddCostEntry, { farmId: 'farm-other' });     // names its own farm
        refuseAllAsExpired();
        await backgroundSyncWorker.triggerNow();

        const rows = await getDatabase().mutationQueue.toArray();
        expect(rows.map(r => r.farmId).sort()).toEqual(['farm-open', 'farm-other']);
        expect(countHeldRows(rows, OPEN_FARM)).toBe(1);
        expect(countHeldRows(rows, 'farm-other')).toBe(1);
        expect(countHeldRows(rows, 'farm-fine')).toBe(0);
    });

    it('a tap on "Retry All" sends a held row at once', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        refuseAllAsExpired();
        await backgroundSyncWorker.triggerNow();

        applyAll();
        await backgroundSyncWorker.retryAllFailed();

        expect((await rowFor(requestId))?.status).toBe('APPLIED');
    });

    it('CONTROL: an ordinary retryable refusal is still charged', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        pushBatchMock.mockImplementation(async (request: PushRequest) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId, mutationType: m.mutationType,
                status: 'failed' as const, errorCode: undefined, errorMessage: 'connection reset by peer',
            })),
        }));

        await backgroundSyncWorker.triggerNow();

        const row = await rowFor(requestId);
        expect(row?.retryCount).toBe(1);
        expect(row?.errorCode).toBeUndefined();
    });
});
