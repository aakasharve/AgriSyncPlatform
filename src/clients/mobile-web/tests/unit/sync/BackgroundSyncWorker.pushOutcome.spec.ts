// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a Task C3,
 * ADR 0027 D2).
 *
 * At the end of a sync cycle the worker reports, once, what happened to work
 * that had failed:
 *   recoveredCount     saves applied in this cycle that had failed before
 *   needsReviewCount   saves sent to the farmer to review in this cycle
 *   pendingAfter       saves still PENDING, SENDING or FAILED after the cycle
 *   appVersion         the app's own version
 *   firstFailedAtUtc   the earliest first failure among the recovered saves
 * and it says nothing at all when both of the first two are zero.
 *
 * The harness is the one the worker tests under
 * `src/infrastructure/sync/__tests__` use (they export no helpers, so it is
 * written out again here): the real BackgroundSyncWorker, the real
 * MutationQueue and real (fake-indexeddb) Dexie, with only the network
 * boundary, the sign-in check and the pull reconciler replaced. One more
 * module is replaced: `emitSyncPushOutcome` in `core/telemetry/eventEmitters`
 * is a recording stand-in, so each test reads the report the worker handed
 * over. Every other emitter in that module stays real.
 *
 * A cycle is driven with `backgroundSyncWorker.triggerNow()`; the farmer's
 * retry with `mutationQueue.retryAllFailedByUser()`. The clock is moved with
 * `vi.setSystemTime`, which moves `Date.now()` and `new Date()` together.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../../src/infrastructure/storage/DexieDatabase';

const { pushBatchMock, pullChangesMock, emitSyncPushOutcomeMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-11-14T06:30:00.000Z',
        nextCursorUtc: '2026-11-14T06:30:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [],
        financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
    }),
    emitSyncPushOutcomeMock: vi.fn(),
}));

vi.mock('../../../src/infrastructure/api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../../src/infrastructure/api/AgriSyncClient')>(
        '../../../src/infrastructure/api/AgriSyncClient');
    return { ...actual, agriSyncClient: { pushSyncBatch: pushBatchMock, pullSyncChanges: pullChangesMock } };
});
vi.mock('../../../src/infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'test-user', accessToken: 'test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));
vi.mock('../../../src/features/sync/pull/SyncPullReconciler', () => ({
    reconcileSyncPull: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/infrastructure/sync/PayloadValidator', () => ({
    validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }),
}));
vi.mock('../../../src/infrastructure/sync/AiJobWorker', () => ({
    AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../src/app/state/RootStore', () => ({
    getRootStore: () => ({ sync: { send: vi.fn() } }),
}));

// The report's way out of the worker. Only this one emitter is replaced.
vi.mock('../../../src/core/telemetry/eventEmitters', async () => {
    const actual = await vi.importActual<typeof import('../../../src/core/telemetry/eventEmitters')>(
        '../../../src/core/telemetry/eventEmitters');
    return { ...actual, emitSyncPushOutcome: emitSyncPushOutcomeMock };
});

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue, HELD_RECHECK_MS } from '../../../src/infrastructure/sync/MutationQueue';
import { backgroundSyncWorker } from '../../../src/infrastructure/sync/BackgroundSyncWorker';
import { SyncMutationName } from '../../../src/infrastructure/sync/SyncMutationCatalog';
import { parentClientRequestIdForDailyLog } from '../../../src/infrastructure/sync/MutationDependency';
import { APP_VERSION } from '../../../src/buildInfo';

type PushRequest = { mutations: Array<{ clientRequestId: string; clientCommandId: string; mutationType: string }> };

type Verdict =
    | { status: 'applied' }
    | { status: 'duplicate' }
    | { status: 'failed'; errorCode?: string; errorMessage?: string };

/** The server stored the save. */
const APPLIED: Verdict = { status: 'applied' };

/** The server already has this save from an earlier request: the same ids, sent again. */
const ALREADY_HAS_IT: Verdict = { status: 'duplicate' };

/**
 * The server does not have the record this save belongs to. That says nothing
 * about the save itself: what happens to it depends on what the record's own
 * save is doing on this phone.
 */
const ITS_RECORD_IS_NOT_ON_THE_SERVER: Verdict = {
    status: 'failed',
    errorCode: 'ShramSafal.DailyLogNotFound',
    errorMessage: 'Daily log was not found.',
};

/** A refusal only the farmer can settle: the same bytes get the same answer for ever. */
const REFUSED_FOR_REVIEW: Verdict = {
    status: 'failed',
    errorCode: 'ShramSafal.InvalidCommand',
    errorMessage: 'The command is not valid.',
};

/** A refusal the worker tries again by itself. */
const REFUSED_FOR_NOW: Verdict = {
    status: 'failed',
    errorCode: undefined,
    errorMessage: 'connection reset by peer',
};

/** The farm's trial or plan does not allow the save right now. A wait, not a failure. */
const HELD_FOR_THE_PLAN: Verdict = {
    status: 'failed',
    errorCode: 'entitlement.subscriptionexpired',
    errorMessage: 'Farm subscription has expired. Renew to continue.',
};

/** 06:30 UTC on 14 November 2026. */
const START_MS = Date.parse('2026-11-14T06:30:00.000Z');

/** Longer than the queue's longest backoff (60 s), so a failed save is due again. */
const PAST_ANY_BACKOFF_MS = 61 * 1000;

let nowMs = START_MS;

const iso = (ms: number): string => new Date(ms).toISOString();

function setClock(ms: number) {
    nowMs = ms;
    vi.setSystemTime(ms);
}

function advance(ms: number) {
    setClock(nowMs + ms);
}

/** The server answers every save in the batch, each as `verdictFor` says. */
function serverAnswers(verdictFor: (clientRequestId: string) => Verdict) {
    pushBatchMock.mockImplementation(async (request: PushRequest) => ({
        serverTimeUtc: iso(nowMs),
        results: request.mutations.map(m => ({
            clientRequestId: m.clientRequestId,
            mutationType: m.mutationType,
            ...verdictFor(m.clientRequestId),
        })),
    }));
}

/** The phone is online but the request reaches nothing that can answer: the whole batch fails. */
function serverCannotBeReached() {
    pushBatchMock.mockRejectedValue(
        Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }));
}

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run: nothing to delete
    }
    await resetDatabase();
}

async function rowFor(clientRequestId: string) {
    const row = await getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([mutationQueue.getDeviceId(), clientRequestId])
        .first();
    expect(row, `queue row ${clientRequestId}`).toBeDefined();
    return row!;
}

/** Queues one save, as a screen does, and returns its client request id. */
function save(payload: unknown = { sample: true }): Promise<string> {
    return mutationQueue.enqueue(SyncMutationName.CreateDailyLog, payload);
}

/** The reports the worker has handed over since the stand-in was last cleared. */
function reports(): Array<Record<string, unknown>> {
    return emitSyncPushOutcomeMock.mock.calls.map(call => call[0] as Record<string, unknown>);
}

/** Exactly one report was handed over; returns it. */
function theOneReport(): Record<string, unknown> {
    expect(emitSyncPushOutcomeMock).toHaveBeenCalledTimes(1);
    return reports()[0];
}

describe('BackgroundSyncWorker — the report of what happened to work that had failed (plan CR-1a Task C3)', () => {
    beforeEach(async () => {
        setClock(START_MS);
        await freshDb();
        pushBatchMock.mockReset();
        pullChangesMock.mockClear();
        emitSyncPushOutcomeMock.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('reports recovered when a row that had failed is applied', async () => {
        const id = await save();

        // The app reaches out and the attempt fails.
        serverCannotBeReached();
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(id)).status).toBe('FAILED');
        expect(emitSyncPushOutcomeMock, 'a failure alone is not an outcome yet: nothing arrived, nothing needs the farmer')
            .not.toHaveBeenCalled();

        // The next try succeeds.
        const failedAtMs = nowMs;
        advance(PAST_ANY_BACKOFF_MS);
        serverAnswers(() => APPLIED);
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(id)).status).toBe('APPLIED');
        expect(theOneReport()).toEqual({
            recoveredCount: 1,
            needsReviewCount: 0,
            pendingAfter: 0,
            appVersion: APP_VERSION,
            firstFailedAtUtc: iso(failedAtMs),
        });

        // It is said once, in the cycle it happened in. A later cycle with
        // nothing to send does not say it again.
        advance(PAST_ANY_BACKOFF_MS);
        await backgroundSyncWorker.triggerNow();
        expect(emitSyncPushOutcomeMock).toHaveBeenCalledTimes(1);
    });

    it('reports recovered after a failure whose backoff was cleared', async () => {
        const id = await save();

        serverCannotBeReached();
        await backgroundSyncWorker.triggerNow();
        const failedAtMs = nowMs;
        expect((await rowFor(id)).attemptCount).toBe(1);

        // The farmer taps "Retry All". That clears the backoff, and with it
        // the attempt counter: by the counters alone, this row now looks like
        // one that has never been tried.
        advance(5 * 1000);
        expect(await mutationQueue.retryAllFailedByUser()).toBe(1);

        const cleared = await rowFor(id);
        expect(cleared.status).toBe('PENDING');
        expect(cleared.attemptCount).toBe(0);
        expect(cleared.retryCount).toBe(0);
        expect(cleared.nextRetryAfterMs).toBeUndefined();

        serverAnswers(() => APPLIED);
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(id)).status).toBe('APPLIED');
        expect(theOneReport()).toEqual({
            recoveredCount: 1,
            needsReviewCount: 0,
            pendingAfter: 0,
            appVersion: APP_VERSION,
            firstFailedAtUtc: iso(failedAtMs),
        });
    });

    it('reports recovered when a refused save the farmer corrected is applied', async () => {
        const id = await save({ note: 'as first saved' });

        // The server refuses it outright; it is sent to the farmer.
        serverAnswers(() => REFUSED_FOR_REVIEW);
        await backgroundSyncWorker.triggerNow();
        const refusedAtMs = nowMs;

        expect((await rowFor(id)).status).toBe('REJECTED_USER_REVIEW');
        expect(theOneReport()).toMatchObject({ recoveredCount: 0, needsReviewCount: 1 });
        emitSyncPushOutcomeMock.mockClear();

        // The farmer corrects it. It is the same piece of work.
        advance(2 * 60 * 1000);
        expect(await mutationQueue.replacePayload(id, { note: 'as corrected' })).toBe(true);

        serverAnswers(() => APPLIED);
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(id)).status).toBe('APPLIED');
        expect(theOneReport()).toEqual({
            recoveredCount: 1,
            needsReviewCount: 0,
            pendingAfter: 0,
            appVersion: APP_VERSION,
            firstFailedAtUtc: iso(refusedAtMs),
        });
    });

    it('says nothing when every applied row succeeded first time', async () => {
        const first = await save({ n: 1 });
        const second = await save({ n: 2 });

        serverAnswers(() => APPLIED);
        await backgroundSyncWorker.triggerNow();

        // Both really went: this was a cycle with work in it.
        expect((await rowFor(first)).status).toBe('APPLIED');
        expect((await rowFor(second)).status).toBe('APPLIED');
        expect(pushBatchMock).toHaveBeenCalledTimes(1);

        // A save that goes through on its first attempt is ordinary work,
        // not a failure that recovered. That includes a save made with no
        // network and sent later: the worker runs no cycle while offline, so
        // its first attempt is this one.
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        // And a cycle with nothing to send says nothing either.
        await backgroundSyncWorker.triggerNow();
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();
    });

    it('counts a row sent for the farmer to review, and does not call it recovered', async () => {
        const id = await save();

        serverAnswers(() => REFUSED_FOR_REVIEW);
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(id)).status).toBe('REJECTED_USER_REVIEW');

        const report = theOneReport();
        expect(report).toEqual({
            recoveredCount: 0,
            needsReviewCount: 1,
            pendingAfter: 0,
            appVersion: APP_VERSION,
        });
        expect(report.firstFailedAtUtc, 'no save recovered, so there is no first failure to name').toBeUndefined();

        // It is counted in the cycle it was sent for review, not in every
        // cycle it then sits there.
        emitSyncPushOutcomeMock.mockClear();
        advance(PAST_ANY_BACKOFF_MS);
        await backgroundSyncWorker.triggerNow();
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        // A save that had failed before, and is THEN refused for review, has
        // not arrived: it needs the farmer, and it is not called recovered.
        const later = await save({ n: 2 });
        serverCannotBeReached();
        await backgroundSyncWorker.triggerNow();
        expect((await rowFor(later)).status).toBe('FAILED');
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        advance(PAST_ANY_BACKOFF_MS);
        serverAnswers(() => REFUSED_FOR_REVIEW);
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(later)).status).toBe('REJECTED_USER_REVIEW');
        const second = theOneReport();
        expect(second).toEqual({
            recoveredCount: 0,
            needsReviewCount: 1,
            pendingAfter: 0,
            appVersion: APP_VERSION,
        });
        expect(second.firstFailedAtUtc).toBeUndefined();
    });

    it('pendingAfter counts rows still waiting or failed', async () => {
        const arrives = await save({ n: 1 });
        const failsAgain = await save({ n: 2 });

        // Both fail once.
        serverCannotBeReached();
        await backgroundSyncWorker.triggerNow();
        const failedAtMs = nowMs;
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        // Three more rows that the next cycle will not send:
        // one waiting out a delay of its own (PENDING, not due for ten minutes),
        const notDueYet = await save({ n: 3 });
        await getDatabase().mutationQueue.update((await rowFor(notDueYet)).id!, {
            nextRetryAfterMs: nowMs + 10 * 60 * 1000,
        });
        // one already sent to the farmer in an earlier cycle,
        const withTheFarmer = await save({ n: 4 });
        await getDatabase().mutationQueue.update((await rowFor(withTheFarmer)).id!, {
            status: 'REJECTED_USER_REVIEW',
        });
        // and one that arrived long ago.
        const arrivedLongAgo = await save({ n: 5 });
        await getDatabase().mutationQueue.update((await rowFor(arrivedLongAgo)).id!, {
            status: 'APPLIED',
        });

        advance(PAST_ANY_BACKOFF_MS);
        serverAnswers(id => (id === arrives ? APPLIED : REFUSED_FOR_NOW));
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(arrives)).status).toBe('APPLIED');
        expect((await rowFor(failsAgain)).status).toBe('FAILED');
        expect((await rowFor(notDueYet)).status).toBe('PENDING');
        expect((await rowFor(withTheFarmer)).status).toBe('REJECTED_USER_REVIEW');
        expect((await rowFor(arrivedLongAgo)).status).toBe('APPLIED');

        // Still on the phone and not settled: the one that failed again and
        // the one that is waiting. A save with the farmer and a save that
        // arrived are not "pending".
        expect(theOneReport()).toEqual({
            recoveredCount: 1,
            needsReviewCount: 0,
            pendingAfter: 2,
            appVersion: APP_VERSION,
            firstFailedAtUtc: iso(failedAtMs),
        });
    });

    it('sends one report for a whole cycle, naming the earliest first failure', async () => {
        // One save fails at 06:30.
        const early = await save({ n: 1 });
        serverCannotBeReached();
        await backgroundSyncWorker.triggerNow();
        const earlyFailedAtMs = nowMs;

        // Five minutes later a second save is made, and both fail.
        advance(5 * 60 * 1000);
        const late = await save({ n: 2 });
        await backgroundSyncWorker.triggerNow();
        expect((await rowFor(early)).status).toBe('FAILED');
        expect((await rowFor(late)).status).toBe('FAILED');
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        // Then the server is back. Both arrive, and a third save, made in
        // the meantime, is refused for the farmer to review.
        advance(PAST_ANY_BACKOFF_MS);
        const refused = await save({ n: 3 });
        serverAnswers(id => (id === refused ? REFUSED_FOR_REVIEW : APPLIED));
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(early)).status).toBe('APPLIED');
        expect((await rowFor(late)).status).toBe('APPLIED');
        expect((await rowFor(refused)).status).toBe('REJECTED_USER_REVIEW');

        // One report for the cycle, not one per save.
        expect(theOneReport()).toEqual({
            recoveredCount: 2,
            needsReviewCount: 1,
            pendingAfter: 0,
            appVersion: APP_VERSION,
            firstFailedAtUtc: iso(earlyFailedAtMs),
        });
    });

    it('a whole batch that fails reports nothing as recovered', async () => {
        const first = await save({ n: 1 });
        const second = await save({ n: 2 });

        // Both fail once. From here on each is a save that had failed before.
        serverCannotBeReached();
        await backgroundSyncWorker.triggerNow();
        const firstFailedAtMs = nowMs;

        expect((await rowFor(first)).firstFailedAt).toBe(iso(firstFailedAtMs));
        expect((await rowFor(second)).firstFailedAt).toBe(iso(firstFailedAtMs));
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        // They come due and are sent again, and the whole push fails again:
        // the transport throws, so the server answered for none of them.
        advance(PAST_ANY_BACKOFF_MS);
        pushBatchMock.mockClear();
        await backgroundSyncWorker.triggerNow();

        // They really were sent in this cycle.
        const sent = pushBatchMock.mock.calls.flatMap(
            call => (call[0] as PushRequest).mutations.map(m => m.clientRequestId));
        expect(sent).toEqual(expect.arrayContaining([first, second]));

        // Neither arrived, and neither was sent to the farmer. Each still
        // carries the time of its first failure, not of this one.
        for (const id of [first, second]) {
            const row = await rowFor(id);
            expect(row.status).toBe('FAILED');
            expect(row.firstFailedAt).toBe(iso(firstFailedAtMs));
        }

        // Being sent is not arriving. Nothing was applied, so nothing recovered.
        expect(reports().filter(report => report.recoveredCount !== 0),
            'a save that had failed before and failed again with its whole batch has not recovered')
            .toEqual([]);

        // And with nothing recovered and nothing needing the farmer, the
        // sum of the two counts is zero: the worker says nothing at all.
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        // The failed batch did not use up the fact that they had failed.
        // When they do arrive, that cycle reports both, once, and still
        // names the first failure, not the second.
        advance(PAST_ANY_BACKOFF_MS);
        serverAnswers(() => APPLIED);
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(first)).status).toBe('APPLIED');
        expect((await rowFor(second)).status).toBe('APPLIED');
        expect(theOneReport()).toEqual({
            recoveredCount: 2,
            needsReviewCount: 0,
            pendingAfter: 0,
            appVersion: APP_VERSION,
            firstFailedAtUtc: iso(firstFailedAtMs),
        });
    });

    it('throws the tally away when the cycle fails after a save was already marked applied', async () => {
        const first = await save({ n: 1 });
        const second = await save({ n: 2 });

        // Both fail once. From here on each is a save that had failed before.
        serverCannotBeReached();
        await backgroundSyncWorker.triggerNow();
        const firstFailedAtMs = nowMs;
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        // The server is back and answers "applied" for both. Nothing is wrong
        // with the request or with the answer. The phone writes the first
        // answer down, and then its own storage refuses the second write (a
        // full disk, a database that closed). So this is not the transport
        // rejecting up front: the loop that applies the answers throws, AFTER
        // one save was already marked applied and counted.
        advance(PAST_ANY_BACKOFF_MS);
        pushBatchMock.mockClear();
        serverAnswers(() => APPLIED);

        const writeItDown = mutationQueue.markApplied.bind(mutationQueue);
        const markedAppliedBeforeTheThrow: Array<{ clientRequestId: string; status: string; firstFailedAt?: string }> = [];
        let markAppliedCalls = 0;
        const markApplied = vi.spyOn(mutationQueue, 'markApplied').mockImplementation(async (id: number) => {
            markAppliedCalls += 1;
            if (markAppliedCalls > 1) {
                throw new Error('QuotaExceededError: the phone could not write to its own storage');
            }
            await writeItDown(id);
            const row = (await getDatabase().mutationQueue.get(id))!;
            markedAppliedBeforeTheThrow.push({
                clientRequestId: row.clientRequestId,
                status: row.status,
                firstFailedAt: row.firstFailedAt,
            });
        });

        await expect(backgroundSyncWorker.triggerNow()).resolves.toBeUndefined();
        markApplied.mockRestore();

        // The scene is the one described: the request went out once and was
        // answered; one save, one that had failed before, really was marked
        // applied; and the next write is the one that threw.
        expect(pushBatchMock).toHaveBeenCalledTimes(1);
        expect(markAppliedCalls).toBe(2);
        expect(markedAppliedBeforeTheThrow).toHaveLength(1);
        expect([first, second]).toContain(markedAppliedBeforeTheThrow[0].clientRequestId);
        expect(markedAppliedBeforeTheThrow[0].status).toBe('APPLIED');
        expect(markedAppliedBeforeTheThrow[0].firstFailedAt).toBe(iso(firstFailedAtMs));

        // What the phone holds after the cycle: the whole batch is marked
        // failed, the save that had been marked applied included. Neither is
        // held as arrived, and each still carries its first failure.
        for (const id of [first, second]) {
            const row = await rowFor(id);
            expect(row.status, `save ${id} after a cycle that failed part-way`).toBe('FAILED');
            expect(row.lastError).toContain('QuotaExceededError');
            expect(row.firstFailedAt).toBe(iso(firstFailedAtMs));
        }

        // So the report may not say more than the phone holds. The count kept
        // while the answers were being applied (one recovered) is thrown away
        // with the cycle: no report claims that save recovered.
        expect(reports().filter(report => report.recoveredCount !== 0),
            'a save that was marked applied and then marked failed again with its batch has not recovered')
            .toEqual([]);
        expect(emitSyncPushOutcomeMock, 'with nothing recovered and nothing for the farmer, nothing is said')
            .not.toHaveBeenCalled();

        // The next cycle sends both again. The server has both from the
        // request it answered, and says so. Now the phone holds both as
        // arrived, and that is said once: two, not three. The count thrown
        // away above was not carried into this cycle.
        advance(PAST_ANY_BACKOFF_MS);
        serverAnswers(() => ALREADY_HAS_IT);
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(first)).status).toBe('APPLIED');
        expect((await rowFor(second)).status).toBe('APPLIED');
        expect(theOneReport()).toEqual({
            recoveredCount: 2,
            needsReviewCount: 0,
            pendingAfter: 0,
            appVersion: APP_VERSION,
            firstFailedAtUtc: iso(firstFailedAtMs),
        });
    });

    it('counts a row whose parent can never arrive as needing the farmer', async () => {
        const PARKED_RECORD = '11111111-1111-4111-8111-111111111111';
        const MISSING_RECORD = '22222222-2222-4222-8222-222222222222';

        // A record whose own save was sent to the farmer in an earlier cycle
        // and is still with him. Nothing on this phone will send it again.
        await getDatabase().mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(),
            clientRequestId: parentClientRequestIdForDailyLog(PARKED_RECORD),
            clientCommandId: parentClientRequestIdForDailyLog(PARKED_RECORD),
            mutationType: SyncMutationName.CreateDailyLog,
            payload: { dailyLogId: PARKED_RECORD },
            status: 'REJECTED_USER_REVIEW',
            createdAt: iso(START_MS),
            updatedAt: iso(START_MS),
            retryCount: 1,
            firstFailedAt: iso(START_MS),
        });

        // Two pieces of work, each belonging to a record that can never
        // arrive: one to the record above, one to a record whose save is not
        // on this phone at all.
        const ofTheParkedRecord = await mutationQueue.enqueue(SyncMutationName.AddLogTask, {
            dailyLogId: PARKED_RECORD,
            logTaskId: '55555555-5555-4555-8555-555555555555',
            activityType: 'spray',
        });
        const ofTheMissingRecord = await mutationQueue.enqueue(SyncMutationName.AddLogTask, {
            dailyLogId: MISSING_RECORD,
            logTaskId: '66666666-6666-4666-8666-666666666666',
            activityType: 'irrigation',
        });

        serverAnswers(() => ITS_RECORD_IS_NOT_ON_THE_SERVER);
        await backgroundSyncWorker.triggerNow();

        // Only the two children were sent: the parked record stays parked.
        const sent = pushBatchMock.mock.calls.flatMap(
            call => (call[0] as PushRequest).mutations.map(m => m.clientRequestId));
        expect(sent.sort()).toEqual([ofTheParkedRecord, ofTheMissingRecord].sort());

        // Each child is sent to the farmer BECAUSE OF ITS RECORD: the reason
        // kept on the row names that record, which the server's own words
        // ("Daily log was not found.") do not.
        const childOfParked = await rowFor(ofTheParkedRecord);
        expect(childOfParked.status).toBe('REJECTED_USER_REVIEW');
        expect(childOfParked.lastError).toContain(PARKED_RECORD);

        const childOfMissing = await rowFor(ofTheMissingRecord);
        expect(childOfMissing.status).toBe('REJECTED_USER_REVIEW');
        expect(childOfMissing.lastError).toContain(MISSING_RECORD);

        // Both now need the farmer, and both are counted: a save parked for
        // its record is as much the farmer's to settle as one refused for
        // itself. The record parked in an earlier cycle is not counted again.
        const report = theOneReport();
        expect(report).toEqual({
            recoveredCount: 0,
            needsReviewCount: 2,
            pendingAfter: 0,
            appVersion: APP_VERSION,
        });
        expect(report.firstFailedAtUtc, 'nothing recovered, so there is no first failure to name').toBeUndefined();

        // Counted in the cycle they were parked in, and not in the next.
        emitSyncPushOutcomeMock.mockClear();
        advance(PAST_ANY_BACKOFF_MS);
        await backgroundSyncWorker.triggerNow();
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();
    });

    it('does not count a row that is only waiting for its parent, nor call it recovered when it goes', async () => {
        const RECORD = '33333333-3333-4333-8333-333333333333';

        // The record's own save and a piece of work that belongs to it, made
        // together, sent in one request.
        const record = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { dailyLogId: RECORD }, {
            clientRequestId: parentClientRequestIdForDailyLog(RECORD),
        });
        const itsWork = await mutationQueue.enqueue(SyncMutationName.AddLogTask, {
            dailyLogId: RECORD,
            logTaskId: '77777777-7777-4777-8777-777777777777',
            activityType: 'spray',
        });

        // The record is refused for now, and will be tried again by itself.
        // Its work is therefore refused too: the server does not have the record.
        serverAnswers(id => (id === record ? REFUSED_FOR_NOW : ITS_RECORD_IS_NOT_ON_THE_SERVER));
        await backgroundSyncWorker.triggerNow();
        const recordFailedAtMs = nowMs;

        expect((await rowFor(record)).status).toBe('FAILED');

        // The work waits behind its record. It was not sent to the farmer.
        const waiting = await rowFor(itsWork);
        expect(waiting.status).toBe('FAILED');
        expect(waiting.lastError).toContain(RECORD);
        expect(emitSyncPushOutcomeMock, 'a wait is not an outcome: nothing arrived and nothing needs the farmer')
            .not.toHaveBeenCalled();

        // Both go through on the next try. The record had failed and has now
        // arrived: one recovered. Its work only waited: it is ordinary work.
        advance(PAST_ANY_BACKOFF_MS);
        serverAnswers(() => APPLIED);
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(record)).status).toBe('APPLIED');
        expect((await rowFor(itsWork)).status).toBe('APPLIED');
        expect(theOneReport()).toEqual({
            recoveredCount: 1,
            needsReviewCount: 0,
            pendingAfter: 0,
            appVersion: APP_VERSION,
            firstFailedAtUtc: iso(recordFailedAtMs),
        });
    });

    it('a held save that later goes through is not reported as recovered', async () => {
        const id = await save();

        // The farm's plan holds the save back. That is a wait, not a failure.
        serverAnswers(() => HELD_FOR_THE_PLAN);
        await backgroundSyncWorker.triggerNow();

        const held = await rowFor(id);
        expect(held.status).toBe('FAILED');
        expect(held.errorCode).toBe('entitlement.subscriptionexpired');
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        // The farm is allowed again; the save goes by itself.
        advance(HELD_RECHECK_MS + 1);
        serverAnswers(() => APPLIED);
        await backgroundSyncWorker.triggerNow();

        expect((await rowFor(id)).status).toBe('APPLIED');
        expect(emitSyncPushOutcomeMock, 'a save that only waited is never counted as a failure that recovered')
            .not.toHaveBeenCalled();
    });

    it('a throwing emitter never fails the sync cycle', async () => {
        const arrives = await save({ n: 1 });
        const stillFailing = await save({ n: 2 });

        serverCannotBeReached();
        await backgroundSyncWorker.triggerNow();

        advance(PAST_ANY_BACKOFF_MS);
        const refused = await save({ n: 3 });

        // Telemetry is broken in the worst way it can be: it throws.
        emitSyncPushOutcomeMock.mockImplementation(() => {
            throw new Error('telemetry is down');
        });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        pullChangesMock.mockClear();

        serverAnswers(id => (id === arrives ? APPLIED : id === refused ? REFUSED_FOR_REVIEW : REFUSED_FOR_NOW));
        await expect(backgroundSyncWorker.triggerNow()).resolves.toBeUndefined();

        // The report was really attempted, so the emitter really threw.
        expect(emitSyncPushOutcomeMock).toHaveBeenCalledTimes(1);

        // Every row keeps the state the server's answer gave it.
        expect((await rowFor(arrives)).status).toBe('APPLIED');
        expect((await rowFor(refused)).status).toBe('REJECTED_USER_REVIEW');
        expect((await rowFor(stillFailing)).status).toBe('FAILED');

        // The rest of the cycle ran: the pull happened, and the worker did
        // not record the cycle as failed. (`triggerNow` resolves even when a
        // cycle throws, because the worker catches and logs it; that log line
        // is what a failed cycle looks like from outside.)
        expect(pullChangesMock).toHaveBeenCalledTimes(1);
        const cycleFailures = errors.mock.calls.filter(call => String(call[0]).includes('Sync cycle failed'));
        expect(cycleFailures, 'a throwing emitter must not fail the sync cycle').toHaveLength(0);

        // And the worker carries on: the save that was still failing arrives
        // in the next cycle, with telemetry still broken.
        advance(PAST_ANY_BACKOFF_MS);
        serverAnswers(() => APPLIED);
        await expect(backgroundSyncWorker.triggerNow()).resolves.toBeUndefined();

        expect((await rowFor(stillFailing)).status).toBe('APPLIED');
        expect(emitSyncPushOutcomeMock).toHaveBeenCalledTimes(2);
    });
});
