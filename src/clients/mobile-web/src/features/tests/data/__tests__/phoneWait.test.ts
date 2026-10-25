// spec: plr-d10-redesign-real-integration-2026-10-25 (review N1) — a hung phone write never freezes a screen.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { settleWithin } from '../phoneWait';

describe('settleWithin', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('gives the write\'s own value when it finishes in time', async () => {
        await expect(settleWithin(Promise.resolve(true), false)).resolves.toBe(true);
    });

    it('gives the fallback when the write fails', async () => {
        await expect(settleWithin(Promise.reject(new Error('DataError')), false)).resolves.toBe(false);
    });

    it('gives the fallback when the write never answers', async () => {
        vi.useFakeTimers();
        const outcome = settleWithin(new Promise<boolean>(() => { /* IndexedDB hung */ }), false, 2000);
        await vi.advanceTimersByTimeAsync(2000);
        await expect(outcome).resolves.toBe(false);
    });
});
