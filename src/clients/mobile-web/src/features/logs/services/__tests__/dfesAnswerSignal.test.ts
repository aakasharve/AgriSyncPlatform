/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesAnswerSignal — unit tests (Task 4, spec: dfes-farmer-facing-deploy-readiness-2026-08-14).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subscribeDfesAnswered, notifyDfesAnswered } from '../dfesAnswerSignal';

describe('dfesAnswerSignal', () => {
    beforeEach(() => {
        // Each test subscribes+unsubscribes its own listeners; nothing global to reset.
    });

    it('calls a subscribed listener when notified', () => {
        const listener = vi.fn();
        subscribeDfesAnswered(listener);

        notifyDfesAnswered();

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('calls every subscribed listener, not just the first', () => {
        const first = vi.fn();
        const second = vi.fn();
        subscribeDfesAnswered(first);
        subscribeDfesAnswered(second);

        notifyDfesAnswered();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('stops calling a listener after it unsubscribes', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeDfesAnswered(listener);
        unsubscribe();

        notifyDfesAnswered();

        expect(listener).not.toHaveBeenCalled();
    });

    it('notifying with no subscribers is a safe no-op', () => {
        expect(() => notifyDfesAnswered()).not.toThrow();
    });
});
