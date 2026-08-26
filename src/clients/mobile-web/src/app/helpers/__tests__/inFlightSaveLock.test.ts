/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LABOUR_PHASE2 PHASE 4 (§A7.2) — the in-flight Save lock, on its own.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 *
 * Two properties, and they pull against each other. The lock must stop a second
 * tap while a save is running (or one day's work lands in the ledger twice), and
 * it must NOT be capable of holding forever (`P9` — a farmer who cannot record
 * has lost the product, and `agriSyncClient` sets no HTTP timeout, so a stalled
 * request never settles and never rejects).
 *
 * The clock is injected rather than faked globally, so the expiry is proven at
 * the boundary — 1 ms under and 1 ms over — instead of by waiting 30 seconds or
 * by trusting a rounding.
 */
import { describe, it, expect } from 'vitest';
import { createInFlightSaveLock, SAVE_IN_FLIGHT_CEILING_MS } from '../inFlightSaveLock';

/** A clock the test moves by hand. */
const clock = (start = 1_000_000) => {
    let now = start;
    return { now: () => now, advance: (ms: number) => { now += ms; } };
};

describe('createInFlightSaveLock', () => {
    it('lets the first save through', () => {
        expect(createInFlightSaveLock().tryAcquire()).toBe(true);
    });

    it('refuses the second tap of a double-tap', () => {
        // THE defect: `ManualEntry` does not await `onSubmit`, so both taps run
        // the save concurrently and the create branch mints two log ids.
        const lock = createInFlightSaveLock();

        expect(lock.tryAcquire()).toBe(true);
        expect(lock.tryAcquire()).toBe(false);
        expect(lock.tryAcquire()).toBe(false);
    });

    it('lets the next save through once the first releases', () => {
        const lock = createInFlightSaveLock();

        lock.tryAcquire();
        lock.release();

        expect(lock.tryAcquire()).toBe(true);
    });

    it('releases on a FAILED save exactly as on a successful one', () => {
        // The caller releases in `finally`. "Please try again" has to be an
        // instruction the farmer can follow.
        const lock = createInFlightSaveLock();

        lock.tryAcquire();
        lock.release(); // as the caller's `finally` does, error or not

        expect(lock.tryAcquire()).toBe(true);
    });

    it('release() on a lock nobody holds is harmless', () => {
        const lock = createInFlightSaveLock();

        lock.release();

        expect(lock.tryAcquire()).toBe(true);
    });

    it('still refuses one millisecond BEFORE the ceiling', () => {
        const time = clock();
        const lock = createInFlightSaveLock(SAVE_IN_FLIGHT_CEILING_MS, time.now);

        lock.tryAcquire();
        time.advance(SAVE_IN_FLIGHT_CEILING_MS - 1);

        expect(lock.tryAcquire()).toBe(false);
    });

    it('a save that never returns cannot hold the lock past the ceiling', () => {
        // The `P9` half. A request stalled on a captive portal never settles, so
        // `release()` is never reached — and without this the farmer would be
        // permanently unable to record.
        const time = clock();
        const lock = createInFlightSaveLock(SAVE_IN_FLIGHT_CEILING_MS, time.now);

        lock.tryAcquire();
        time.advance(SAVE_IN_FLIGHT_CEILING_MS);

        expect(lock.tryAcquire()).toBe(true);
    });

    it('a stuck save does not poison the lock for every save after it', () => {
        const time = clock();
        const lock = createInFlightSaveLock(SAVE_IN_FLIGHT_CEILING_MS, time.now);

        lock.tryAcquire();                              // stalls forever
        time.advance(SAVE_IN_FLIGHT_CEILING_MS);
        expect(lock.tryAcquire()).toBe(true);           // farmer records again
        lock.release();                                 // and that one completes
        expect(lock.tryAcquire()).toBe(true);           // and so does the next
    });

    it('the ceiling is a real duration, not zero', () => {
        // A zero or negative ceiling would make `tryAcquire` always succeed —
        // the lock silently absent while looking present.
        expect(SAVE_IN_FLIGHT_CEILING_MS).toBeGreaterThan(0);
    });
});
