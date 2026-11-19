// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a Task C3,
 * ADR 0027 D2).
 *
 * A queue row gains one field, `firstFailedAt`: the time of the first REAL
 * failed attempt to send it. The sync worker reads it to say, when the row
 * finally arrives, "this save had failed and has now arrived". Neither of the
 * two counters the row already has can say that: `retryCount` counts only
 * refusals the server answered, and `attemptCount` is set back to 0 whenever
 * a backoff is cleared.
 *
 * What is held here, on the real MutationQueue over real (fake-indexeddb)
 * Dexie:
 *   - it is stamped by the first real failure and by a refusal sent for the
 *     farmer to review, each only when it is not there yet
 *   - a wait is not a failure: a row held for the farm's plan, or waiting on
 *     another save, is never stamped
 *   - it survives every transition that keeps the same piece of work:
 *     clearing a backoff, the automatic retry flip, the farmer's retry tap,
 *     a send in progress, and the farmer correcting a refused save
 *   - it is removed when a repeatable row is re-armed with NEW work, because
 *     the new work has not failed
 *
 * The clock is moved with `vi.setSystemTime`, which moves `Date.now()` and
 * `new Date()` together, so the test does not depend on which of the two the
 * queue reads.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../../src/infrastructure/storage/DexieDatabase';

// The queue checks a payload against the sync contract when a row is queued,
// corrected or re-armed. This file is about one field of the row, not about
// payload shapes, so any payload is accepted (the same choice the worker
// tests under src/infrastructure/sync/__tests__ make).
vi.mock('../../../src/infrastructure/sync/PayloadValidator', () => ({
    validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }),
}));

import { mutationQueue, MAX_AUTO_RETRY_COUNT } from '../../../src/infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../src/infrastructure/sync/SyncMutationCatalog';

/** The first failure. */
const T1 = Date.parse('2026-11-14T06:30:00.000Z');
/** Five minutes later. */
const T2 = T1 + 5 * 60 * 1000;
/** Ten minutes later. */
const T3 = T1 + 10 * 60 * 1000;

const iso = (ms: number): string => new Date(ms).toISOString();

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
    expect(row!.id, `queue row ${clientRequestId} has an id`).toBeDefined();
    return row!;
}

/** Queues one save and returns its row id and its client request id. */
async function queued(payload: unknown = { sample: true }) {
    const clientRequestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, payload);
    const row = await rowFor(clientRequestId);
    return { id: row.id as number, clientRequestId };
}

describe('MutationQueue — firstFailedAt (plan CR-1a Task C3)', () => {
    beforeEach(async () => {
        vi.setSystemTime(T1);
        await freshDb();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stamps firstFailedAt on the first real failure and keeps it on the second', async () => {
        const { id, clientRequestId } = await queued();
        expect((await rowFor(clientRequestId)).firstFailedAt, 'a save that has not been tried has not failed')
            .toBeUndefined();

        // The request never reached a server that could answer.
        await mutationQueue.markFailed(id, 'Network Error', 'TRANSPORT');
        expect((await rowFor(clientRequestId)).firstFailedAt).toBe(iso(T1));

        // It fails again later, this time refused by the server. The row
        // still says when it FIRST failed.
        vi.setSystemTime(T2);
        await mutationQueue.markFailed(id, 'connection reset by peer', 'REJECTION');

        const row = await rowFor(clientRequestId);
        expect(row.firstFailedAt).toBe(iso(T1));
        expect(row.status).toBe('FAILED');

        // A refusal the server answered is a real attempt too, also when it
        // is the first thing that happens to a row, and also when the caller
        // names no kind (the default kind is REJECTION).
        vi.setSystemTime(T3);
        const refused = await queued({ n: 2 });
        await mutationQueue.markFailed(refused.id, 'connection reset by peer', 'REJECTION');
        expect((await rowFor(refused.clientRequestId)).firstFailedAt).toBe(iso(T3));

        const unnamed = await queued({ n: 3 });
        await mutationQueue.markFailed(unnamed.id, 'No push result returned for mutation.');
        expect((await rowFor(unnamed.clientRequestId)).firstFailedAt).toBe(iso(T3));
    });

    it('a held or dependency wait is not a failure', async () => {
        // HELD: the farm's trial or plan refused the save. Nothing about the
        // save was judged; it goes by itself once the farm is allowed again.
        const held = await queued({ n: 1 });
        await mutationQueue.markFailed(
            held.id, 'Farm subscription has expired.', 'HELD', 'entitlement.subscriptionexpired');

        // DEPENDENCY: the save is waiting for another save of this phone.
        const waiting = await queued({ n: 2 });
        await mutationQueue.markFailed(waiting.id, 'Waiting for its daily log to be saved first.', 'DEPENDENCY');

        const heldRow = await rowFor(held.clientRequestId);
        const waitingRow = await rowFor(waiting.clientRequestId);

        // markFailed really ran for both: the rows are not sent, and say so.
        expect(heldRow.status).toBe('FAILED');
        expect(waitingRow.status).toBe('FAILED');

        expect(heldRow.firstFailedAt, 'a held save is waiting, it has not failed').toBeUndefined();
        expect(waitingRow.firstFailedAt, 'a save waiting on another save has not failed').toBeUndefined();

        // However long it waits.
        vi.setSystemTime(T2);
        await mutationQueue.markFailed(
            held.id, 'Farm subscription has expired.', 'HELD', 'entitlement.subscriptionexpired');
        await mutationQueue.markFailed(waiting.id, 'Waiting for its daily log to be saved first.', 'DEPENDENCY');
        expect((await rowFor(held.clientRequestId)).firstFailedAt).toBeUndefined();
        expect((await rowFor(waiting.clientRequestId)).firstFailedAt).toBeUndefined();

        // A save that waited and THEN really failed is stamped at the real
        // failure, not at the start of the wait.
        vi.setSystemTime(T3);
        await mutationQueue.markFailed(waiting.id, 'Network Error', 'TRANSPORT');
        expect((await rowFor(waiting.clientRequestId)).firstFailedAt).toBe(iso(T3));

        // And a wait that comes after a real failure does not remove the stamp.
        const failedThenHeld = await queued({ n: 3 });
        await mutationQueue.markFailed(failedThenHeld.id, 'Network Error', 'TRANSPORT');
        vi.setSystemTime(T3 + 60 * 1000);
        await mutationQueue.markFailed(
            failedThenHeld.id, 'Farm subscription has expired.', 'HELD', 'entitlement.subscriptionexpired');
        expect((await rowFor(failedThenHeld.clientRequestId)).firstFailedAt).toBe(iso(T3));
    });

    it('a refusal sent for the farmer to review stamps firstFailedAt', async () => {
        // Refused outright on the first attempt: without a stamp here, a
        // refused save that the farmer corrects would never be reported as
        // arrived.
        const { id, clientRequestId } = await queued();
        await mutationQueue.markRejectedUserReview(id, 'The command is not valid.', 'ShramSafal.InvalidCommand');

        const row = await rowFor(clientRequestId);
        expect(row.status).toBe('REJECTED_USER_REVIEW');
        expect(row.firstFailedAt).toBe(iso(T1));

        // Only when it is not there yet: a save that failed earlier and is
        // refused later keeps the time of its first failure.
        const earlier = await queued({ n: 2 });
        await mutationQueue.markFailed(earlier.id, 'Network Error', 'TRANSPORT');
        vi.setSystemTime(T2);
        await mutationQueue.markRejectedUserReview(
            earlier.id, 'The command is not valid.', 'ShramSafal.InvalidCommand');

        const earlierRow = await rowFor(earlier.clientRequestId);
        expect(earlierRow.status).toBe('REJECTED_USER_REVIEW');
        expect(earlierRow.firstFailedAt).toBe(iso(T1));
    });

    it('clearBackoff resets attemptCount and keeps firstFailedAt', async () => {
        const { id, clientRequestId } = await queued();
        await mutationQueue.markFailed(id, 'Network Error', 'TRANSPORT');
        vi.setSystemTime(T2);
        await mutationQueue.markFailed(id, 'Network Error', 'TRANSPORT');

        const before = await rowFor(clientRequestId);
        expect(before.attemptCount).toBe(2);
        expect(before.nextRetryAfterMs).toBeDefined();

        await mutationQueue.clearBackoff(id);

        // This is why the report cannot be built on attemptCount: the counter
        // reads 0 for a save that plainly failed twice. firstFailedAt is what
        // still says so.
        const after = await rowFor(clientRequestId);
        expect(after.attemptCount).toBe(0);
        expect(after.nextRetryAfterMs).toBeUndefined();
        expect(after.firstFailedAt).toBe(iso(T1));
    });

    it('markFailedAsPending keeps firstFailedAt', async () => {
        const { id, clientRequestId } = await queued();
        await mutationQueue.markFailed(id, 'Network Error', 'TRANSPORT');

        vi.setSystemTime(T2);
        await mutationQueue.markFailedAsPending();

        const row = await rowFor(clientRequestId);
        expect(row.status).toBe('PENDING');
        expect(row.firstFailedAt).toBe(iso(T1));
    });

    it('a retry tap and a send in progress keep firstFailedAt', async () => {
        const { id, clientRequestId } = await queued();
        await mutationQueue.markFailed(id, 'Network Error', 'TRANSPORT');

        // "Retry All": back to PENDING with the backoff cleared.
        vi.setSystemTime(T2);
        expect(await mutationQueue.retryAllFailedByUser()).toBe(1);

        const retried = await rowFor(clientRequestId);
        expect(retried.status).toBe('PENDING');
        expect(retried.attemptCount).toBe(0);
        expect(retried.firstFailedAt).toBe(iso(T1));

        // On the wire.
        await mutationQueue.markSending(id);

        const sending = await rowFor(clientRequestId);
        expect(sending.status).toBe('SENDING');
        expect(sending.firstFailedAt).toBe(iso(T1));

        // The app was closed mid-send; the next cycle puts the row back.
        await mutationQueue.resetInFlightMutations();

        const reset = await rowFor(clientRequestId);
        expect(reset.status).toBe('PENDING');
        expect(reset.firstFailedAt).toBe(iso(T1));
    });

    it('replacePayload keeps firstFailedAt', async () => {
        const { id, clientRequestId } = await queued({ note: 'as first saved' });
        await mutationQueue.markRejectedUserReview(id, 'The command is not valid.', 'ShramSafal.InvalidCommand');

        // The farmer corrects the refused save. It is the same piece of work:
        // when it arrives, it is a save that had failed and has now arrived.
        vi.setSystemTime(T2);
        const replaced = await mutationQueue.replacePayload(clientRequestId, { note: 'as corrected' });
        expect(replaced).toBe(true);

        const row = await rowFor(clientRequestId);
        expect(row.status).toBe('PENDING');
        expect(row.payload).toEqual({ note: 'as corrected' });
        expect(row.firstFailedAt).toBe(iso(T1));
    });

    it('re-arming a repeatable row clears firstFailedAt', async () => {
        // A change the farmer can make again after a refusal (a move of a
        // saved entry). Its request id is derived from the change, so the
        // second attempt lands on the SAME row.
        const moveId = 'move-of-one-entry';
        await mutationQueue.enqueueRepeatable(
            SyncMutationName.MoveDailyLog, { to: 'first choice' }, { clientRequestId: moveId });
        const first = await rowFor(moveId);
        await mutationQueue.markRejectedUserReview(
            first.id as number, 'The command is not valid.', 'ShramSafal.InvalidCommand');
        expect((await rowFor(moveId)).firstFailedAt).toBe(iso(T1));

        // The farmer makes the change again, differently. This is new work
        // on the old row, and new work has not failed.
        vi.setSystemTime(T2);
        await mutationQueue.enqueueRepeatable(
            SyncMutationName.MoveDailyLog, { to: 'second choice' }, { clientRequestId: moveId });

        const rearmed = await rowFor(moveId);
        expect(rearmed.id).toBe(first.id);
        expect(rearmed.status).toBe('PENDING');
        expect(rearmed.payload).toEqual({ to: 'second choice' });
        expect(rearmed.firstFailedAt, 'new work on a re-armed row has not failed').toBeUndefined();

        // The same for a row given up after the retry cap.
        const cappedId = 'move-given-up';
        await mutationQueue.enqueueRepeatable(
            SyncMutationName.MoveDailyLog, { to: 'first choice' }, { clientRequestId: cappedId });
        const capped = await rowFor(cappedId);
        for (let attempt = 0; attempt < MAX_AUTO_RETRY_COUNT; attempt++) {
            await mutationQueue.markFailed(capped.id as number, 'connection reset by peer', 'REJECTION');
        }
        expect((await rowFor(cappedId)).firstFailedAt).toBe(iso(T2));

        vi.setSystemTime(T3);
        await mutationQueue.enqueueRepeatable(
            SyncMutationName.MoveDailyLog, { to: 'second choice' }, { clientRequestId: cappedId });
        expect((await rowFor(cappedId)).status).toBe('PENDING');
        expect((await rowFor(cappedId)).firstFailedAt).toBeUndefined();

        // The control: a row that is still on its way is NOT re-armed. The
        // same call leaves it exactly as it is, stamp included, so the two
        // cases above cleared the stamp because the work was replaced and
        // for no other reason.
        const waitingId = 'move-still-on-its-way';
        await mutationQueue.enqueueRepeatable(
            SyncMutationName.MoveDailyLog, { to: 'first choice' }, { clientRequestId: waitingId });
        const waiting = await rowFor(waitingId);
        await mutationQueue.markFailed(waiting.id as number, 'Network Error', 'TRANSPORT');
        await mutationQueue.enqueueRepeatable(
            SyncMutationName.MoveDailyLog, { to: 'second choice' }, { clientRequestId: waitingId });

        const untouched = await rowFor(waitingId);
        expect(untouched.status).toBe('FAILED');
        expect(untouched.payload).toEqual({ to: 'first choice' });
        expect(untouched.firstFailedAt).toBe(iso(T3));
    });
});
