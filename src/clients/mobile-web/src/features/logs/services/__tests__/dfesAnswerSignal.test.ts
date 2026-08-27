/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesAnswerSignal — unit tests (Task 4, spec: dfes-farmer-facing-deploy-readiness-2026-08-14).
 *
 * `listeners` is a MODULE-LEVEL singleton (by design — see dfesAnswerSignal.ts),
 * so it persists across tests within this file unless each test unsubscribes
 * its own listener(s). Every test below captures its unsubscribe(s) and an
 * afterEach calls them, so "no subscribers" in the last test is actually true,
 * not just untested.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { subscribeDfesAnswered, notifyDfesAnswered } from '../dfesAnswerSignal';

describe('dfesAnswerSignal', () => {
    let unsubscribers: Array<() => void> = [];

    afterEach(() => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
        unsubscribers = [];
    });

    it('calls a subscribed listener when notified', () => {
        const listener = vi.fn();
        unsubscribers.push(subscribeDfesAnswered(listener));

        notifyDfesAnswered();

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('calls every subscribed listener, not just the first', () => {
        const first = vi.fn();
        const second = vi.fn();
        unsubscribers.push(subscribeDfesAnswered(first), subscribeDfesAnswered(second));

        notifyDfesAnswered();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('stops calling a listener after it unsubscribes', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeDfesAnswered(listener);
        unsubscribe(); // exercised directly — nothing left to clean up in afterEach

        notifyDfesAnswered();

        expect(listener).not.toHaveBeenCalled();
    });

    it('notifying with no subscribers is a safe no-op', () => {
        // Relies on the afterEach above having unsubscribed every prior test's
        // listener, so this is genuinely zero subscribers, not just untested.
        expect(() => notifyDfesAnswered()).not.toThrow();
    });

    // -------------------------------------------------------------------------
    // Review round 1, Finding 1(b) — one throwing listener must never starve
    // the others. useDfesQuestion.ts's onAnswered (the sole subscriber today)
    // wires in notifyDfesAnswered as its own recordOutcome guard depends on
    // this call never throwing back into it; a bare `forEach(l => l())` would
    // let an earlier throwing listener abort the loop before later listeners
    // ever ran.
    // -------------------------------------------------------------------------
    it('isolates a throwing listener so later subscribers are still notified', () => {
        const throwing = vi.fn(() => { throw new Error('boom'); });
        const after = vi.fn();
        unsubscribers.push(subscribeDfesAnswered(throwing), subscribeDfesAnswered(after));

        expect(() => notifyDfesAnswered()).not.toThrow();

        expect(throwing).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
    });
});
