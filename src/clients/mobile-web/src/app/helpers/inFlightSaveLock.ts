/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LABOUR_PHASE2 PHASE 4 (§A7.2) — the in-flight Save lock.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 *
 * THE DEFECT IT REMOVES. `ManualEntry` calls `onSubmit(userDraft)` WITHOUT
 * awaiting it (`ManualEntry.tsx:326`) and its Save control has no disabled
 * state, so two taps run the save callback concurrently. On the create branch
 * that means two `LogFactory` runs, two freshly minted log ids and two
 * `clientRequestId`s — which the server's `(deviceId, clientRequestId)` dedupe
 * cannot catch, because they are not retries of one action, they are two
 * genuinely different records. One day's work, entered twice, in the ledger the
 * farmer is being asked to trust.
 *
 * IT DOES NOT FIX THE UNDERLYING FRESH-ID DEFECT, and is not trying to: the plan
 * defers that explicitly. It removes the reachable path.
 *
 * NOTHING HERE IS VISIBLE. No state, no re-render, so no spinner, no disabled
 * button, no "please wait" — `P9` forbids a farmer being told they may not
 * record right now. A rejected second tap simply does nothing; the first tap's
 * own toast is the feedback it was always going to be.
 *
 * ── WHY THE LOCK EXPIRES ────────────────────────────────────────────────────
 *
 * A lock released only in a `finally` can be held forever. `agriSyncClient` is
 * created with NO `timeout` (`AgriSyncClient.ts:176`), so a request stalled by a
 * captive portal — the rural default, not an edge case — never settles and never
 * rejects. The save path awaits two such unbounded calls: the weather enrichment
 * inside `createFromManual`, and each `postLabourCorrection` on the edit branch.
 * Without an expiry, one stalled socket would leave the farmer permanently
 * unable to record.
 *
 * So when "saved twice" and "never able to save again" cannot both be avoided,
 * this releases. `P9` — low-friction capture is sacred — decides that ordering;
 * a duplicate is recoverable and a farmer who has given up on the app is not.
 *
 * THE COST IS STATED, NOT HIDDEN: past the ceiling a second tap on the create
 * branch can still produce a duplicate record. The ceiling bounds the lock; it
 * does not bound the fresh-id defect.
 *
 * @module app/helpers/inFlightSaveLock
 */

/**
 * How long one save may hold the lock before a fresh tap is let through
 * regardless.
 *
 * Deliberately generous. Every path this guards completes in milliseconds when
 * it completes at all — Dexie writes plus one or two HTTP round trips — so 30s
 * is far past any save that is still making progress, and comfortably inside the
 * patience of someone who has already decided the app is stuck.
 */
export const SAVE_IN_FLIGHT_CEILING_MS = 30_000;

export interface InFlightSaveLock {
    /**
     * `true` when the caller now HOLDS the lock and must proceed (and must
     * release). `false` when a save started less than `ceilingMs` ago is still
     * running, in which case the caller must do nothing at all.
     */
    tryAcquire(): boolean;
    /** Give the lock back. Safe to call when not held. */
    release(): void;
}

/**
 * One lock. Pure — no React, no module-level state, no timers.
 *
 * No timer, deliberately: a `setTimeout` that outlives its save would have to be
 * cancelled on every exit path, and a missed cancellation is a lock that
 * releases UNDER a running save — silently restoring the double-tap it exists to
 * prevent. Comparing timestamps at the moment of the tap has no such failure
 * mode, and it needs no cleanup on unmount.
 *
 * `tryAcquire` reads and writes in ONE synchronous run, so no `await` can
 * interleave between the check and the take. JS single-threading is what makes
 * that sufficient; there is no atomicity problem to solve here.
 *
 * `now` is injectable so the expiry can be tested without sleeping 30 seconds.
 * It defaults to the real clock and production never passes it.
 */
export function createInFlightSaveLock(
    ceilingMs: number = SAVE_IN_FLIGHT_CEILING_MS,
    now: () => number = () => Date.now(),
): InFlightSaveLock {
    let startedAt: number | null = null;

    return {
        tryAcquire(): boolean {
            if (startedAt !== null && now() - startedAt < ceilingMs) {
                return false;
            }
            startedAt = now();
            return true;
        },
        release(): void {
            startedAt = null;
        },
    };
}
