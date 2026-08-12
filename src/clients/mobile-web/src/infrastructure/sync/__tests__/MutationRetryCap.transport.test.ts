// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T3 — findings R1 + R2.
 *
 * Two defects, one screen:
 *
 *   R1  Five 15-second cycles — 75 seconds — of a bad-but-live connection
 *       pushed every row past `retryCount >= 5`, after which
 *       `markFailedAsPending` refused to touch them again FOREVER, including
 *       after the network came back. True airplane mode was safe; a bad
 *       connection, the rural default, was not.
 *
 *   R2  The remedy the chip pointed at was a silent no-op: "Retry All" called
 *       `markFailedAsPending()` with no argument, so it re-applied the very cap
 *       the farmer was complaining about, while the small per-row "Retry"
 *       beside it worked.
 *
 * Everything below the network boundary is the real worker, the real
 * MutationQueue and real (fake-indexeddb) Dexie.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-08-12T09:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
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
vi.mock('../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue, MAX_AUTO_RETRY_COUNT } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { SyncMutationName } from '../SyncMutationCatalog';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
}

function networkError(message = 'Network Error'): Error {
    return Object.assign(new Error(message), { isAxiosError: true, code: 'ERR_NETWORK' });
}

function httpError(status: number): Error {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data: {} },
    });
}

function appliedResponse(request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) {
    return {
        serverTimeUtc: FROZEN_NOW_ISO,
        results: request.mutations.map(m => ({
            clientRequestId: m.clientRequestId,
            mutationType: m.mutationType,
            status: 'applied' as const,
        })),
    };
}

async function rowFor(clientRequestId: string) {
    return getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([mutationQueue.getDeviceId(), clientRequestId])
        .first();
}

function pushCallsIncluding(clientRequestId: string): number {
    return pushBatchMock.mock.calls.filter(call => {
        const body = call[0] as { mutations: Array<{ clientRequestId: string }> };
        return body.mutations.some(m => m.clientRequestId === clientRequestId);
    }).length;
}

async function runCycles(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        await backgroundSyncWorker.triggerNow();
    }
}

describe('the auto-retry cap counts server verdicts, not bad signal (R1)', () => {
    beforeEach(async () => {
        await freshDb();
        pushBatchMock.mockReset();
        pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => appliedResponse(request));
    });

    it('survives far more than the cap in pure transport failures and still syncs when the network returns', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });

        // Captive wifi / dead tower: navigator.onLine stays TRUE, so the worker
        // keeps running — this is the case airplane mode does NOT protect.
        pushBatchMock.mockRejectedValue(networkError());
        await runCycles(MAX_AUTO_RETRY_COUNT + 3);

        let row = await rowFor(requestId);
        expect(row?.status).toBe('FAILED');
        // Never charged: the row's own validity was never assessed.
        expect(row?.retryCount).toBe(0);
        // And it is still being TRIED — this is the assertion that fails if the
        // cap re-latches: the queue must have offered the row on every cycle.
        expect(pushCallsIncluding(requestId)).toBe(MAX_AUTO_RETRY_COUNT + 3);

        // The network comes back. Nothing else happens — no farmer tap.
        pushBatchMock.mockReset();
        pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => appliedResponse(request));
        await runCycles(1);

        row = await rowFor(requestId);
        expect(row?.status).toBe('APPLIED');
    });

    it('treats a 503 from a live server the same way — the server is down, the record is not wrong', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });

        pushBatchMock.mockRejectedValue(httpError(503));
        await runCycles(MAX_AUTO_RETRY_COUNT + 2);

        const row = await rowFor(requestId);
        expect(row?.status).toBe('FAILED');
        expect(row?.retryCount).toBe(0);
    });

    it('still bounds a genuinely unacceptable payload — HTTP 400 is charged and auto-retry stops at the cap', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });

        pushBatchMock.mockRejectedValue(httpError(400));
        await runCycles(MAX_AUTO_RETRY_COUNT);

        let row = await rowFor(requestId);
        expect(row?.status).toBe('FAILED');
        expect(row?.retryCount).toBe(MAX_AUTO_RETRY_COUNT);
        expect(pushCallsIncluding(requestId)).toBe(MAX_AUTO_RETRY_COUNT);

        // Three more cycles: the worker must NOT offer it again. THE BOUND.
        await runCycles(3);
        expect(pushCallsIncluding(requestId)).toBe(MAX_AUTO_RETRY_COUNT);

        row = await rowFor(requestId);
        expect(row?.retryCount).toBe(MAX_AUTO_RETRY_COUNT);
    });

    it('charges a per-row server refusal even when the category is retryable', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });

        pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId,
                mutationType: m.mutationType,
                status: 'failed' as const,
                errorCode: undefined,
                errorMessage: 'connection reset by peer',
            })),
        }));

        await runCycles(2);
        expect((await rowFor(requestId))?.retryCount).toBe(2);

        await runCycles(MAX_AUTO_RETRY_COUNT);
        const row = await rowFor(requestId);
        expect(row?.retryCount).toBe(MAX_AUTO_RETRY_COUNT);
        expect(row?.status).toBe('FAILED');
    });

    it('charges a row this client cannot send at all', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        const row = await rowFor(requestId);
        await getDatabase().mutationQueue.update(row!.id as number, { mutationType: 'not_a_real_mutation' });

        await runCycles(1);

        expect((await rowFor(requestId))?.retryCount).toBe(1);
        expect(pushBatchMock).not.toHaveBeenCalled();
    });
});

describe('"Retry All" reaches the rows the farmer came to complain about (R2)', () => {
    beforeEach(async () => {
        await freshDb();
        pushBatchMock.mockReset();
        pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => appliedResponse(request));
    });

    it('moves a retryCount = 5 row back to PENDING', async () => {
        // The exact assertion the architect specified for this task.
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        const seeded = await rowFor(requestId);
        await getDatabase().mutationQueue.update(seeded!.id as number, {
            status: 'FAILED',
            retryCount: MAX_AUTO_RETRY_COUNT,
            lastError: 'Request failed with status code 400',
        });

        await mutationQueue.retryAllFailedByUser();

        expect((await rowFor(requestId))?.status).toBe('PENDING');
    });

    it('the drawer button end to end: a capped row is re-sent and acknowledged', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        const seeded = await rowFor(requestId);
        await getDatabase().mutationQueue.update(seeded!.id as number, {
            status: 'FAILED',
            retryCount: MAX_AUTO_RETRY_COUNT + 4,
        });

        const result = await backgroundSyncWorker.retryAllFailed();

        expect(result.mutations).toBe(1);
        expect((await rowFor(requestId))?.status).toBe('APPLIED');
    });

    it('one tap buys exactly one attempt — it does not re-open an infinite loop', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        pushBatchMock.mockRejectedValue(httpError(400));
        await runCycles(MAX_AUTO_RETRY_COUNT);
        const chargedBefore = pushCallsIncluding(requestId);

        await backgroundSyncWorker.retryAllFailed();
        expect(pushCallsIncluding(requestId)).toBe(chargedBefore + 1);

        // And the row is capped again straight away.
        await runCycles(3);
        expect(pushCallsIncluding(requestId)).toBe(chargedBefore + 1);
        expect((await rowFor(requestId))?.retryCount).toBe(MAX_AUTO_RETRY_COUNT + 1);
    });

    it('does not resurrect a durable rejection — that row needs the conflict screen, not a re-send', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        const seeded = await rowFor(requestId);
        await mutationQueue.markRejectedUserReview(seeded!.id as number, 'CLIENT_TOO_OLD');

        await backgroundSyncWorker.retryAllFailed();

        expect((await rowFor(requestId))?.status).toBe('REJECTED_USER_REVIEW');
    });

    it('leaves the automatic path capped — only the farmer gets the uncapped one', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        const seeded = await rowFor(requestId);
        await getDatabase().mutationQueue.update(seeded!.id as number, {
            status: 'FAILED',
            retryCount: MAX_AUTO_RETRY_COUNT,
        });

        await mutationQueue.markFailedAsPending();

        expect((await rowFor(requestId))?.status).toBe('FAILED');
    });

    it('per-row Retry behaviour is unchanged — it ignores the cap, as it always has', async () => {
        const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        const seeded = await rowFor(requestId);
        await getDatabase().mutationQueue.update(seeded!.id as number, {
            status: 'FAILED',
            retryCount: MAX_AUTO_RETRY_COUNT + 2,
        });

        await backgroundSyncWorker.retryFailed(requestId);

        expect((await rowFor(requestId))?.status).toBe('APPLIED');
    });
});

/*
 * DELETED — `describe('the cap has one number, however many modules read it')`.
 *
 * It asserted `MAX_AUTO_RETRY_COUNT === CHIP_MAX_AUTO_RETRY_COUNT` while the
 * two were separate literals, and its own comment said so: *"Until they are
 * collapsed into one import, this is the guard that stops them drifting."*
 * They have now been collapsed — `syncHonestyState.ts` re-exports THIS
 * module's constant, so the two names are one binding and the assertion is
 * `5 === 5` under two aliases. A tautology that reads like a guard is worse
 * than no guard: it occupies the slot where a real one would go.
 *
 * The invariant it protected is now structural, not tested. Everything else in
 * this file still exercises the cap through the real queue.
 */
