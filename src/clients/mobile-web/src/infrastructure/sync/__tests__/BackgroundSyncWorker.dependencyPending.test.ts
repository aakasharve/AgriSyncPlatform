// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 box 2a — worker integration for the dependency-pending failure class.
 *
 * Before this landed, `ShramSafal.DailyLogNotFound` normalised to
 * `DAILYLOGNOTFOUND`, matched nothing in `PERMANENT_REJECTION_CODES`, and fell
 * through to `RETRYABLE` -> `markFailed(..., 'REJECTION')`. The child burned
 * five CHARGED retries for its parent's failure and then sat in cap-exhausted
 * `FAILED`, which no screen read. This file pins both halves of the correct
 * behaviour, and — most importantly — pins the loop the plan warns about.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase, type MutationQueueStatus } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-08-15T09:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-08-15T09:00:00.000Z',
        nextCursorUtc: '2026-08-15T09:00:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [],
        costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [],
        plannedActivities: [], auditEvents: [],
    }),
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return {
        ...actual,
        agriSyncClient: { pushSyncBatch: pushBatchMock, pullSyncChanges: pullChangesMock },
    };
});

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'test-user', accessToken: 'test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

vi.mock('../AiJobWorker', () => ({ AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) } }));

vi.mock('../../../app/state/RootStore', () => ({
    getRootStore: () => ({ sync: { send: vi.fn() } }),
}));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { SyncMutationName } from '../SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../retryCap';
import { parentClientRequestIdForDailyLog } from '../MutationDependency';
import { AddLogTaskCommand } from '../../../application/usecases/sync/AddLogTaskCommand';

const PARENT_LOG = '11111111-1111-4111-8111-111111111111';
const CHILD_TASK = '55555555-5555-4555-8555-555555555555';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

async function seedParent(status: MutationQueueStatus, retryCount = 0) {
    const key = parentClientRequestIdForDailyLog(PARENT_LOG);
    await getDatabase().mutationQueue.add({
        deviceId: mutationQueue.getDeviceId(),
        clientRequestId: key,
        clientCommandId: key,
        mutationType: SyncMutationName.CreateDailyLog,
        payload: { dailyLogId: PARENT_LOG },
        status,
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount,
    });
}

async function enqueueChild(): Promise<string> {
    return AddLogTaskCommand.enqueue({
        dailyLogId: PARENT_LOG,
        logTaskId: CHILD_TASK,
        activityType: 'spray',
    });
}

async function readChild(clientRequestId: string) {
    return getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([mutationQueue.getDeviceId(), clientRequestId])
        .first();
}

/** The server's real answer — `ShramSafalErrors.cs:29`. */
function respondDailyLogNotFound() {
    pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
        serverTimeUtc: FROZEN_NOW_ISO,
        results: request.mutations.map(m => ({
            clientRequestId: m.clientRequestId,
            mutationType: m.mutationType,
            status: 'failed' as const,
            errorCode: 'ShramSafal.DailyLogNotFound',
            errorMessage: 'Daily log was not found.',
        })),
    }));
}

describe('BackgroundSyncWorker — §P0.7 box 2a: DailyLogNotFound is not the child\'s fault', () => {
    beforeEach(async () => {
        await freshDb();
        pushBatchMock.mockReset();
        respondDailyLogNotFound();
    });

    it('child_of_a_live_parent_is_not_charged_a_retry_and_says_which_log_it_waits_for', async () => {
        await seedParent('SENDING');
        const childId = await enqueueChild();

        await backgroundSyncWorker.triggerNow();

        const child = await readChild(childId);
        expect(child?.status).toBe('FAILED');
        // THE REGRESSION THIS PINS: before §P0.7 this was 1, and five cycles of
        // an ordinary out-of-order batch stranded the row permanently.
        expect(child?.retryCount).toBe(0);
        expect(child?.lastError).toContain(PARENT_LOG);
    });

    it('child_of_a_parent_parked_in_REJECTED_USER_REVIEW_is_rejected_not_retried_forever', async () => {
        // THE TRAP. A "parent still open" rule reads this parent as open — it is
        // neither applied nor discarded — so the child would stay retryable and
        // UNCHARGED and re-push every 15 seconds for the life of the install.
        await seedParent('REJECTED_USER_REVIEW', 1);
        const childId = await enqueueChild();

        await backgroundSyncWorker.triggerNow();

        const child = await readChild(childId);
        expect(child?.status).toBe('REJECTED_USER_REVIEW');
        expect(child?.lastError).toContain(PARENT_LOG);
        expect(child?.lastError).toContain('REJECTED_USER_REVIEW');

        // And it stays escalated: two more cycles must not put it back on the
        // wire. That is the "does NOT loop" half, measured on the wire itself.
        const pushesAfterFirstCycle = pushBatchMock.mock.calls.length;
        await backgroundSyncWorker.triggerNow();
        await backgroundSyncWorker.triggerNow();

        for (let call = pushesAfterFirstCycle; call < pushBatchMock.mock.calls.length; call++) {
            const batch = pushBatchMock.mock.calls[call][0] as { mutations: Array<{ clientRequestId: string }> };
            expect(
                batch.mutations.some(m => m.clientRequestId === childId),
                `cycle ${call + 1} re-pushed a child whose parent will never move`,
            ).toBe(false);
        }
    });

    it('child_of_a_cap_exhausted_parent_is_rejected_not_retried_forever', async () => {
        await seedParent('FAILED', MAX_AUTO_RETRY_COUNT);
        const childId = await enqueueChild();

        await backgroundSyncWorker.triggerNow();

        const child = await readChild(childId);
        expect(child?.status).toBe('REJECTED_USER_REVIEW');
        expect(child?.lastError).toContain(PARENT_LOG);
    });

    it('child_with_no_parent_row_at_all_is_rejected_immediately', async () => {
        const childId = await enqueueChild();

        await backgroundSyncWorker.triggerNow();

        const child = await readChild(childId);
        expect(child?.status).toBe('REJECTED_USER_REVIEW');
        expect(child?.lastError).toContain(PARENT_LOG);
    });

    it('DailyLogNotFound_about_an_APPLIED_parent_keeps_the_old_classification', async () => {
        // Not a dependency problem: the server acknowledged this log. The rule
        // must not reinterpret a refusal it cannot diagnose.
        await seedParent('APPLIED');
        const childId = await enqueueChild();

        await backgroundSyncWorker.triggerNow();

        const child = await readChild(childId);
        expect(child?.status).toBe('FAILED');
        expect(child?.retryCount).toBe(1);
    });

    it('an_unrelated_rejection_is_untouched_by_the_dependency_rule', async () => {
        await seedParent('SENDING');
        const childId = await enqueueChild();
        pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
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

        const child = await readChild(childId);
        expect(child?.status).toBe('REJECTED_USER_REVIEW');
        expect(child?.lastError).toBe('Client version is too old');
    });
});
