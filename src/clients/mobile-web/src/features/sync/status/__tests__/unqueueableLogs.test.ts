/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1, final fix round, finding C-1.
 *
 * The registry that carries "this record reached no queue at all" from the save
 * path to the header chip. Three things matter about it and each is asserted
 * here:
 *
 *   1. it DEDUPES, because a count of dropped records that can double is a
 *      fabricated number (`P4`);
 *   2. it NOTIFIES, because the chip's `liveQuery` observes Dexie tables and a
 *      skipped log writes to none of them;
 *   3. it stays QUIET when nothing was skipped, so the happy path is untouched.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import {
    getUnqueueableLogCount,
    noteUnqueueableLogs,
    resetUnqueueableLogs,
    subscribeToUnqueueableLogs,
} from '../unqueueableLogs';

describe('unqueueableLogs — the only record of a log that reached no queue', () => {
    // Module state, so every subscription must be torn down or a listener from
    // one test fires inside the next one's reset.
    const openSubscriptions: Array<() => void> = [];

    const subscribe = (listener: (count: number) => void) => {
        const unsubscribe = subscribeToUnqueueableLogs(listener);
        openSubscriptions.push(unsubscribe);
        return unsubscribe;
    };

    beforeEach(() => {
        resetUnqueueableLogs();
    });

    afterEach(() => {
        openSubscriptions.splice(0).forEach(unsubscribe => unsubscribe());
        vi.restoreAllMocks();
    });

    it('starts empty, so a fresh session claims nothing on this evidence', () => {
        expect(getUnqueueableLogCount()).toBe(0);
    });

    it('counts what the save path could not queue', () => {
        noteUnqueueableLogs(['log-1', 'log-2']);

        expect(getUnqueueableLogCount()).toBe(2);
    });

    it('counts one record once, however many times the save path reports it', () => {
        // A re-submitted draft drops the SAME record again. Two of one is a
        // number the app cannot evidence.
        noteUnqueueableLogs(['log-1']);
        noteUnqueueableLogs(['log-1']);
        noteUnqueueableLogs(['log-1', 'log-2']);

        expect(getUnqueueableLogCount()).toBe(2);
    });

    it('accumulates across saves within the session', () => {
        noteUnqueueableLogs(['log-1']);
        noteUnqueueableLogs(['log-2']);

        expect(getUnqueueableLogCount()).toBe(2);
    });

    it('an empty report is a no-op — the happy path notifies nobody', () => {
        const listener = vi.fn();
        subscribe(listener);

        noteUnqueueableLogs([]);

        expect(listener).not.toHaveBeenCalled();
        expect(getUnqueueableLogCount()).toBe(0);
    });

    it('tells its subscribers the new count the moment a record is dropped', () => {
        // Without this the chip would keep its stale claim until some unrelated
        // Dexie write woke its liveQuery up — which, on a device whose queue is
        // empty and fully applied, may be never.
        const listener = vi.fn();
        subscribe(listener);

        noteUnqueueableLogs(['log-1']);

        expect(listener).toHaveBeenCalledWith(1);
    });

    it('does not re-notify when a report adds nothing new', () => {
        const listener = vi.fn();
        subscribe(listener);

        noteUnqueueableLogs(['log-1']);
        noteUnqueueableLogs(['log-1']);

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops notifying after unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = subscribe(listener);

        unsubscribe();
        noteUnqueueableLogs(['log-1']);

        expect(listener).not.toHaveBeenCalled();
    });

    it('one listener throwing does not silence the others', () => {
        const angry = vi.fn(() => { throw new Error('boom'); });
        const calm = vi.fn();
        vi.spyOn(console, 'error').mockImplementation(() => { });
        subscribe(angry);
        subscribe(calm);

        noteUnqueueableLogs(['log-1']);

        expect(calm).toHaveBeenCalledWith(1);
    });

    it('reset clears the count and says so', () => {
        const listener = vi.fn();
        noteUnqueueableLogs(['log-1']);
        subscribe(listener);

        resetUnqueueableLogs();

        expect(getUnqueueableLogCount()).toBe(0);
        expect(listener).toHaveBeenCalledWith(0);
    });

    it('reset on an empty registry notifies nobody', () => {
        const listener = vi.fn();
        subscribe(listener);

        resetUnqueueableLogs();

        expect(listener).not.toHaveBeenCalled();
    });
});
