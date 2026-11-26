// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4 + amendments B1, Verifier 3, L3) — the 7 s ring fires ONCE per plot tap,
 * only with the microphone already granted, never while held, hidden or blocked.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const perm = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../../consent/separation/devicePermissions', () => ({ readDevicePermission: perm.read }));

import {
    noteLevelUnmeasurable, noteMicGranted, resetAutoStartForTests, useAutoStartCountdown, type AutoStartOptions,
} from '../useAutoStartCountdown';

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

function setup(initial: Partial<AutoStartOptions> = {}) {
    const onFire = vi.fn();
    const hook = renderHook((p: Partial<AutoStartOptions>) => useAutoStartCountdown({ armSeq: 1, blocked: false, onFire, ...p }), { initialProps: initial });
    return { onFire, ...hook };
}

let hidden = false;
beforeEach(() => {
    vi.useFakeTimers();
    resetAutoStartForTests();
    perm.read.mockReset().mockResolvedValue('granted');
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => { vi.useRealTimers(); });

describe('useAutoStartCountdown', () => {
    it('fires once at 7000 ms with the microphone granted, counting 7 down', async () => {
        const { onFire, result } = setup();
        await flush();
        expect(result.current.secondsLeft).toBe(7);
        advance(2100);
        expect(result.current.secondsLeft).toBe(5);
        advance(4899);
        expect(onFire).not.toHaveBeenCalled();
        advance(1);
        expect(onFire).toHaveBeenCalledTimes(1);
        expect(result.current.secondsLeft).toBeNull();
        advance(20_000);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it.each(['prompt', 'unavailable', 'denied'])('never fires with %s', async (answer) => {
        perm.read.mockResolvedValue(answer);
        const { onFire, result } = setup();
        await flush();
        advance(10_000);
        expect(result.current.secondsLeft).toBeNull();
        expect(onFire).not.toHaveBeenCalled();
    });

    it('fires with prompt when the mic already opened in this session', async () => {
        perm.read.mockResolvedValue('prompt');
        noteMicGranted();
        const { onFire } = setup();
        await flush();
        advance(7000);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('no ring until the permission read resolves; the 7 s start at the resolve', async () => {
        let resolve: (v: string) => void = () => undefined;
        perm.read.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
        const { onFire, result } = setup();
        await flush();
        advance(20_000);
        expect(result.current.secondsLeft).toBeNull();
        expect(onFire).not.toHaveBeenCalled();
        await act(async () => { resolve('granted'); await Promise.resolve(); });
        expect(result.current.secondsLeft).toBe(7);
        advance(6999);
        expect(onFire).not.toHaveBeenCalled();
        advance(1);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('armSeq 0 never arms and never reads the permission', async () => {
        const { onFire } = setup({ armSeq: 0 });
        await flush();
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
        expect(perm.read).not.toHaveBeenCalled();
    });

    it('a new plot tap at 5 s restarts the 7 s', async () => {
        const { onFire, rerender } = setup();
        await flush();
        advance(5000);
        rerender({ armSeq: 2 });
        await flush();
        advance(6999);
        expect(onFire).not.toHaveBeenCalled();
        advance(1);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('hold() stops it until the next plot tap', async () => {
        const { onFire, result, rerender } = setup();
        await flush();
        advance(3000);
        act(() => result.current.hold('link'));
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
        rerender({ armSeq: 2 });
        await flush();
        advance(7000);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('a hidden page holds it; coming back does not restart it', async () => {
        const { onFire } = setup();
        await flush();
        advance(2000);
        hidden = true;
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        hidden = false;
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
    });

    it('blocked while running (typing sheet, deselect) holds it; unblocked again it stays held', async () => {
        const { onFire, rerender } = setup();
        await flush();
        advance(3000);
        rerender({ blocked: true });
        advance(1000);
        rerender({ blocked: false });
        await flush();
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
    });

    it('a level that could not be measured this session means no ring', async () => {
        noteLevelUnmeasurable();
        const { onFire, result } = setup();
        await flush();
        advance(10_000);
        expect(result.current.secondsLeft).toBeNull();
        expect(onFire).not.toHaveBeenCalled();
    });

    it('after firing, the same armSeq never fires again (cancel / mic error cannot loop)', async () => {
        const { onFire, rerender } = setup();
        await flush();
        advance(7000);
        rerender({ blocked: true });   // recording
        rerender({ blocked: false });  // cancelled / failed: back to the card
        await flush();
        advance(20_000);
        expect(onFire).toHaveBeenCalledTimes(1);
    });

    it('unmount clears the timer', async () => {
        const { onFire, unmount } = setup();
        await flush();
        advance(3000);
        unmount();
        advance(10_000);
        expect(onFire).not.toHaveBeenCalled();
    });
});
