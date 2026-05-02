// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 / T-IGH-04-CONFLICT-STATUS-DURABILITY — worker integration.
 *
 * End-to-end lock for the durability contract: a permanently-rejected
 * mutation lands in REJECTED_USER_REVIEW after the first cycle and stays
 * there across subsequent cycles. A transiently-rejected mutation ends in
 * FAILED, gets auto-retried, and either succeeds or fails again — but
 * never becomes REJECTED_USER_REVIEW.
 *
 * Mocks the network boundary (agriSyncClient.pushSyncBatch +
 * pullSyncChanges) and the auth check; everything below the boundary is
 * the real BackgroundSyncWorker, MutationQueue, and Dexie (via
 * fake-indexeddb).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

// Stable clock for the test.
const FROZEN_NOW_ISO = '2026-04-01T12:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

// ---- Module mocks ----
//
// vi.hoisted() lifts the mock fns above vi.mock() factory hoisting so the
// factory can reference them without a "Cannot access X before
// initialization" error.
const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-04-01T12:00:00.000Z',
        nextCursorUtc: '2026-04-01T12:00:00.000Z',
        farms: [],
        plots: [],
        cropCycles: [],
        dailyLogs: [],
        attachments: [],
        costEntries: [],
        financeCorrections: [],
        dayLedgers: [],
        priceConfigs: [],
        plannedActivities: [],
        auditEvents: [],
    }),
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>(
        '../../api/AgriSyncClient'
    );
    return {
        ...actual,
        agriSyncClient: {
            pushSyncBatch: pushBatchMock,
            pullSyncChanges: pullChangesMock,
        },
    };
});

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'test-user', accessToken: 'test', refreshToken: 'test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

// reconcileSyncPull writes to localStorage; no-op it for this test.
vi.mock('../SyncPullReconciler', () => ({
    reconcileSyncPull: vi.fn().mockResolvedValue(undefined),
}));

// PayloadValidator enforces sync-contract schemas at enqueue time.
// Keep this test focused on durability semantics — accept any payload.
vi.mock('../PayloadValidator', () => ({
    validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }),
}));

// AiJobWorker.run does its own work — skip.
vi.mock('../AiJobWorker', () => ({
    AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) },
}));

// Stub the syncMachine so notifySync doesn't crash when there's no app
// shell mounted. The worker uses getRootStore() inside a try/catch, so
// even a failing import would be caught — but mocking is cleaner.
vi.mock('../../../app/state/RootStore', () => ({
    getRootStore: () => ({
        sync: { send: vi.fn() },
    }),
}));

// navigator.onLine = true (jsdom defaults to true; explicit for clarity).
Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

// Imports come AFTER vi.mock so hoisted mocks register first.
import { mutationQueue } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { ConflictResolutionService } from '../../../features/sync/conflict/ConflictResolutionService';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

describe('BackgroundSyncWorker — T-IGH-04-CONFLICT-STATUS-DURABILITY (worker integration)', () => {
    beforeEach(async () => {
        await freshDb();
        pushBatchMock.mockReset();
        // Default to applied for any mutation we don't explicitly script.
        pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId,
                mutationType: m.mutationType,
                status: 'applied' as const,
            })),
        }));
    });

    it('permanently-rejected mutation lands in REJECTED_USER_REVIEW after one cycle', async () => {
        const requestId = await mutationQueue.enqueue('create_daily_log', { sample: true });
        pushBatchMock.mockImplementationOnce(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId,
                mutationType: m.mutationType,
                status: 'failed' as const,
                errorCode: 'CLIENT_TOO_OLD',
                errorMessage: 'Client version is too old',
            })),
        }));

        await backgroundSyncWorker.triggerNow();

        const row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), requestId])
            .first();
        expect(row?.status).toBe('REJECTED_USER_REVIEW');
        expect(row?.lastError).toContain('Client version is too old');
    });

    it('REJECTED_USER_REVIEW persists across 3 cycles (auto-retry isolation)', async () => {
        const requestId = await mutationQueue.enqueue('create_daily_log', { sample: true });

        // First cycle: permanent rejection → REJECTED_USER_REVIEW.
        pushBatchMock.mockImplementationOnce(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId,
                mutationType: m.mutationType,
                status: 'failed' as const,
                errorCode: 'MUTATION_TYPE_UNIMPLEMENTED',
                errorMessage: 'Server has not implemented this mutation',
            })),
        }));
        await backgroundSyncWorker.triggerNow();

        // Subsequent cycles: pushBatchMock default returns 'applied' for any
        // mutation in the batch. If our row were re-queued by
        // markFailedAsPending it would be applied here — but durability says
        // it must NOT be re-queued.
        await backgroundSyncWorker.triggerNow();
        await backgroundSyncWorker.triggerNow();

        const row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), requestId])
            .first();
        expect(row?.status).toBe('REJECTED_USER_REVIEW');

        // Sanity: the worker should not have called pushSyncBatch with our
        // row in cycles 2 or 3 (because getPending() excludes durable
        // statuses). Calls 1 had it; calls 2/3 should have empty mutations
        // arrays (or simply not include it).
        for (let i = 1; i < pushBatchMock.mock.calls.length; i++) {
            const call = pushBatchMock.mock.calls[i][0] as { mutations: Array<{ clientRequestId: string }> };
            const includes = call.mutations.some(m => m.clientRequestId === requestId);
            expect(includes, `Cycle ${i + 1} must not retry the durable rejection`).toBe(false);
        }
    });

    it('transiently-failed mutation stays as FAILED, gets re-queued, and can succeed on retry', async () => {
        const requestId = await mutationQueue.enqueue('create_daily_log', { sample: true });

        // Cycle 1: transient failure (no errorCode → fall through to RETRYABLE).
        pushBatchMock.mockImplementationOnce(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId,
                mutationType: m.mutationType,
                status: 'failed' as const,
                errorCode: undefined,
                errorMessage: 'connection reset by peer',
            })),
        }));
        await backgroundSyncWorker.triggerNow();

        // Should be FAILED after cycle 1.
        let row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), requestId])
            .first();
        expect(row?.status).toBe('FAILED');

        // Cycle 2: markFailedAsPending flips to PENDING; default mock applies it.
        await backgroundSyncWorker.triggerNow();

        row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), requestId])
            .first();
        expect(row?.status).toBe('APPLIED');
    });

    it('ConflictResolutionService.list returns the durable rejection; discard soft-deletes it', async () => {
        const requestId = await mutationQueue.enqueue('create_daily_log', { sample: true });
        pushBatchMock.mockImplementationOnce(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId,
                mutationType: m.mutationType,
                status: 'failed' as const,
                errorCode: 'FORBIDDEN',
                errorMessage: 'Insufficient permissions',
            })),
        }));
        await backgroundSyncWorker.triggerNow();

        const list = await ConflictResolutionService.list();
        expect(list).toHaveLength(1);
        expect(list[0].mutationId).toBe(requestId);
        expect(list[0].reason).toContain('Insufficient permissions');
        // Hint matching is unit-tested in ConflictResolutionService /
        // OfflineConflictPage tests; integration test focuses on the
        // durable state-machine boundary.

        // Discard soft-deletes — row stays in Dexie as REJECTED_DROPPED.
        await ConflictResolutionService.discard(requestId);

        const row = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), requestId])
            .first();
        expect(row?.status).toBe('REJECTED_DROPPED');

        // list() no longer returns it (excludes REJECTED_DROPPED).
        const listAfter = await ConflictResolutionService.list();
        expect(listAfter).toHaveLength(0);
    });
});
