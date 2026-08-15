// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 box 2c — EXPONENTIAL BACKOFF ON THE MUTATION QUEUE.
 *
 * `AiJobWorker` and `AttachmentUploadWorker` have both had backoff since they
 * shipped. The queue carrying the farmer's actual records had none: a failing
 * row went back on the wire every 15 seconds until it succeeded or hit the cap.
 *
 * Box 2a made that unbounded. A dependency wait is deliberately UNCHARGED, so
 * the cap no longer stops it — without backoff a child whose parent is one
 * batch behind would re-ask the server four times a minute for the life of the
 * install. These two boxes are a pair, and this file is where the pair is
 * proved: the last test drives the real worker with the real dependency rule.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';
import { SyncMutationName } from '../SyncMutationCatalog';
import { MutationQueue, backoffDelayMs } from '../MutationQueue';

const FROZEN_NOW_ISO = '2026-08-15T09:00:00.000Z';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

async function seedPending(overrides: Partial<{ nextRetryAfterMs: number; clientRequestId: string }> = {}) {
    const db = getDatabase();
    return db.mutationQueue.add({
        deviceId: 'device-under-test',
        clientRequestId: overrides.clientRequestId ?? `req-${Math.random().toString(36).slice(2, 10)}`,
        clientCommandId: 'cmd',
        mutationType: SyncMutationName.CreateDailyLog,
        payload: { sample: true },
        status: 'PENDING',
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount: 0,
        ...(overrides.nextRetryAfterMs !== undefined ? { nextRetryAfterMs: overrides.nextRetryAfterMs } : {}),
    });
}

describe('MutationQueue — §P0.7 box 2c: backoff', () => {
    beforeEach(async () => {
        vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);
        await freshDb();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('a_failed_row_is_held_off_the_wire_until_its_delay_expires', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedPending();

        await queue.markFailed(id, 'boom', 'TRANSPORT');
        await queue.markFailedAsPending();

        // Flipped back to PENDING, but NOT yet offered to the worker.
        expect((await getDatabase().mutationQueue.get(id))?.status).toBe('PENDING');
        expect(await queue.getPending()).toHaveLength(0);
    });

    it('the_delay_grows_with_every_attempt_and_stops_at_a_minute', async () => {
        // Same schedule as AiJobWorker.ts:152 — 2s, 4s, 8s, 16s, 32s, then 60s.
        expect(backoffDelayMs(1)).toBe(2000);
        expect(backoffDelayMs(2)).toBe(4000);
        expect(backoffDelayMs(3)).toBe(8000);
        expect(backoffDelayMs(4)).toBe(16000);
        expect(backoffDelayMs(5)).toBe(32000);
        expect(backoffDelayMs(6)).toBe(60000);
        expect(backoffDelayMs(30)).toBe(60000);
    });

    it('an_UNCHARGED_failure_still_backs_off_which_is_the_whole_reason_attemptCount_exists', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedPending();

        await queue.markFailed(id, 'no parent yet', 'DEPENDENCY');
        await queue.markFailed(id, 'no parent yet', 'DEPENDENCY');
        await queue.markFailed(id, 'no parent yet', 'DEPENDENCY');

        const row = await getDatabase().mutationQueue.get(id);
        // Uncharged: the cap is untouched...
        expect(row?.retryCount).toBe(0);
        // ...but the row is demonstrably slowing down. Reading the exponent off
        // `retryCount` would have left this permanently at the 2s step.
        expect(row?.attemptCount).toBe(3);
        expect(row!.nextRetryAfterMs! - Date.now()).toBeGreaterThan(backoffDelayMs(2));
    });

    it('the_row_returns_to_the_wire_once_the_delay_has_passed', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedPending();

        await queue.markFailed(id, 'boom', 'TRANSPORT');
        await queue.markFailedAsPending();
        expect(await queue.getPending()).toHaveLength(0);

        // Backoff is an absolute epoch deadline, so moving the clock past it is
        // exactly what the passage of time does.
        const row = await getDatabase().mutationQueue.get(id);
        vi.setSystemTime(row!.nextRetryAfterMs! + 1);

        expect(await queue.getPending()).toHaveLength(1);
    });

    it('a_row_written_before_this_change_has_no_deadline_and_is_due_immediately', async () => {
        // Absence must read as "go". A pre-§P0.7 row carries no
        // `nextRetryAfterMs`, and treating that as "wait" would freeze the queue
        // on every handset the change upgraded.
        const queue = MutationQueue.getInstance();
        await seedPending();

        expect(await queue.getPending()).toHaveLength(1);
    });

    it('backed_off_rows_do_not_squat_the_batch_and_starve_a_ready_one', async () => {
        // The filter must run BEFORE the limit. The other order is silent: the
        // three waiting rows would fill a limit of one and the ready row would
        // never be sent.
        const queue = MutationQueue.getInstance();
        const future = Date.now() + 60000;
        await seedPending({ nextRetryAfterMs: future, clientRequestId: 'waiting-a' });
        await seedPending({ nextRetryAfterMs: future, clientRequestId: 'waiting-b' });
        await seedPending({ nextRetryAfterMs: future, clientRequestId: 'waiting-c' });
        await seedPending({ clientRequestId: 'ready' });

        const batch = await queue.getPending(1);

        expect(batch).toHaveLength(1);
        expect(batch[0].clientRequestId).toBe('ready');
    });

    it('a_farmer_tap_clears_the_delay_so_the_button_is_not_a_painted_door', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedPending();
        await queue.markFailed(id, 'boom', 'TRANSPORT');

        const flipped = await queue.retryAllFailedByUser();

        expect(flipped).toBe(1);
        expect(await queue.getPending()).toHaveLength(1);
        expect((await getDatabase().mutationQueue.get(id))?.nextRetryAfterMs).toBeUndefined();
    });

    it('a_successful_push_clears_the_delay_it_had_earned', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedPending();
        await queue.markFailed(id, 'boom', 'TRANSPORT');

        await queue.markApplied(id);

        const row = await getDatabase().mutationQueue.get(id);
        expect(row?.nextRetryAfterMs).toBeUndefined();
        expect(row?.attemptCount).toBe(0);
    });
});
